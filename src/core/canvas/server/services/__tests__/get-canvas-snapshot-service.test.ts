import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/find-canvas-snapshot-rows", () => ({
    findCanvasSnapshotRows: vi.fn(),
}));

import { findCanvasSnapshotRows } from "../../repository/find-canvas-snapshot-rows";
import { getCanvasSnapshotService } from "../get-canvas-snapshot-service";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const ELEMENT_ID = "00000000-0000-4000-8000-000000000002";

const elementRow = {
    id: ELEMENT_ID,
    projectId: PROJECT_ID,
    type: "STICKY" as const,
    content: "A persisted thought",
    x: 10,
    y: 20,
    width: 240,
    height: 160,
    createdBy: "creator-1",
    createdAt: new Date("2026-08-08T12:00:00.000Z"),
    updatedAt: new Date("2026-08-08T12:00:00.000Z"),
    lastOperationAt: new Date("2026-08-08T12:00:00.000Z"),
    lastOperationId: "00000000-0000-4000-8000-000000000003",
    deletedAt: null,
};

describe("getCanvasSnapshotService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("loads a project snapshot without requiring project ownership", async () => {
        vi.mocked(findCanvasSnapshotRows).mockResolvedValue({
            kind: "found",
            rows: [elementRow],
        });

        const result = await getCanvasSnapshotService(PROJECT_ID);

        expect(findCanvasSnapshotRows).toHaveBeenCalledWith(PROJECT_ID);
        expect(result).toEqual({
            ok: true,
            data: {
                projectId: PROJECT_ID,
                elements: [expect.objectContaining({ id: ELEMENT_ID })],
                tombstones: [],
            },
        });
    });

    it("returns NOT_FOUND when the project is absent", async () => {
        vi.mocked(findCanvasSnapshotRows).mockResolvedValue({
            kind: "project_not_found",
        });

        const result = await getCanvasSnapshotService(PROJECT_ID);

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });

    it("converts repository failures into an unexpected result", async () => {
        vi.mocked(findCanvasSnapshotRows).mockRejectedValue(
            new Error("database unavailable"),
        );

        const result = await getCanvasSnapshotService(PROJECT_ID);

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("INTERNAL_SERVER_ERROR");
    });

    it("uses the transaction's project-missing result after a concurrent deletion", async () => {
        vi.mocked(findCanvasSnapshotRows).mockResolvedValue({
            kind: "project_not_found",
        });

        const result = await getCanvasSnapshotService(PROJECT_ID);

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });
});
