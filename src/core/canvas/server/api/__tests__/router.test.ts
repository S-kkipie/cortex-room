import { describe, expect, it, vi } from "vitest";

const { getPortalTokenService, getSession } = vi.hoisted(() => ({
    getPortalTokenService: vi.fn(),
    getSession: vi.fn(),
}));

vi.mock("@/server/auth/auth", () => ({
    auth: { api: { getSession } },
}));

vi.mock("../../services/get-portal-token-service", () => ({
    getPortalTokenService,
}));

import { canvasPortalRouter, canvasRouter } from "../router";

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
        expect(
            canvasPortalRouter.routes.map(
                ({ method, path }) => `${method} ${path}`,
            ),
        ).toEqual(["GET /portal/token"]);
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

    it("returns a token in the CommonResponse envelope", async () => {
        getSession.mockResolvedValue({
            user: {
                id: "authenticated-user",
                name: "Ada Lovelace",
                email: "ada@example.com",
            },
            session: { id: "session-1" },
        });
        getPortalTokenService.mockResolvedValue({
            ok: true,
            data: {
                token: "eyJ.portal.jwt",
                channelId: "room-00000000-0000-4000-8000-000000000001",
                expiresAt: "2026-08-09T13:00:00.000Z",
            },
        });

        const response = await canvasPortalRouter.handle(
            new Request(
                "http://localhost/portal/token?projectId=00000000-0000-4000-8000-000000000001",
            ),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            response: {
                token: "eyJ.portal.jwt",
                channelId: "room-00000000-0000-4000-8000-000000000001",
                expiresAt: "2026-08-09T13:00:00.000Z",
            },
            code: "OK",
            status: 200,
        });
        expect(getPortalTokenService).toHaveBeenCalledWith(
            "authenticated-user",
            "00000000-0000-4000-8000-000000000001",
            "Ada Lovelace",
        );
    });
});
