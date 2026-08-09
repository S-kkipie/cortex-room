import { describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({
    getSession: vi.fn(),
}));

vi.mock("@/server/auth/auth", () => ({
    auth: { api: { getSession } },
}));

import { canvasRouter } from "../router";

describe("canvas API router", () => {
    it("registers the complete authenticated persistence surface", () => {
        expect(
            canvasRouter.routes.map(({ method, path }) => `${method} ${path}`),
        ).toEqual([
            "GET /canvas/:projectId/elements",
            "POST /canvas/:projectId/elements",
            "PUT /canvas/:projectId/elements/:elementId",
            "DELETE /canvas/:projectId/elements/:elementId",
        ]);
    });

    it("returns the CommonResponse 401 envelope for anonymous requests", async () => {
        getSession.mockResolvedValue(null);

        const response = await canvasRouter.handle(
            new Request(
                "http://localhost/canvas/00000000-0000-4000-8000-000000000001/elements",
            ),
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({
            code: "UNAUTHORIZED",
            status: 401,
        });
    });

    it("rejects an invalid project path before reaching the snapshot service", async () => {
        getSession.mockResolvedValue({
            user: { id: "authenticated-user" },
            session: { id: "session-1" },
        });

        const response = await canvasRouter.handle(
            new Request("http://localhost/canvas/not-a-uuid/elements"),
        );

        expect(response.status).toBe(422);
    });
});
