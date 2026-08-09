import { afterEach, describe, expect, it, vi } from "vitest";
import type {
    CanvasCommand,
    CanvasMutationResult,
    CanvasPortalMessage,
    CanvasSnapshot,
    ElementTombstone,
    WorkspaceElement,
} from "@/core/canvas/domain/types";
import {
    buildFinalCanvasMessage,
    buildMovePreviewMessage,
    type CanvasRealtimePort,
} from "../../portal/canvas-portal-events";
import {
    type CanvasSelectionPort,
    type CanvasSnapshotPort,
    type CanvasTransport,
    createCanvasActions,
} from "../canvas-controller";
import type { CanvasPreviewPort } from "../canvas-preview";

const projectId = "00000000-0000-4000-8000-000000000001";
const elementId = "00000000-0000-4000-8000-000000000002";
const firstEventId = "00000000-0000-4000-8000-000000000003";
const secondEventId = "00000000-0000-4000-8000-000000000004";
const thirdEventId = "00000000-0000-4000-8000-000000000005";
const operationAt = "2026-08-09T12:00:00.000Z";
const newerOperationAt = "2026-08-09T12:00:01.000Z";

const element: WorkspaceElement = {
    id: elementId,
    projectId,
    type: "STICKY",
    content: "Hello",
    x: 10,
    y: 20,
    width: 240,
    height: 180,
    createdBy: "user-1",
    createdAt: operationAt,
    updatedAt: operationAt,
    lastOperationAt: operationAt,
    lastOperationId: firstEventId,
};

const newerElement: WorkspaceElement = {
    ...element,
    x: 80,
    y: 90,
    updatedAt: newerOperationAt,
    lastOperationAt: newerOperationAt,
    lastOperationId: secondEventId,
};

const tombstone: ElementTombstone = {
    id: elementId,
    projectId,
    deletedAt: newerOperationAt,
    lastOperationAt: newerOperationAt,
    lastOperationId: thirdEventId,
};

function snapshot(): CanvasSnapshot {
    return { projectId, elements: [element], tombstones: [] };
}

function controller(options: {
    transport?: CanvasTransport;
    previews?: CanvasPreviewPort;
    realtime?: CanvasRealtimePort;
    selected?: string[];
}) {
    let current = snapshot();
    let selected = options.selected ?? [];
    let writes = 0;
    const state: CanvasSnapshotPort = {
        read: () => current,
        write: (updater) => {
            writes += 1;
            current = updater(current);
        },
    };
    const selection: CanvasSelectionPort = {
        read: () => selected,
        write: (next) => {
            selected = [...next];
        },
    };
    const transport =
        options.transport ??
        ({
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        } satisfies CanvasTransport);

    return {
        actions: createCanvasActions({
            projectId,
            userId: "user-1",
            state,
            selection,
            transport,
            previews: options.previews,
            realtime: options.realtime,
            idFactory: () => secondEventId,
            now: () => newerOperationAt,
        }),
        read: () => current,
        selected: () => selected,
        writes: () => writes,
    };
}

function moveCommand(): CanvasCommand {
    return {
        eventId: thirdEventId,
        projectId,
        occurredAt: newerOperationAt,
        kind: "workspace.element.move",
        elementId,
        x: newerElement.x,
        y: newerElement.y,
    };
}

function deleteCommand(): CanvasCommand {
    return {
        eventId: secondEventId,
        projectId,
        occurredAt: newerOperationAt,
        kind: "workspace.element.delete",
        elementId,
    };
}

function requireMessage(
    message: CanvasPortalMessage | undefined,
): CanvasPortalMessage {
    if (!message) throw new Error("Expected a valid Portal message");
    return message;
}

