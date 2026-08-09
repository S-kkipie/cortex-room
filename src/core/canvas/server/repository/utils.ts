import {
    canvasSnapshotSchema,
    elementTombstoneSchema,
    workspaceElementSchema,
} from "@/core/canvas/domain/schemas";
import type {
    CanvasSnapshot,
    ElementTombstone,
    WorkspaceElement,
} from "@/core/canvas/domain/types";
import type { WorkspaceElementRow } from "@/server/drizzle/schemas/workspace-element-schema";

function requireActivePayload(row: WorkspaceElementRow) {
    if (
        row.type === null ||
        row.content === null ||
        row.x === null ||
        row.y === null ||
        row.width === null ||
        row.height === null ||
        row.createdBy === null ||
        row.createdAt === null ||
        row.updatedAt === null
    ) {
        throw new Error("Active canvas element is missing persisted payload");
    }

    return {
        type: row.type,
        content: row.content,
        x: row.x,
        y: row.y,
        width: row.width,
        height: row.height,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

export function toCanvasRecord(
    row: WorkspaceElementRow,
): WorkspaceElement | ElementTombstone {
    if (row.deletedAt !== null) {
        return elementTombstoneSchema.parse({
            id: row.id,
            projectId: row.projectId,
            deletedAt: row.deletedAt.toISOString(),
            lastOperationAt: row.lastOperationAt.toISOString(),
            lastOperationId: row.lastOperationId,
        });
    }

    const payload = requireActivePayload(row);
    return workspaceElementSchema.parse({
        id: row.id,
        projectId: row.projectId,
        ...payload,
        lastOperationAt: row.lastOperationAt.toISOString(),
        lastOperationId: row.lastOperationId,
    });
}

export function toCanvasSnapshot(
    projectId: string,
    rows: WorkspaceElementRow[],
): CanvasSnapshot {
    const snapshot = {
        projectId,
        elements: [] as WorkspaceElement[],
        tombstones: [] as ElementTombstone[],
    };

    for (const row of rows) {
        const record = toCanvasRecord(row);
        if ("deletedAt" in record) snapshot.tombstones.push(record);
        else snapshot.elements.push(record);
    }

    return canvasSnapshotSchema.parse(snapshot);
}
