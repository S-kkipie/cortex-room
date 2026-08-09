import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/find-project-for-canvas-by-id", () => ({
    findProjectForCanvasById: vi.fn(),
}));

import { findProjectForCanvasById } from "../../repository/find-project-for-canvas-by-id";
import { getCanvasProjectService } from "../get-canvas-project-service";

const activeRow = {
    id: "project-1",
    userId: "owner-1",
    name: "Shared canvas",
    description: null,
    status: "active" as const,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

describe("getCanvasProjectService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns an existing project without an owner argument", async () => {
        vi.mocked(findProjectForCanvasById).mockResolvedValue(activeRow);

        const result = await getCanvasProjectService("project-1");

        expect(findProjectForCanvasById).toHaveBeenCalledWith("project-1");
        expect(result).toEqual({
            ok: true,
            data: expect.objectContaining({
                id: "project-1",
                name: "Shared canvas",
            }),
        });
    });

    it("allows archived projects", async () => {
        vi.mocked(findProjectForCanvasById).mockResolvedValue({
            ...activeRow,
            status: "archived",
        });

        const result = await getCanvasProjectService("project-1");

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.status).toBe("archived");
    });

    it("returns not found when the project is absent", async () => {
        vi.mocked(findProjectForCanvasById).mockResolvedValue(null);

        const result = await getCanvasProjectService("missing");

        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.error).toMatchObject({
                code: "NOT_FOUND",
                targets: ["projectId"],
            });
    });

    it("converts repository failures to an unexpected error value", async () => {
        vi.mocked(findProjectForCanvasById).mockRejectedValue(
            new Error("database unavailable"),
        );

        const result = await getCanvasProjectService("project-1");

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("INTERNAL_SERVER_ERROR");
    });
});
