import { describe, expect, it } from "vitest";
import {
    type CanvasSelectionPort,
    type CanvasSnapshotPort,
    type CanvasTransport,
    createCanvasActions,
} from "@/core/canvas/client/controller/canvas-controller";
import type {
    CanvasCommand,
    CanvasMutationResult,
    CanvasSnapshot,
    WorkspaceElement,
} from "@/core/canvas/domain/types";

const projectId = "550e8400-e29b-41d4-a716-446655440000";
const elementId = "550e8400-e29b-41d4-a716-446655440001";
const createId = "550e8400-e29b-41d4-a716-446655440002";
const firstOperationId = "550e8400-e29b-41d4-a716-446655440003";
const secondOperationId = "550e8400-e29b-41d4-a716-446655440004";
const operationAt = "2026-08-09T12:00:00.000Z";
const firstOperationAt = "2026-08-09T12:00:01.000Z";
const secondOperationAt = "2026-08-09T12:00:02.000Z";

const activeElement: WorkspaceElement = {
    id: elementId,
    projectId,
    type: "STICKY",
    content: "Existing",
    x: 10,
    y: 20,
    width: 240,
    height: 180,
    createdBy: "user-1",
    createdAt: operationAt,
    updatedAt: operationAt,
    lastOperationAt: operationAt,
    lastOperationId: firstOperationId,
};

const authoritativeCreatedElement: WorkspaceElement = {
    ...activeElement,
    id: createId,
    content: "Created by server",
    createdBy: "server-user",
    createdAt: firstOperationAt,
    updatedAt: firstOperationAt,
    lastOperationAt: firstOperationAt,
    lastOperationId: firstOperationId,
};

const newerAuthoritativeElement: WorkspaceElement = {
    ...activeElement,
    x: 80,
    y: 90,
    updatedAt: secondOperationAt,
    lastOperationAt: secondOperationAt,
    lastOperationId: secondOperationId,
};

function createSnapshot(): CanvasSnapshot {
    return {
        projectId,
        elements: [activeElement],
        tombstones: [],
    };
}

function createDeferredTransport() {
    const requests: CanvasCommand[] = [];
    const deferred: Array<{
        resolve: (result: CanvasMutationResult) => void;
        reject: (error: Error) => void;
    }> = [];

    const enqueue = (command: CanvasCommand) => {
        requests.push(command);
        return new Promise<CanvasMutationResult>((resolve, reject) => {
            deferred.push({ resolve, reject });
        });
    };

    return {
        transport: {
            create: enqueue,
            update: enqueue,
            delete: enqueue,
        } satisfies CanvasTransport,
        requests,
        resolveNext(result: CanvasMutationResult) {
            deferred.shift()?.resolve(result);
        },
        rejectNext(error: Error) {
            deferred.shift()?.reject(error);
        },
    };
}

function createTestController(
    transport: CanvasTransport,
    options: {
        snapshot?: CanvasSnapshot;
        ids?: string[];
        times?: string[];
    } = {},
) {
    let snapshot = options.snapshot ?? createSnapshot();
    let selectedElementIds: string[] = [];
    const ids = [
        ...(options.ids ?? [createId, firstOperationId, secondOperationId]),
    ];
    const times = [...(options.times ?? [firstOperationAt, secondOperationAt])];
    const state: CanvasSnapshotPort = {
        read: () => snapshot,
        write: (updater) => {
            snapshot = updater(snapshot);
        },
    };
    const selection: CanvasSelectionPort = {
        read: () => selectedElementIds,
        write: (elementIds) => {
            selectedElementIds = elementIds;
        },
    };

    return {
        actions: createCanvasActions({
            projectId,
            userId: "user-1",
            state,
            selection,
            transport,
            idFactory: () =>
                ids.shift() ?? "550e8400-e29b-41d4-a716-446655440099",
            now: () => times.shift() ?? secondOperationAt,
        }),
        read: () => snapshot,
        selected: () => selectedElementIds,
    };
}

