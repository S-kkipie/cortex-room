import { describe, expect, it } from "vitest";
import {
    type CanvasActions,
    type CanvasSelectionPort,
    type CanvasSnapshotPort,
    type CanvasTransport,
    createCanvasActions,
} from "@/core/canvas/client/controller/canvas-controller";
import { reconcileCanvasRecord } from "@/core/canvas/client/controller/reconcile-canvas-record";
import type { CanvasRealtimePort } from "@/core/canvas/client/portal/canvas-portal-events";
import type {
    CanvasCommand,
    CanvasMutationResult,
    CanvasSnapshot,
} from "@/core/canvas/domain/types";

const projectId = "00000000-0000-4000-8000-000000000001";
const elementId = "00000000-0000-4000-8000-000000000002";
const ids = [
    elementId,
    "00000000-0000-4000-8000-000000000003",
    "00000000-0000-4000-8000-000000000004",
    "00000000-0000-4000-8000-000000000005",
    "00000000-0000-4000-8000-000000000006",
    "00000000-0000-4000-8000-000000000007",
    "00000000-0000-4000-8000-000000000008",
    "00000000-0000-4000-8000-000000000009",
    "00000000-0000-4000-8000-000000000010",
];
const times = [
    "2026-08-09T12:00:00.000Z",
    "2026-08-09T12:00:01.000Z",
    "2026-08-09T12:00:02.000Z",
    "2026-08-09T12:00:03.000Z",
    "2026-08-09T12:00:04.000Z",
    "2026-08-09T12:00:05.000Z",
    "2026-08-09T12:00:06.000Z",
    "2026-08-09T12:00:07.000Z",
];

function emptySnapshot(): CanvasSnapshot {
    return { projectId, elements: [], tombstones: [] };
}

function unavailableTransport(): CanvasTransport {
    const unavailable = async (): Promise<CanvasMutationResult> => {
        throw new Error("Transport is not available for this client");
    };
    return {
        create: unavailable,
        update: unavailable,
        delete: unavailable,
    };
}

function createClient(options: {
    userId: string;
    initialSnapshot?: CanvasSnapshot;
    ids?: string[];
    times?: string[];
    realtime?: CanvasRealtimePort;
    transportFactory?: (read: () => CanvasSnapshot) => CanvasTransport;
}) {
    let snapshot = structuredClone(options.initialSnapshot ?? emptySnapshot());
    let selection: string[] = [];
    const queuedIds = [...(options.ids ?? [])];
    const queuedTimes = [...(options.times ?? [])];
    const state: CanvasSnapshotPort = {
        read: () => snapshot,
        write: (updater) => {
            snapshot = updater(snapshot);
        },
    };
    const selectionPort: CanvasSelectionPort = {
        read: () => selection,
        write: (elementIds) => {
            selection = [...elementIds];
        },
    };
    const read = () => snapshot;
    const actions = createCanvasActions({
        projectId,
        userId: options.userId,
        state,
        selection: selectionPort,
        transport: options.transportFactory?.(read) ?? unavailableTransport(),
        realtime: options.realtime,
        idFactory: () =>
            queuedIds.shift() ?? "00000000-0000-4000-8000-000000000099",
        now: () => queuedTimes.shift() ?? "2026-08-09T12:00:09.000Z",
    });

    return { actions, read };
}

