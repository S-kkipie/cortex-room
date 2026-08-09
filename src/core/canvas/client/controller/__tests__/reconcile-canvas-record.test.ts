import { describe, expect, it } from "vitest";
import { reconcileCanvasRecord } from "@/core/canvas/client/controller/reconcile-canvas-record";
import type {
    CanvasSnapshot,
    ElementTombstone,
    WorkspaceElement,
} from "@/core/canvas/domain/types";

const projectId = "550e8400-e29b-41d4-a716-446655440000";
const elementId = "550e8400-e29b-41d4-a716-446655440001";
const olderOperationId = "550e8400-e29b-41d4-a716-446655440002";
const newerOperationId = "550e8400-e29b-41d4-a716-446655440003";
const operationAt = "2026-08-09T12:00:00.000Z";
const newerOperationAt = "2026-08-09T12:00:01.000Z";

const activeElement: WorkspaceElement = {
    id: elementId,
    projectId,
    type: "STICKY",
    content: "Old",
    x: 10,
    y: 20,
    width: 240,
    height: 180,
    createdBy: "user-1",
    createdAt: operationAt,
    updatedAt: operationAt,
    lastOperationAt: operationAt,
    lastOperationId: olderOperationId,
};

const newerElement: WorkspaceElement = {
    ...activeElement,
    content: "New",
    x: 80,
    lastOperationAt: newerOperationAt,
    lastOperationId: newerOperationId,
};

const authoritativeSameVersion: WorkspaceElement = {
    ...activeElement,
    createdBy: "authoritative-user",
    createdAt: newerOperationAt,
    updatedAt: newerOperationAt,
    lastOperationAt: newerOperationAt,
    lastOperationId: newerOperationId,
};

const newerTombstone: ElementTombstone = {
    id: elementId,
    projectId,
    deletedAt: newerOperationAt,
    lastOperationAt: newerOperationAt,
    lastOperationId: newerOperationId,
};

function snapshotWith(
    record: WorkspaceElement | ElementTombstone,
): CanvasSnapshot {
    return {
        projectId,
        elements: "deletedAt" in record ? [] : [record],
        tombstones: "deletedAt" in record ? [record] : [],
    };
}

describe("reconcileCanvasRecord", () => {
    it("replaces an active record with a newer active record", () => {
        const result = reconcileCanvasRecord(
            snapshotWith(activeElement),
            newerElement,
        );

        expect(result.elements).toEqual([newerElement]);
        expect(result.tombstones).toEqual([]);
    });

    it("moves an id from elements to tombstones for a newer delete", () => {
        const result = reconcileCanvasRecord(
            snapshotWith(activeElement),
            newerTombstone,
        );

        expect(result.elements).toEqual([]);
        expect(result.tombstones).toEqual([newerTombstone]);
    });

    it("ignores an older record and accepts an equal-version authoritative record", () => {
        expect(
            reconcileCanvasRecord(snapshotWith(newerElement), activeElement),
        ).toEqual(snapshotWith(newerElement));

        expect(
            reconcileCanvasRecord(
                snapshotWith(newerElement),
                authoritativeSameVersion,
            ),
        ).toEqual(snapshotWith(authoritativeSameVersion));
    });

    it("never lets an older active element resurface over a tombstone", () => {
        const result = reconcileCanvasRecord(
            snapshotWith(newerTombstone),
            activeElement,
        );

        expect(result.elements).toEqual([]);
        expect(result.tombstones).toEqual([newerTombstone]);
    });
});
