import { describe, expect, it } from "vitest";
import {
    isOperationTimestampAcceptable,
    MAX_OPERATION_FUTURE_SKEW_MS,
} from "../operation-time";

describe("canvas operation timestamp policy", () => {
    const now = Date.parse("2026-08-08T12:00:00.000Z");

    it("accepts timestamps within the configured future clock-skew window", () => {
        expect(
            isOperationTimestampAcceptable(
                new Date(now + MAX_OPERATION_FUTURE_SKEW_MS).toISOString(),
                now,
            ),
        ).toBe(true);
    });

    it("rejects timestamps beyond the future clock-skew window", () => {
        expect(
            isOperationTimestampAcceptable(
                new Date(now + MAX_OPERATION_FUTURE_SKEW_MS + 1).toISOString(),
                now,
            ),
        ).toBe(false);
    });

    it("allows old timestamps so delayed operations can still be classified as stale", () => {
        expect(
            isOperationTimestampAcceptable("2020-01-01T00:00:00.000Z", now),
        ).toBe(true);
    });
});
