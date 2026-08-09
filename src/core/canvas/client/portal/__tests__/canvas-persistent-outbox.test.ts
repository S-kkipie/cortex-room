import { afterEach, describe, expect, it, vi } from "vitest";
import type {
    CanvasCommand,
    CanvasMutationResult,
    CanvasPortalMessage,
    WorkspaceElement,
} from "@/core/canvas/domain/types";
import { createCanvasPersistentOutbox } from "../canvas-persistent-outbox";
import { buildFinalCanvasMessage } from "../canvas-portal-events";

const projectId = "00000000-0000-4000-8000-000000000001";
const elementId = "00000000-0000-4000-8000-000000000002";
const operationId = "00000000-0000-4000-8000-000000000003";
const operationAt = "2026-08-09T12:00:00.000Z";

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
    lastOperationId: operationId,
};

function finalMessage(id = operationId): CanvasPortalMessage {
    const record = { ...element, lastOperationId: id };
    const command: CanvasCommand = {
        eventId: id,
        projectId,
        occurredAt: operationAt,
        kind: "workspace.element.update",
        elementId,
        content: record.content,
    };
    const result: CanvasMutationResult = { applied: true, record };
    const message = buildFinalCanvasMessage(command, result, "user-1");
    if (!message) throw new Error("Expected final message");
    return message;
}

afterEach(() => {
    vi.useRealTimers();
});

describe("canvas persistent outbox", () => {
    it("publishes in FIFO order and deduplicates pending/completed ids", async () => {
        const send = vi.fn(async (_message: CanvasPortalMessage) => undefined);
        const outbox = createCanvasPersistentOutbox({ send });
        const first = finalMessage(operationId);
        const secondId = "00000000-0000-4000-8000-000000000004";
        const second = finalMessage(secondId);

        await Promise.all([
            outbox.enqueue(first),
            outbox.enqueue(first),
            outbox.enqueue(second),
        ]);
        await outbox.enqueue(first);

        expect(send).toHaveBeenCalledTimes(2);
        expect(
            send.mock.calls.map(([message]) => message.content.eventId),
        ).toEqual([operationId, secondId]);
        expect(outbox.getSnapshot()).toEqual({
            pendingCount: 0,
            failedCount: 0,
        });
        outbox.dispose();
    });

    it("retries with backoff and keeps later messages behind a failed head", async () => {
        vi.useFakeTimers();
        const send = vi
            .fn<(_: CanvasPortalMessage) => Promise<void>>()
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValue(undefined);
        const outbox = createCanvasPersistentOutbox({ send });
        const pending = outbox.enqueue(finalMessage());

        await vi.advanceTimersByTimeAsync(249);
        expect(send).toHaveBeenCalledOnce();
        expect(outbox.getSnapshot().pendingCount).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toBeUndefined();
        expect(send).toHaveBeenCalledTimes(2);
        outbox.dispose();
    });

    it("marks an item failed after bounded attempts and supports manual retry", async () => {
        vi.useFakeTimers();
        const send = vi
            .fn<(_: CanvasPortalMessage) => Promise<void>>()
            .mockRejectedValue(new Error("offline"));
        const outbox = createCanvasPersistentOutbox({
            send,
            maxAttempts: 2,
            retryDelaysMs: [10],
        });
        const pending = outbox.enqueue(finalMessage());
        const rejection = pending.then(
            () => undefined,
            (error) => error,
        );

        await vi.advanceTimersByTimeAsync(10);
        await expect(rejection).resolves.toMatchObject({ message: "offline" });
        expect(outbox.getSnapshot()).toEqual({
            pendingCount: 1,
            failedCount: 1,
        });

        send.mockResolvedValue(undefined);
        outbox.flush({ retryFailed: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(send).toHaveBeenCalledTimes(3);
        expect(outbox.getSnapshot()).toEqual({
            pendingCount: 0,
            failedCount: 0,
        });
        outbox.dispose();
    });

    it("rejects ephemeral messages and enforces the bounded capacity", async () => {
        const send = vi.fn(() => new Promise<void>(() => undefined));
        const outbox = createCanvasPersistentOutbox({ send, maxSize: 1 });
        void outbox.enqueue(finalMessage()).catch(() => undefined);

        await expect(
            outbox.enqueue({
                ...finalMessage("00000000-0000-4000-8000-000000000004"),
                ephemeral: true,
            }),
        ).rejects.toThrow("persistent messages only");
        await expect(
            outbox.enqueue(
                finalMessage("00000000-0000-4000-8000-000000000004"),
            ),
        ).rejects.toThrow("outbox is full");
        outbox.dispose();
    });
});
