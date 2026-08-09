import type { CanvasPortalMessage } from "@/core/canvas/domain/types";

export const CANVAS_OUTBOX_MAX_SIZE = 100;
export const CANVAS_OUTBOX_MAX_ATTEMPTS = 5;
export const CANVAS_OUTBOX_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000] as const;

export type CanvasOutboxSnapshot = {
    pendingCount: number;
    failedCount: number;
};

export type CanvasPersistentOutbox = {
    enqueue(message: CanvasPortalMessage): Promise<void>;
    flush(options?: { retryFailed?: boolean }): void;
    reset(): void;
    subscribe(listener: () => void): () => void;
    getSnapshot(): CanvasOutboxSnapshot;
    dispose(): void;
};

type OutboxItem = {
    message: CanvasPortalMessage;
    attempts: number;
    failed: boolean;
    timer?: ReturnType<typeof setTimeout>;
    resolve: () => void;
    reject: (error: unknown) => void;
    promise: Promise<void>;
};

type CanvasPersistentOutboxOptions = {
    send(message: CanvasPortalMessage): Promise<void>;
    maxSize?: number;
    maxAttempts?: number;
    retryDelaysMs?: readonly number[];
};

function eventId(message: CanvasPortalMessage): string {
    return message.content.eventId;
}

export function createCanvasPersistentOutbox({
    send,
    maxSize = CANVAS_OUTBOX_MAX_SIZE,
    maxAttempts = CANVAS_OUTBOX_MAX_ATTEMPTS,
    retryDelaysMs = CANVAS_OUTBOX_RETRY_DELAYS_MS,
}: CanvasPersistentOutboxOptions): CanvasPersistentOutbox {
    const items = new Map<string, OutboxItem>();
    const completedEventIds = new Set<string>();
    const listeners = new Set<() => void>();
    let snapshot: CanvasOutboxSnapshot = {
        pendingCount: 0,
        failedCount: 0,
    };
    let processing = false;
    let disposed = false;

    const emit = () => {
        const nextSnapshot = {
            pendingCount: items.size,
            failedCount: [...items.values()].filter((item) => item.failed)
                .length,
        } satisfies CanvasOutboxSnapshot;
        if (
            nextSnapshot.pendingCount === snapshot.pendingCount &&
            nextSnapshot.failedCount === snapshot.failedCount
        ) {
            return;
        }
        snapshot = nextSnapshot;
        for (const listener of listeners) listener();
    };

    const rememberCompleted = (id: string) => {
        completedEventIds.add(id);
        if (completedEventIds.size <= 1_000) return;
        const oldest = completedEventIds.values().next().value;
        if (oldest) completedEventIds.delete(oldest);
    };

    const firstItem = () =>
        items.values().next().value as OutboxItem | undefined;

    const processNext = async (): Promise<void> => {
        if (disposed || processing) return;
        const item = firstItem();
        if (!item || item.failed || item.timer) return;

        processing = true;
        let succeeded = false;
        try {
            await send(item.message);
            if (items.get(eventId(item.message)) !== item) return;
            items.delete(eventId(item.message));
            rememberCompleted(eventId(item.message));
            item.resolve();
            emit();
            succeeded = true;
        } catch (error) {
            if (items.get(eventId(item.message)) !== item) return;
            item.attempts += 1;
            if (item.attempts >= maxAttempts) {
                item.failed = true;
                item.reject(error);
                emit();
                return;
            }

            const delay =
                retryDelaysMs[
                    Math.min(item.attempts - 1, retryDelaysMs.length - 1)
                ] ?? 0;
            item.timer = setTimeout(() => {
                item.timer = undefined;
                void processNext();
            }, delay);
            emit();
        } finally {
            processing = false;
            if (succeeded) void processNext();
        }
    };

    const flush = (options: { retryFailed?: boolean } = {}) => {
        const item = firstItem();
        if (!item) return;
        if (item.timer) {
            clearTimeout(item.timer);
            item.timer = undefined;
        }
        if (options.retryFailed && item.failed) {
            item.failed = false;
            item.attempts = 0;
            emit();
        }
        void processNext();
    };

    const reset = () => {
        for (const item of items.values()) {
            if (item.timer) clearTimeout(item.timer);
            item.reject(new Error("Outbox reset"));
        }
        items.clear();
        completedEventIds.clear();
        processing = false;
        emit();
    };

    return {
        enqueue: (message) => {
            if (disposed) return Promise.reject(new Error("Outbox disposed"));
            if (message.ephemeral) {
                return Promise.reject(
                    new Error("Canvas outbox accepts persistent messages only"),
                );
            }

            const id = eventId(message);
            const existing = items.get(id);
            if (existing) return existing.promise;
            if (completedEventIds.has(id)) return Promise.resolve();
            if (items.size >= maxSize) {
                return Promise.reject(new Error("Canvas outbox is full"));
            }

            let resolve!: () => void;
            let reject!: (error: unknown) => void;
            const promise = new Promise<void>(
                (resolvePromise, rejectPromise) => {
                    resolve = resolvePromise;
                    reject = rejectPromise;
                },
            );
            items.set(id, {
                message,
                attempts: 0,
                failed: false,
                resolve,
                reject,
                promise,
            });
            emit();
            void processNext();
            return promise;
        },
        flush,
        reset,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getSnapshot: () => snapshot,
        dispose: () => {
            disposed = true;
            reset();
            listeners.clear();
        },
    } satisfies CanvasPersistentOutbox;
}
