import { compareOperationVersions } from "@/core/canvas/domain/operation-version";
import {
    canvasMutationResultSchema,
    createElementCommandSchema,
    deleteElementCommandSchema,
    elementTombstoneSchema,
    moveElementCommandSchema,
    resizeElementCommandSchema,
    updateElementCommandSchema,
    workspaceElementSchema,
} from "@/core/canvas/domain/schemas";
import type {
    CanvasMutationResult,
    CanvasSnapshot,
    CreateElementCommand,
    DeleteElementCommand,
    ElementTombstone,
    MoveElementCommand,
    OperationVersion,
    ResizeElementCommand,
    UpdateElementCommand,
    WorkspaceElement,
} from "@/core/canvas/domain/types";
import {
    isCanvasTombstone,
    reconcileCanvasRecord,
} from "./reconcile-canvas-record";

export type CreateElementInput = Omit<CreateElementCommand["element"], "id">;
export type UpdateElementInput = Pick<UpdateElementCommand, "content">;
export type MoveElementInput = Pick<MoveElementCommand, "x" | "y">;
export type ResizeElementInput = Pick<ResizeElementCommand, "width" | "height">;

type CanvasRecord = WorkspaceElement | ElementTombstone;

export type CanvasTransport = {
    create(command: CreateElementCommand): Promise<CanvasMutationResult>;
    update(
        command:
            | UpdateElementCommand
            | MoveElementCommand
            | ResizeElementCommand,
    ): Promise<CanvasMutationResult>;
    delete(command: DeleteElementCommand): Promise<CanvasMutationResult>;
};

export type CanvasSnapshotPort = {
    read(): CanvasSnapshot | undefined;
    write(updater: (snapshot: CanvasSnapshot) => CanvasSnapshot): void;
};

export type CanvasSelectionPort = {
    read(): string[];
    write(elementIds: string[]): void;
};

export type CanvasActions = {
    createElement(input: CreateElementInput): Promise<CanvasMutationResult>;
    updateElement(
        elementId: string,
        changes: UpdateElementInput,
    ): Promise<CanvasMutationResult>;
    moveElement(
        elementId: string,
        position: MoveElementInput,
    ): Promise<CanvasMutationResult>;
    resizeElement(
        elementId: string,
        dimensions: ResizeElementInput,
    ): Promise<CanvasMutationResult>;
    deleteElement(elementId: string): Promise<CanvasMutationResult>;
    selectElements(elementIds: string[]): void;
    getElement(elementId: string): WorkspaceElement | undefined;
    getElements(): CanvasSnapshot["elements"];
    getSelectedElements(): CanvasSnapshot["elements"];
};

type CanvasControllerDependencies = {
    projectId: string;
    userId: string;
    state: CanvasSnapshotPort;
    selection: CanvasSelectionPort;
    transport: CanvasTransport;
    idFactory?: () => string;
    now?: () => string;
    onError?: (error: unknown) => void;
};

type PendingOperation = {
    elementId: string;
    version: OperationVersion;
    previous: CanvasRecord | undefined;
};

function findRecord(
    snapshot: CanvasSnapshot,
    elementId: string,
): CanvasRecord | undefined {
    return (
        snapshot.elements.find((record) => record.id === elementId) ??
        snapshot.tombstones.find((record) => record.id === elementId)
    );
}

function replaceCanvasRecord(
    snapshot: CanvasSnapshot,
    elementId: string,
    replacement: CanvasRecord | undefined,
): CanvasSnapshot {
    const elements = snapshot.elements.filter(
        (record) => record.id !== elementId,
    );
    const tombstones = snapshot.tombstones.filter(
        (record) => record.id !== elementId,
    );

    if (replacement) {
        if (isCanvasTombstone(replacement)) tombstones.push(replacement);
        else elements.push(replacement);
    }

    return { ...snapshot, elements, tombstones };
}

function hasVersion(
    record: CanvasRecord | undefined,
    version: OperationVersion,
): boolean {
    return (
        record !== undefined && compareOperationVersions(record, version) === 0
    );
}

