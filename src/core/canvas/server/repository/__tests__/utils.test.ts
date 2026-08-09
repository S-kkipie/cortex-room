import { describe, expect, it } from "vitest";
import type { WorkspaceElementRow } from "@/server/drizzle/schemas/workspace-element-schema";
import { toCanvasRecord, toCanvasSnapshot } from "../utils";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const ELEMENT_ID = "00000000-0000-4000-8000-000000000002";
const EVENT_ID = "00000000-0000-4000-8000-000000000003";

function activeRow(
    overrides: Partial<WorkspaceElementRow> = {},
): WorkspaceElementRow {
    return {
        id: ELEMENT_ID,
        projectId: PROJECT_ID,
        type: "STICKY",
        content: "Remember the user goal",
        x: 120,
        y: 240,
        width: 240,
        height: 160,
        createdBy: "user-1",
        createdAt: new Date("2026-08-08T12:00:00.000Z"),
        updatedAt: new Date("2026-08-08T12:00:01.000Z"),
        lastOperationAt: new Date("2026-08-08T12:00:01.000Z"),
        lastOperationId: EVENT_ID,
        deletedAt: null,
        ...overrides,
    };
}

describe("canvas row mappers", () => {
    it("maps an active row to the strict WorkspaceElement wire shape", () => {
        expect(toCanvasRecord(activeRow())).toEqual({
            id: ELEMENT_ID,
            projectId: PROJECT_ID,
            type: "STICKY",
            content: "Remember the user goal",
            x: 120,
            y: 240,
            width: 240,
            height: 160,
            createdBy: "user-1",
            createdAt: "2026-08-08T12:00:00.000Z",
            updatedAt: "2026-08-08T12:00:01.000Z",
            lastOperationAt: "2026-08-08T12:00:01.000Z",
            lastOperationId: EVENT_ID,
        });
    });

    it("maps a deleted row without active payload to a tombstone", () => {
        expect(
            toCanvasRecord(
                activeRow({
                    type: null,
                    content: null,
                    x: null,
                    y: null,
                    width: null,
                    height: null,
                    createdBy: null,
                    createdAt: null,
                    updatedAt: null,
                    deletedAt: new Date("2026-08-08T12:00:02.000Z"),
                    lastOperationAt: new Date("2026-08-08T12:00:02.000Z"),
                    lastOperationId: "00000000-0000-4000-8000-000000000004",
                }),
            ),
        ).toEqual({
            id: ELEMENT_ID,
            projectId: PROJECT_ID,
            deletedAt: "2026-08-08T12:00:02.000Z",
            lastOperationAt: "2026-08-08T12:00:02.000Z",
            lastOperationId: "00000000-0000-4000-8000-000000000004",
        });
    });

    it("separates active rows and tombstones in a validated snapshot", () => {
        const tombstone = activeRow({
            id: "00000000-0000-4000-8000-000000000005",
            type: null,
            content: null,
            x: null,
            y: null,
            width: null,
            height: null,
            createdBy: null,
            createdAt: null,
            updatedAt: null,
            deletedAt: new Date("2026-08-08T12:00:02.000Z"),
        });

        expect(toCanvasSnapshot(PROJECT_ID, [activeRow(), tombstone])).toEqual({
            projectId: PROJECT_ID,
            elements: [expect.objectContaining({ id: ELEMENT_ID })],
            tombstones: [expect.objectContaining({ id: tombstone.id })],
        });
    });
});
