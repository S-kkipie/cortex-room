import type { OperationVersion } from "./types";

export function compareOperationVersions(
    left: OperationVersion,
    right: OperationVersion,
): number {
    const timestampDifference =
        Date.parse(left.lastOperationAt) - Date.parse(right.lastOperationAt);

    if (timestampDifference !== 0) return timestampDifference;

    const leftOperationId = left.lastOperationId.toLowerCase();
    const rightOperationId = right.lastOperationId.toLowerCase();

    if (leftOperationId === rightOperationId) return 0;
    return leftOperationId > rightOperationId ? 1 : -1;
}

export function isOperationNewer(
    incoming: OperationVersion,
    current: OperationVersion,
): boolean {
    return compareOperationVersions(incoming, current) > 0;
}