describe("canvas multiplayer operations", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("publishes exactly after an applied persistence response", async () => {
        let resolveUpdate: ((result: CanvasMutationResult) => void) | undefined;
        const update = vi.fn(
            () =>
                new Promise<CanvasMutationResult>((resolve) => {
                    resolveUpdate = resolve;
                }),
        );
        const publishPersistent = vi.fn(async () => undefined);
        const realtime: CanvasRealtimePort = {
            publishPersistent,
            publishEphemeral: vi.fn(async () => undefined),
        };
        const test = controller({
            transport: {
                create: vi.fn(),
                update,
                delete: vi.fn(),
            },
            realtime,
        });

        const resultPromise = test.actions.moveElement(elementId, {
            x: newerElement.x,
            y: newerElement.y,
        });
        expect(publishPersistent).not.toHaveBeenCalled();

        resolveUpdate?.({ applied: true, record: newerElement });
        await resultPromise;

        expect(publishPersistent).toHaveBeenCalledOnce();
        expect(publishPersistent).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "workspace.element.moved",
                ephemeral: false,
                content: expect.objectContaining({
                    kind: "workspace.element.moved.final",
                    element: newerElement,
                }),
            }),
        );
    });

    it("does not publish an unapplied response", async () => {
        const publishPersistent = vi.fn(async () => undefined);
        const update = vi
            .fn()
            .mockResolvedValue({ applied: false, record: newerElement });
        const test = controller({
            transport: { create: vi.fn(), update, delete: vi.fn() },
            realtime: {
                publishPersistent,
                publishEphemeral: vi.fn(async () => undefined),
            },
        });

        await test.actions.moveElement(elementId, {
            x: newerElement.x,
            y: newerElement.y,
        });
        expect(publishPersistent).not.toHaveBeenCalled();
    });

    it("ignores an echoed final event after publishing it locally", async () => {
        const publishPersistent = vi.fn(async () => undefined);
        const test = controller({
            transport: {
                create: vi.fn(),
                update: vi
                    .fn()
                    .mockResolvedValue({ applied: true, record: newerElement }),
                delete: vi.fn(),
            },
            realtime: {
                publishPersistent,
                publishEphemeral: vi.fn(async () => undefined),
            },
        });

        await test.actions.moveElement(elementId, {
            x: newerElement.x,
            y: newerElement.y,
        });
        const ownMessage = requireMessage(
            buildFinalCanvasMessage(
                moveCommand(),
                { applied: true, record: newerElement },
                "user-1",
            ),
        );
        const writesAfterPersistence = test.writes();
        test.actions.applyRemoteMessage(ownMessage);
        expect(test.writes()).toBe(writesAfterPersistence);
    });

    it("applies remote final events once with client-side LWW and tombstones", () => {
        const test = controller({ selected: [elementId] });
        const newerMessage = requireMessage(
            buildFinalCanvasMessage(
                moveCommand(),
                { applied: true, record: newerElement },
                "remote-user",
            ),
        );
        const olderMessage = requireMessage(
            buildFinalCanvasMessage(
                {
                    ...moveCommand(),
                    eventId: firstEventId,
                    occurredAt: operationAt,
                },
                { applied: true, record: element },
                "remote-user",
            ),
        );

        test.actions.applyRemoteMessage(newerMessage);
        test.actions.applyRemoteMessage(newerMessage);
        test.actions.applyRemoteMessage(olderMessage);
        expect(test.read().elements).toEqual([newerElement]);

        const deleteMessage = requireMessage(
            buildFinalCanvasMessage(
                deleteCommand(),
                { applied: true, record: tombstone },
                "remote-user",
            ),
        );
        test.actions.applyRemoteMessage(deleteMessage);

        expect(test.read().elements).toEqual([]);
        expect(test.read().tombstones).toEqual([tombstone]);
        expect(test.selected()).toEqual([]);
    });

    it("throttles move previews, debounces text previews and cancels pending work", () => {
        vi.useFakeTimers();
        const publishEphemeral = vi.fn(async () => undefined);
        const test = controller({
            realtime: {
                publishPersistent: vi.fn(async () => undefined),
                publishEphemeral,
            },
        });

        test.actions.publishMovePreview(elementId, { x: 20, y: 30 });
        test.actions.publishMovePreview(elementId, { x: 40, y: 50 });
        expect(publishEphemeral).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(49);
        expect(publishEphemeral).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(1);
        expect(publishEphemeral).toHaveBeenCalledTimes(2);
        expect(publishEphemeral).toHaveBeenLastCalledWith(
            expect.objectContaining({
                content: expect.objectContaining({ x: 40, y: 50 }),
            }),
        );

        test.actions.publishTextPreview(elementId, "Draft");
        vi.advanceTimersByTime(99);
        expect(publishEphemeral).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(1);
        expect(publishEphemeral).toHaveBeenCalledTimes(3);

        test.actions.publishMovePreview(elementId, { x: 60, y: 70 });
        test.actions.publishMovePreview(elementId, { x: 80, y: 90 });
        test.actions.cancelPreviews(elementId);
        vi.advanceTimersByTime(50);
        expect(publishEphemeral).toHaveBeenCalledTimes(4);
    });

    it("throttles cursor awareness and publishes selection awareness ephemerally", () => {
        vi.useFakeTimers();
        const publishEphemeral = vi.fn(async () => undefined);
        const test = controller({
            realtime: {
                publishPersistent: vi.fn(async () => undefined),
                publishEphemeral,
            },
        });

        test.actions.publishCursor({ x: 10, y: 20 });
        test.actions.publishCursor({ x: 30, y: 40 });
        expect(publishEphemeral).toHaveBeenCalledOnce();
        expect(publishEphemeral).toHaveBeenLastCalledWith(
            expect.objectContaining({
                content: expect.objectContaining({
                    kind: "participant.cursor.moved",
                    cursor: { x: 10, y: 20 },
                }),
            }),
        );

        vi.advanceTimersByTime(50);
        expect(publishEphemeral).toHaveBeenCalledTimes(2);
        expect(publishEphemeral).toHaveBeenLastCalledWith(
            expect.objectContaining({
                content: expect.objectContaining({
                    kind: "participant.cursor.moved",
                    cursor: { x: 30, y: 40 },
                }),
            }),
        );

        test.actions.publishSelection([elementId]);
        expect(publishEphemeral).toHaveBeenCalledTimes(3);
        expect(publishEphemeral).toHaveBeenLastCalledWith(
            expect.objectContaining({
                content: expect.objectContaining({
                    kind: "participant.selection.changed",
                    elementIds: [elementId],
                }),
            }),
        );
    });

    it("applies remote previews outside the canonical snapshot", () => {
        const setPreview = vi.fn();
        const clearPreview = vi.fn();
        const test = controller({
            previews: { set: setPreview, clear: clearPreview },
        });
        const preview = buildMovePreviewMessage(
            {
                eventId: firstEventId,
                projectId,
                occurredAt: newerOperationAt,
                senderId: "remote-user",
            },
            { x: 40, y: 50 },
            elementId,
        );

        test.actions.applyRemoteMessage(preview);
        expect(setPreview).toHaveBeenCalledWith(elementId, { x: 40, y: 50 });
        expect(test.read()).toEqual(snapshot());

        const final = requireMessage(
            buildFinalCanvasMessage(
                moveCommand(),
                { applied: true, record: newerElement },
                "remote-user",
            ),
        );
        test.actions.applyRemoteMessage(final);
        expect(clearPreview).toHaveBeenCalledWith(elementId);
    });
});
