import { compareOperationVersions } from "@/core/canvas/domain/operation-version";
import {
    canvasMutationResultSchema,
    canvasPortalMessageSchema,
    createElementCommandSchema,
    deleteElementCommandSchema,
    ELEMENT_PREVIEW_THROTTLE_MS,
    elementTombstoneSchema,
    moveElementCommandSchema,
    resizeElementCommandSchema,
    TEXT_PREVIEW_DEBOUNCE_MS,
    updateElementCommandSchema,
    workspaceElementSchema,
} from "@/core/canvas/domain/schemas";
import type {
    CanvasCommand,
    CanvasMutationResult,
    CanvasPortalMessage,
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
    buildFinalCanvasMessage,
    buildMovePreviewMessage,
    buildResizePreviewMessage,
    buildTextPreviewMessage,
    type CanvasRealtimePort,
} from "../portal/canvas-portal-events";
import type { CanvasPreviewPort } from "./canvas-preview";
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
    applyRemoteMessage(message: CanvasPortalMessage): void;
    publishMovePreview(elementId: string, position: MoveElementInput): void;
    publishResizePreview(
        elementId: string,
        dimensions: ResizeElementInput,
    ): void;
    publishTextPreview(elementId: string, content: string): void;
    cancelPreviews(elementId: string): void;
    cancelAllPreviews(): void;
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
    previews?: CanvasPreviewPort;
    realtime?: CanvasRealtimePort;
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
    previews,
    realtime,
    idFactory = () => crypto.randomUUID(),
    now = () => new Date().toISOString(),
    onError,
}: CanvasControllerDependencies): CanvasActions {
    const pendingOperations = new Map<string, PendingOperation>();
    const recentEventIds = new Set<string>();
    const throttledPreviewStates = new Map<
        string,
        {
            lastSentAt: number;
            timer?: ReturnType<typeof setTimeout>;
            pending?: () => CanvasPortalMessage;
        }
    >();
    const textPreviewTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const maxRecentEventIds = 1_000;

    const rememberEventId = (eventId: string): boolean => {
        if (recentEventIds.has(eventId)) return false;
        recentEventIds.add(eventId);
        if (recentEventIds.size > maxRecentEventIds) {
            const oldest = recentEventIds.values().next().value;
            if (oldest) recentEventIds.delete(oldest);
        }
        return true;
    };

    const publishFinal = (
        command: CanvasCommand,
        result: CanvasMutationResult,
    ) => {
        const message = buildFinalCanvasMessage(command, result, userId);
        if (!message) return;

        rememberEventId(message.content.eventId);
        void realtime?.publishPersistent(message).catch(() => undefined);
    };

    const publishPreview = (build: () => CanvasPortalMessage) => {
        void realtime?.publishEphemeral(build()).catch(() => undefined);
    };

    const scheduleThrottledPreview = (
        key: string,
        build: () => CanvasPortalMessage,
    ) => {
        if (!realtime) return;

        const current = throttledPreviewStates.get(key) ?? {
            lastSentAt: Number.NEGATIVE_INFINITY,
        };
        const elapsed = Date.now() - current.lastSentAt;
        if (!current.timer && elapsed >= ELEMENT_PREVIEW_THROTTLE_MS) {
            current.lastSentAt = Date.now();
            publishPreview(build);
            throttledPreviewStates.set(key, current);
            return;
        }

        current.pending = build;
        if (current.timer) {
            throttledPreviewStates.set(key, current);
            return;
        }

        current.timer = setTimeout(
            () => {
                current.timer = undefined;
                const pending = current.pending;
                current.pending = undefined;
                if (pending) {
                    current.lastSentAt = Date.now();
                    publishPreview(pending);
                }
                throttledPreviewStates.set(key, current);
            },
            Math.max(0, ELEMENT_PREVIEW_THROTTLE_MS - elapsed),
        );
        throttledPreviewStates.set(key, current);
    };

    const scheduleTextPreview = (
        elementId: string,
        build: () => CanvasPortalMessage,
    ) => {
        if (!realtime) return;
        const previous = textPreviewTimers.get(elementId);
        if (previous) clearTimeout(previous);
        textPreviewTimers.set(
            elementId,
            setTimeout(() => {
                textPreviewTimers.delete(elementId);
                publishPreview(build);
            }, TEXT_PREVIEW_DEBOUNCE_MS),
        );
    };

    const cancelPreviews = (elementId: string) => {
        for (const [key, state] of throttledPreviewStates) {
            if (!key.endsWith(`:${elementId}`)) continue;
            if (state.timer) clearTimeout(state.timer);
            throttledPreviewStates.delete(key);
        }

        const textTimer = textPreviewTimers.get(elementId);
        if (textTimer) clearTimeout(textTimer);
        textPreviewTimers.delete(elementId);
    };

    const cancelAllPreviews = () => {
        for (const state of throttledPreviewStates.values()) {
            if (state.timer) clearTimeout(state.timer);
        }
        for (const timer of textPreviewTimers.values()) clearTimeout(timer);
        throttledPreviewStates.clear();
        textPreviewTimers.clear();
    };

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
                if (parsedResult.applied) {
                    publishFinal(command, parsedResult);
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

    const applyRemoteMessage = (message: CanvasPortalMessage) => {
        const parsed = canvasPortalMessageSchema.safeParse(message);
        if (!parsed.success) return;

        const event = parsed.data.content;
        if (event.projectId !== projectId) return;

        if (parsed.data.ephemeral) {
            if (!rememberEventId(event.eventId)) return;
            if (event.kind === "participant.cursor.moved") return;
            if (event.kind === "participant.selection.changed") return;
            if (event.kind === "workspace.element.moved.preview") {
                previews?.set(event.elementId, { x: event.x, y: event.y });
            } else if (event.kind === "workspace.element.resized.preview") {
                previews?.set(event.elementId, {
                    width: event.width,
                    height: event.height,
                });
            } else if (event.kind === "workspace.element.updated.preview") {
                previews?.set(event.elementId, { content: event.content });
            }
            return;
        }

        const currentSnapshot = state.read();
        if (!currentSnapshot || !rememberEventId(event.eventId)) return;

        const record =
            "element" in event
                ? event.element
                : "tombstone" in event
                  ? event.tombstone
                  : undefined;
        if (!record) return;
        const nextSnapshot = reconcileCanvasRecord(currentSnapshot, record);
        if (nextSnapshot === currentSnapshot) return;
        state.write(() => nextSnapshot);

        if (isCanvasTombstone(record)) {
            previews?.clear(record.id);
            selection.write(
                selection
                    .read()
                    .filter((selectedId) => selectedId !== record.id),
            );
        } else {
            previews?.clear(record.id);
        }
    };

    const publishMovePreview = (
        elementId: string,
        position: MoveElementInput,
    ) => {
        scheduleThrottledPreview(`move:${elementId}`, () =>
            buildMovePreviewMessage(
                {
                    eventId: idFactory(),
                    projectId,
                    occurredAt: now(),
                    senderId: userId,
                },
                position,
                elementId,
            ),
        );
    };

    const publishResizePreview = (
        elementId: string,
        dimensions: ResizeElementInput,
    ) => {
        scheduleThrottledPreview(`resize:${elementId}`, () =>
            buildResizePreviewMessage(
                {
                    eventId: idFactory(),
                    projectId,
                    occurredAt: now(),
                    senderId: userId,
                },
                dimensions,
                elementId,
            ),
        );
    };

    const publishTextPreview = (elementId: string, content: string) => {
        scheduleTextPreview(elementId, () =>
            buildTextPreviewMessage(
                {
                    eventId: idFactory(),
                    projectId,
                    occurredAt: now(),
                    senderId: userId,
                },
                elementId,
                content,
            ),
        );
    };

    return {
        createElement,
        updateElement,
        moveElement,
        resizeElement,
        deleteElement,
        applyRemoteMessage,
        publishMovePreview,
        publishResizePreview,
        publishTextPreview,
        cancelPreviews,
        cancelAllPreviews,
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
