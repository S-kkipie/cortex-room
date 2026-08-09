import { describe, expect, it } from "vitest";
import type { CanvasPortalMessage } from "@/core/canvas/domain/types";
import {
    CANVAS_MESSAGE_BUFFER_SIZE,
    createCanvasMessageBuffer,
} from "../canvas-message-buffer";
import { buildCursorMessage } from "../canvas-portal-events";

const projectId = "00000000-0000-4000-8000-000000000001";

function message(eventId: string, x: number): CanvasPortalMessage {
    return buildCursorMessage(
        {
            eventId,
            projectId,
            occurredAt: "2026-08-09T12:00:00.000Z",
            senderId: "user-1",
        },
        { x, y: x },
    );
}

describe("canvas message buffer", () => {
    it("drains messages in arrival order and deduplicates event ids", () => {
        const buffer = createCanvasMessageBuffer();
        buffer.append(message("00000000-0000-4000-8000-000000000001", 1));
        buffer.append(message("00000000-0000-4000-8000-000000000002", 2));
        buffer.append(message("00000000-0000-4000-8000-000000000001", 99));

        expect(buffer.size()).toBe(2);
        expect(buffer.drain().map((item) => item.content.eventId)).toEqual([
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002",
        ]);
        expect(buffer.size()).toBe(0);
    });

    it("retains only the newest messages at the bounded capacity", () => {
        const buffer = createCanvasMessageBuffer(2);
        buffer.append(message("00000000-0000-4000-8000-000000000001", 1));
        buffer.append(message("00000000-0000-4000-8000-000000000002", 2));
        buffer.append(message("00000000-0000-4000-8000-000000000003", 3));

        expect(
            buffer
                .drain()
                .map((item) =>
                    item.content.kind === "participant.cursor.moved"
                        ? item.content.cursor.x
                        : undefined,
                ),
        ).toEqual([2, 3]);
    });

    it("supports appendAll, clear, and the documented default bound", () => {
        const buffer = createCanvasMessageBuffer();
        const messages = Array.from(
            { length: CANVAS_MESSAGE_BUFFER_SIZE },
            (_, index) =>
                message(
                    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
                    index,
                ),
        );

        buffer.appendAll(messages);
        expect(buffer.size()).toBe(CANVAS_MESSAGE_BUFFER_SIZE);
        buffer.clear();
        expect(buffer.drain()).toEqual([]);
    });
});