export function createCanvasActions({
    projectId,
    userId,
    state,
    selection,
    transport,
    idFactory = () => crypto.randomUUID(),
    now = () => new Date().toISOString(),
    onError,
}: CanvasControllerDependencies): CanvasActions {
    const pendingOperations = new Map<string, PendingOperation>();

    const getSnapshot = () => {
        const snapshot = state.read();
        if (!snapshot) throw new Error("Canvas snapshot is not ready");
        return snapshot;
    };

    const persist = (
        elementId: string,
        version: OperationVersion,
        previous: CanvasRecord | undefined,
        optimisticRecord: CanvasRecord,
        command:
            | CreateElementCommand
            | UpdateElementCommand
            | MoveElementCommand
            | ResizeElementCommand
            | DeleteElementCommand,
        send: () => Promise<CanvasMutationResult>,
    ): Promise<CanvasMutationResult> => {
        pendingOperations.set(command.eventId, {
            elementId,
            version,
            previous,
        });
        state.write((snapshot) =>
            reconcileCanvasRecord(snapshot, optimisticRecord),
        );

        let request: Promise<CanvasMutationResult>;
        try {
            request = send();
        } catch (error) {
            request = Promise.reject(error);
        }

        return request
            .then((result) => {
                const parsedResult = canvasMutationResultSchema.parse(result);
                state.write((snapshot) =>
                    reconcileCanvasRecord(snapshot, parsedResult.record),
                );
                if (isCanvasTombstone(parsedResult.record)) {
                    selection.write(
                        selection
                            .read()
                            .filter((selectedId) => selectedId !== elementId),
                    );
                }
                pendingOperations.delete(command.eventId);
                return parsedResult;
            })
            .catch((error: unknown) => {
                const currentSnapshot = state.read();
                const currentRecord = currentSnapshot
                    ? findRecord(currentSnapshot, elementId)
                    : undefined;

                if (currentSnapshot && hasVersion(currentRecord, version)) {
                    state.write((snapshot) =>
                        replaceCanvasRecord(snapshot, elementId, previous),
                    );
                    if (previous === undefined) {
                        selection.write(
                            selection
                                .read()
                                .filter(
                                    (selectedId) => selectedId !== elementId,
                                ),
                        );
                    }
                }

                pendingOperations.delete(command.eventId);
                onError?.(error);
                throw error;
            });
    };

    const createElement = (input: CreateElementInput) => {
        const elementId = idFactory();
        const eventId = idFactory();
        const occurredAt = now();
        const version = {
            lastOperationAt: occurredAt,
            lastOperationId: eventId,
        } satisfies OperationVersion;
        const previous = findRecord(getSnapshot(), elementId);
        const optimisticRecord = workspaceElementSchema.parse({
            id: elementId,
            projectId,
            ...input,
            createdBy: userId,
            createdAt: occurredAt,
            updatedAt: occurredAt,
            ...version,
        });
        const command = createElementCommandSchema.parse({
            eventId,
            projectId,
            occurredAt,
            kind: "workspace.element.create",
            element: {
                id: elementId,
                ...input,
            },
        });

        const request = persist(
            elementId,
            version,
            previous,
            optimisticRecord,
            command,
            () => transport.create(command),
        );
        selection.write([elementId]);
        return request;
    };

    const updateElement = (elementId: string, changes: UpdateElementInput) => {
        const current = getSnapshot().elements.find(
            (record) => record.id === elementId,
        );
        if (!current)
            return Promise.reject(new Error("Canvas element not found"));

        const eventId = idFactory();
        const occurredAt = now();
        const version = {
            lastOperationAt: occurredAt,
            lastOperationId: eventId,
        } satisfies OperationVersion;
        const optimisticRecord = workspaceElementSchema.parse({
            ...current,
            ...changes,
            updatedAt: occurredAt,
            ...version,
        });
        const command = updateElementCommandSchema.parse({
            eventId,
            projectId,
            occurredAt,
            kind: "workspace.element.update",
            elementId,
            ...changes,
        });

        return persist(
            elementId,
            version,
            current,
            optimisticRecord,
            command,
            () => transport.update(command),
        );
    };

    const moveElement = (elementId: string, position: MoveElementInput) => {
        const current = getSnapshot().elements.find(
            (record) => record.id === elementId,
        );
        if (!current)
            return Promise.reject(new Error("Canvas element not found"));

        const eventId = idFactory();
        const occurredAt = now();
        const version = {
            lastOperationAt: occurredAt,
            lastOperationId: eventId,
        } satisfies OperationVersion;
        const optimisticRecord = workspaceElementSchema.parse({
            ...current,
            ...position,
            updatedAt: occurredAt,
            ...version,
        });
        const command = moveElementCommandSchema.parse({
            eventId,
            projectId,
            occurredAt,
            kind: "workspace.element.move",
            elementId,
            ...position,
        });

        return persist(
            elementId,
            version,
            current,
            optimisticRecord,
            command,
            () => transport.update(command),
        );
    };

    const resizeElement = (
        elementId: string,
        dimensions: ResizeElementInput,
    ) => {
        const current = getSnapshot().elements.find(
            (record) => record.id === elementId,
        );
        if (!current)
            return Promise.reject(new Error("Canvas element not found"));

        const eventId = idFactory();
        const occurredAt = now();
        const version = {
            lastOperationAt: occurredAt,
            lastOperationId: eventId,
        } satisfies OperationVersion;
        const optimisticRecord = workspaceElementSchema.parse({
            ...current,
            ...dimensions,
            updatedAt: occurredAt,
            ...version,
        });
        const command = resizeElementCommandSchema.parse({
            eventId,
            projectId,
            occurredAt,
            kind: "workspace.element.resize",
            elementId,
            ...dimensions,
        });

        return persist(
            elementId,
            version,
            current,
            optimisticRecord,
            command,
            () => transport.update(command),
        );
    };

    const deleteElement = (elementId: string) => {
        const current = getSnapshot().elements.find(
            (record) => record.id === elementId,
        );
        if (!current)
            return Promise.reject(new Error("Canvas element not found"));

        const eventId = idFactory();
        const occurredAt = now();
        const version = {
            lastOperationAt: occurredAt,
            lastOperationId: eventId,
        } satisfies OperationVersion;
        const optimisticRecord = elementTombstoneSchema.parse({
            id: elementId,
            projectId,
            deletedAt: occurredAt,
            ...version,
        });
        const command = deleteElementCommandSchema.parse({
            eventId,
            projectId,
            occurredAt,
            kind: "workspace.element.delete",
            elementId,
        });

        selection.write(
            selection.read().filter((selectedId) => selectedId !== elementId),
        );

        return persist(
            elementId,
            version,
            current,
            optimisticRecord,
            command,
            () => transport.delete(command),
        );
    };

    return {
        createElement,
        updateElement,
        moveElement,
        resizeElement,
        deleteElement,
        selectElements: (elementIds: string[]) =>
            selection.write([...elementIds]),
        getElement: (elementId: string) =>
            getSnapshot().elements.find((record) => record.id === elementId),
        getElements: () => getSnapshot().elements,
        getSelectedElements: () => {
            const selectedIds = new Set(selection.read());
            return getSnapshot().elements.filter((record) =>
                selectedIds.has(record.id),
            );
        },
    } satisfies CanvasActions;
}
