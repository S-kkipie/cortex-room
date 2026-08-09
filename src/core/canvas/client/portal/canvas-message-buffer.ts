import type { CanvasPortalMessage } from "@/core/canvas/domain/types";

export const CANVAS_MESSAGE_BUFFER_SIZE = 200;

export type CanvasMessageBuffer = {
    append(message: CanvasPortalMessage): void;
    appendAll(messages: readonly CanvasPortalMessage[]): void;
    drain(): CanvasPortalMessage[];
    clear(): void;
    size(): number;
};

export function createCanvasMessageBuffer(
    maxSize = CANVAS_MESSAGE_BUFFER_SIZE,
): CanvasMessageBuffer {
    const messages = new Map<string, CanvasPortalMessage>();

    const append = (message: CanvasPortalMessage) => {
        if (messages.has(message.content.eventId)) return;
        messages.set(message.content.eventId, message);
        if (messages.size <= maxSize) return;

        const oldestEventId = messages.keys().next().value;
        if (oldestEventId) messages.delete(oldestEventId);
    };

    return {
        append,
        appendAll: (nextMessages) => {
            for (const message of nextMessages) append(message);
        },
        drain: () => {
            const drained = [...messages.values()];
            messages.clear();
            return drained;
        },
        clear: () => messages.clear(),
        size: () => messages.size,
    };
}