describe("canvas collaborative acceptance", () => {
    it("converges two clients through every permanent action and reload", async () => {
        let persisted = emptySnapshot();
        const persistentKinds: string[] = [];
        const eventLog: string[] = [];
        let resolvePendingPersistence: (() => void) | undefined;
        const clientB = createClient({ userId: "user-b" });
        let remoteActions: CanvasActions = clientB.actions;
        const realtime: CanvasRealtimePort = {
            publishPersistent: async (message) => {
                const publicationIndex = persistentKinds.length;
                persistentKinds.push(message.content.kind);
                eventLog.push(`published:${publicationIndex}`);
                remoteActions.applyRemoteMessage(message);
            },
            publishEphemeral: async (message) => {
                remoteActions.applyRemoteMessage(message);
            },
        };
        const clientA = createClient({
            userId: "user-a",
            ids,
            times,
            realtime,
            transportFactory: (read) => {
                const persist = async (
                    command: CanvasCommand,
                ): Promise<CanvasMutationResult> => {
                    const current = read();
                    const targetId =
                        command.kind === "workspace.element.create"
                            ? command.element.id
                            : command.elementId;
                    const record =
                        current.elements.find(({ id }) => id === targetId) ??
                        current.tombstones.find(({ id }) => id === targetId);
                    if (!record)
                        throw new Error("Expected optimistic canvas record");
                    const persistenceIndex = persistentKinds.length;
                    return new Promise((resolve) => {
                        resolvePendingPersistence = () => {
                            resolvePendingPersistence = undefined;
                            persisted = reconcileCanvasRecord(
                                persisted,
                                record,
                            );
                            eventLog.push(`persisted:${persistenceIndex}`);
                            resolve({ applied: true, record });
                        };
                    });
                };

                return {
                    create: persist,
                    update: persist,
                    delete: persist,
                };
            },
        });

        const completePermanentAction = async (
            action: () => Promise<CanvasMutationResult>,
            expectedKind: string,
        ) => {
            const actionIndex = persistentKinds.length;
            const actionPromise = action();
            expect(persistentKinds).toHaveLength(actionIndex);

            const resolve = resolvePendingPersistence;
            if (!resolve)
                throw new Error("Expected deferred canvas persistence");
            resolve();

            await actionPromise;
            expect(persistentKinds).toHaveLength(actionIndex + 1);
            expect(persistentKinds[actionIndex]).toBe(expectedKind);
            expect(eventLog.slice(-2)).toEqual([
                `persisted:${actionIndex}`,
                `published:${actionIndex}`,
            ]);
        };

        await completePermanentAction(
            () =>
                clientA.actions.createElement({
                    type: "STICKY",
                    content: "Initial",
                    x: 10,
                    y: 20,
                    width: 240,
                    height: 180,
                }),
            "workspace.element.created.final",
        );
        expect(clientB.actions.getElement(elementId)).toMatchObject({
            content: "Initial",
            x: 10,
            y: 20,
        });

        await completePermanentAction(
            () =>
                clientA.actions.updateElement(elementId, { content: "Final" }),
            "workspace.element.updated.final",
        );
        await completePermanentAction(
            () => clientA.actions.moveElement(elementId, { x: 80, y: 90 }),
            "workspace.element.moved.final",
        );
        await completePermanentAction(
            () =>
                clientA.actions.resizeElement(elementId, {
                    width: 320,
                    height: 220,
                }),
            "workspace.element.resized.final",
        );
        expect(clientB.actions.getElement(elementId)).toMatchObject({
            content: "Final",
            x: 80,
            y: 90,
            width: 320,
            height: 220,
        });

        await completePermanentAction(
            () => clientA.actions.deleteElement(elementId),
            "workspace.element.deleted.final",
        );
        expect(clientB.actions.getElements()).toEqual([]);
        expect(clientB.read().tombstones).toHaveLength(1);
        expect(persistentKinds).toEqual([
            "workspace.element.created.final",
            "workspace.element.updated.final",
            "workspace.element.moved.final",
            "workspace.element.resized.final",
            "workspace.element.deleted.final",
        ]);

        const durableState = structuredClone(persisted);
        clientA.actions.publishCursor({ x: 12, y: 34 });
        clientA.actions.publishSelection([elementId]);
        clientA.actions.publishMovePreview(elementId, { x: 100, y: 110 });
        expect(persisted).toEqual(durableState);
        expect(clientB.read()).toEqual(durableState);

        const reloaded = createClient({
            userId: "user-c",
            initialSnapshot: persisted,
        });
        remoteActions = reloaded.actions;
        expect(reloaded.actions.getElements()).toEqual([]);
        expect(reloaded.read().tombstones).toEqual(persisted.tombstones);
    });
});
