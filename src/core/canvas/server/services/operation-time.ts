import type { WireTimestamp } from "@/core/canvas/domain/types";

/** Allow normal client clock skew while preventing permanent LWW poisoning. */
export const MAX_OPERATION_FUTURE_SKEW_MS = 5 * 60 * 1000;

export function isOperationTimestampAcceptable(
    timestamp: WireTimestamp,
    now = Date.now(),
): boolean {
    return Date.parse(timestamp) <= now + MAX_OPERATION_FUTURE_SKEW_MS;
}
