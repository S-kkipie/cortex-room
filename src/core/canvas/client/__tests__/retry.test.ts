import { afterEach, describe, expect, it, vi } from "vitest";
import { isRetryableCanvasError, retryCanvasPersistence } from "../retry";

afterEach(() => {
    vi.useRealTimers();
});

describe("canvas persistence retry", () => {
    it("retries network and server errors with bounded backoff", async () => {
        vi.useFakeTimers();
        const operation = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new Error("network"))
            .mockRejectedValueOnce(
                Object.assign(new Error("server"), { status: 503 }),
            )
            .mockResolvedValue("ok");

        const result = retryCanvasPersistence(operation);
        await vi.advanceTimersByTimeAsync(100);
        await vi.advanceTimersByTimeAsync(250);

        await expect(result).resolves.toBe("ok");
        expect(operation).toHaveBeenCalledTimes(3);
    });

    it("does not retry client errors", async () => {
        const operation = vi
            .fn<() => Promise<void>>()
            .mockRejectedValue(
                Object.assign(new Error("forbidden"), { status: 403 }),
            );

        await expect(retryCanvasPersistence(operation)).rejects.toThrow(
            "forbidden",
        );
        expect(operation).toHaveBeenCalledOnce();
        expect(isRetryableCanvasError({ status: 400 })).toBe(false);
        expect(isRetryableCanvasError({ response: { status: 403 } })).toBe(
            false,
        );
        expect(isRetryableCanvasError({ status: 429 })).toBe(true);
        expect(isRetryableCanvasError(new Error("offline"))).toBe(true);
    });
});
