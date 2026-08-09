import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/apply-canvas-command", () => ({
    applyCanvasCommand: vi.fn(),
}));

import type { CanvasCommand } from "@/core/canvas/domain/types";
import { applyCanvasCommand } from "../../repository/apply-canvas-command";
import { applyCanvasCommandService } from "../apply-canvas-command-service";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const ELEMENT_ID = "00000000-0000-4000-8000-000000000002";
const EVENT_ID = "00000000-0000-4000-8000-000000000003";
const OCCURRED_AT = "2026-08-08T12:00:00.000Z";

const activeRow = {
    id: ELEMENT_ID,
    projectId: PROJECT_ID,
    type: "STICKY" as const,
    content: "Authoritative content",
    x: 10,
    y: 20,
    width: 240,
    height: 160,
    createdBy: "creator-1",
    createdAt: new Date("2026-08-08T11:00:00.000Z"),
    updatedAt: new Date("2026-08-08T12:00:00.000Z"),
    lastOperationAt: new Date("2026-08-08T12:00:00.000Z"),
    lastOperationId: EVENT_ID,
    deletedAt: null,
};

const createCommand: CanvasCommand = {
    kind: "workspace.element.create",
    eventId: EVENT_ID,
    projectId: PROJECT_ID,
    occurredAt: OCCURRED_AT,
    element: {
        id: ELEMENT_ID,
        type: "STICKY",
        content: "New thought",
        x: 10,
        y: 20,
        width: 240,
        height: 160,
    },
};

describe("applyCanvasCommandService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("passes the authenticated actor to the repository and maps an applied row", async () => {
        vi.mocked(applyCanvasCommand).mockResolvedValue({
            kind: "applied",
            row: activeRow,
        });

        const result = await applyCanvasCommandService(
            "authenticated-user",
            PROJECT_ID,
            createCommand,
        );

        expect(applyCanvasCommand).toHaveBeenCalledWith(
            createCommand,
            "authenticated-user",
        );
        expect(result).toEqual({
            ok: true,
            data: {
                applied: true,
                record: expect.objectContaining({ id: ELEMENT_ID }),
            },
        });
    });

    it("returns the authoritative record when the command is stale", async () => {
        vi.mocked(applyCanvasCommand).mockResolvedValue({
            kind: "stale",
            row: activeRow,
        });

        const result = await applyCanvasCommandService(
            "authenticated-user",
            PROJECT_ID,
            createCommand,
        );

        expect(result).toEqual({
            ok: true,
            data: {
                applied: false,
                record: expect.objectContaining({
                    lastOperationId: EVENT_ID,
                }),
            },
        });
    });

    it("rejects a body whose project or element id disagrees with the route", async () => {
        const mismatchedProject = {
            ...createCommand,
            projectId: "00000000-0000-4000-8000-000000000099",
        } satisfies CanvasCommand;

        const result = await applyCanvasCommandService(
            "authenticated-user",
            PROJECT_ID,
            mismatchedProject,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("INVALID_BODY");
        expect(applyCanvasCommand).not.toHaveBeenCalled();
    });

    it("rejects an element path mismatch without exposing another project row", async () => {
        const result = await applyCanvasCommandService(
            "authenticated-user",
            PROJECT_ID,
            {
                kind: "workspace.element.delete",
                eventId: EVENT_ID,
                projectId: PROJECT_ID,
                occurredAt: OCCURRED_AT,
                elementId: ELEMENT_ID,
            },
            "00000000-0000-4000-8000-000000000099",
        );

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("INVALID_BODY");
        expect(applyCanvasCommand).not.toHaveBeenCalled();
    });

    it("maps a cross-project id collision to CONFLICT", async () => {
        vi.mocked(applyCanvasCommand).mockResolvedValue({ kind: "conflict" });

        const result = await applyCanvasCommandService(
            "authenticated-user",
            PROJECT_ID,
            createCommand,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("CONFLICT");
    });

    it("maps an absent update target to NOT_FOUND", async () => {
        vi.mocked(applyCanvasCommand).mockResolvedValue({
            kind: "not_found",
        });

        const result = await applyCanvasCommandService(
            "authenticated-user",
            PROJECT_ID,
            {
                kind: "workspace.element.move",
                eventId: EVENT_ID,
                projectId: PROJECT_ID,
                occurredAt: OCCURRED_AT,
                elementId: ELEMENT_ID,
                x: 100,
                y: 200,
            },
        );

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });

    it("maps a repository project-missing result to NOT_FOUND", async () => {
        vi.mocked(applyCanvasCommand).mockResolvedValue({
            kind: "project_not_found",
        });

        const result = await applyCanvasCommandService(
            "authenticated-user",
            PROJECT_ID,
            createCommand,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });

    it("rejects a command timestamp that is too far in the future", async () => {
        const result = await applyCanvasCommandService(
            "authenticated-user",
            PROJECT_ID,
            {
                ...createCommand,
                occurredAt: "9999-12-31T23:59:59.999Z",
            },
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe("INVALID_BODY");
            if (result.error.code === "INVALID_BODY") {
                expect(result.error.targets).toEqual(["occurredAt"]);
            }
        }
        expect(applyCanvasCommand).not.toHaveBeenCalled();
    });
});
