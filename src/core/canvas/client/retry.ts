export const CANVAS_PERSISTENCE_RETRY_DELAYS_MS = [100, 250] as const;
export const CANVAS_PERSISTENCE_MAX_ATTEMPTS = 3;

type StatusError = {
    status?: unknown;
    response?: {
        status?: unknown;
    };
};

export function isRetryableCanvasError(error: unknown): boolean {
    const statusError = error as StatusError | null;
    const status = statusError?.status ?? statusError?.response?.status;
    if (typeof status !== "number") return true;
    return status === 408 || status === 429 || status >= 500;
}

function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function retryCanvasPersistence<T>(
    operation: () => Promise<T>,
    options: {
        maxAttempts?: number;
        retryDelaysMs?: readonly number[];
    } = {},
): Promise<T> {
    const maxAttempts = options.maxAttempts ?? CANVAS_PERSISTENCE_MAX_ATTEMPTS;
    const retryDelaysMs =
        options.retryDelaysMs ?? CANVAS_PERSISTENCE_RETRY_DELAYS_MS;

    for (let attempt = 1; ; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            if (attempt >= maxAttempts || !isRetryableCanvasError(error)) {
                throw error;
            }

            const delay =
                retryDelaysMs[
                    Math.min(attempt - 1, retryDelaysMs.length - 1)
                ] ?? 0;
            await wait(delay);
        }
    }
}