describe("createCanvasActions", () => {
    it("creates an optimistic element and reconciles the authoritative response", async () => {
        const deferred = createDeferredTransport();
        const { actions, read, selected } = createTestController(
            deferred.transport,
        );
        const promise = actions.createElement({
            type: "STICKY",
            content: "",
            x: 10,
            y: 20,
            width: 240,
            height: 180,
        });

        expect(read().elements).toHaveLength(2);
        expect(read().elements[1]).toMatchObject({
            id: createId,
            createdBy: "user-1",
            content: "",
        });
        expect(selected()).toEqual([createId]);
        expect(deferred.requests[0]).toMatchObject({
            kind: "workspace.element.create",
            projectId,
        });
        expect(deferred.requests[0]).not.toHaveProperty("createdBy");

        deferred.resolveNext({
            applied: true,
            record: authoritativeCreatedElement,
        });

        await expect(promise).resolves.toEqual({
            applied: true,
            record: authoritativeCreatedElement,
        });
        expect(read().elements).toContainEqual(authoritativeCreatedElement);
    });

    it("publishes the optimistic element before selecting its new id", () => {
        const events: string[] = [];
        const deferred = createDeferredTransport();
        let snapshot = createSnapshot();
        let selectedElementIds: string[] = [];
        const actions = createCanvasActions({
            projectId,
            userId: "user-1",
            state: {
                read: () => snapshot,
                write: (updater) => {
                    events.push("snapshot");
                    snapshot = updater(snapshot);
                },
            },
            selection: {
                read: () => selectedElementIds,
                write: (elementIds) => {
                    events.push("selection");
                    selectedElementIds = elementIds;
                },
            },
            transport: deferred.transport,
            idFactory: () => createId,
            now: () => firstOperationAt,
        });

        void actions.createElement({
            type: "STICKY",
            content: "",
            x: 10,
            y: 20,
            width: 240,
            height: 180,
        });

        expect(events.slice(0, 2)).toEqual(["snapshot", "selection"]);
    });

    it("installs the server winner for an applied-false response", async () => {
        const deferred = createDeferredTransport();
        const { actions, read } = createTestController(deferred.transport);
        const promise = actions.moveElement(elementId, { x: 80, y: 90 });

        deferred.resolveNext({
            applied: false,
            record: newerAuthoritativeElement,
        });
        await promise;

        expect(read().elements).toEqual([newerAuthoritativeElement]);
    });

    it("rolls back only when a failed operation is still current", async () => {
        const deferred = createDeferredTransport();
        const { actions, read } = createTestController(deferred.transport, {
            ids: [firstOperationId, secondOperationId],
            times: [firstOperationAt, secondOperationAt],
        });
        const first = actions.moveElement(elementId, { x: 20, y: 20 });
        const second = actions.moveElement(elementId, { x: 40, y: 40 });

        deferred.rejectNext(new Error("network"));
        await expect(first).rejects.toThrow("network");
        expect(read().elements[0]).toMatchObject({ x: 40, y: 40 });

        deferred.resolveNext({
            applied: true,
            record: newerAuthoritativeElement,
        });
        await second;
    });

    it("creates a tombstone on optimistic delete and restores the element on failure", async () => {
        const deferred = createDeferredTransport();
        const { actions, read, selected } = createTestController(
            deferred.transport,
            {
                ids: [secondOperationId],
                times: [secondOperationAt],
            },
        );
        actions.selectElements([elementId]);
        const promise = actions.deleteElement(elementId);

        expect(read().elements).toEqual([]);
        expect(read().tombstones).toHaveLength(1);
        expect(selected()).toEqual([]);

        deferred.rejectNext(new Error("network"));
        await expect(promise).rejects.toThrow("network");
        expect(read().elements).toEqual([activeElement]);
        expect(read().tombstones).toEqual([]);
    });

    it("selects elements and exposes selected records", () => {
        const deferred = createDeferredTransport();
        const { actions, selected } = createTestController(deferred.transport);

        actions.selectElements([elementId, createId]);

        expect(selected()).toEqual([elementId, createId]);
        expect(actions.getSelectedElements()).toEqual([activeElement]);
    });
});
