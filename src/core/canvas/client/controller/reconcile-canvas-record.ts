import { compareOperationVersions } from "@/core/canvas/domain/operation-version";
import type {
    CanvasSnapshot,
    ElementTombstone,
    WorkspaceElement,
} from "@/core/canvas/domain/types";

type CanvasRecord = WorkspaceElement | ElementTombstone;

export function isCanvasTombstone(
    record: CanvasRecord,
): record is ElementTombstone {
    return "deletedAt" in record;
}

export function reconcileCanvasRecord(
    snapshot: CanvasSnapshot,
    incoming: CanvasRecord,
): CanvasSnapshot {
    const current =
        snapshot.elements.find((record) => record.id === incoming.id) ??
        snapshot.tombstones.find((record) => record.id === incoming.id);

    if (current && compareOperationVersions(incoming, current) < 0) {
        return snapshot;
    }

    const elements = snapshot.elements.filter(
        (record) => record.id !== incoming.id,
    );
    const tombstones = snapshot.tombstones.filter(
        (record) => record.id !== incoming.id,
    );

    if (isCanvasTombstone(incoming)) tombstones.push(incoming);
    else elements.push(incoming);

    return { ...snapshot, elements, tombstones };
}
