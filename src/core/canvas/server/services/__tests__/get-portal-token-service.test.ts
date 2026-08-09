import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/find-project-for-canvas-by-id", () => ({
    findProjectForCanvasById: vi.fn(),
}));

import { findProjectForCanvasById } from "../../repository/find-project-for-canvas-by-id";
import { getPortalTokenService } from "../get-portal-token-service";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "user-1";

describe("getPortalTokenService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("mints a one-hour room-scoped token for an existing project", async () => {
        vi.mocked(findProjectForCanvasById).mockResolvedValue({
            id: PROJECT_ID,
        } as never);
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    token: "eyJ.portal.jwt",
                    expiresAt: "2026-08-09T13:00:00.000Z",
                }),
                { status: 200 },
            ),
        );

        const result = await getPortalTokenService(
            ACTOR_ID,
            PROJECT_ID,
            "Ada Lovelace",
            fetchImpl,
        );

        expect(result).toEqual({
            ok: true,
            data: {
                token: "eyJ.portal.jwt",
                channelId: `room-${PROJECT_ID}`,
                expiresAt: "2026-08-09T13:00:00.000Z",
            },
        });
        expect(fetchImpl).toHaveBeenCalledWith(
            "https://api.useportal.co/v1/tokens",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    Authorization: expect.stringMatching(/^Bearer sk_/),
                }),
                body: expect.stringContaining(`"userId":"${ACTOR_ID}"`),
            }),
        );
        const request = JSON.parse(
            vi.mocked(fetchImpl).mock.calls[0]?.[1]?.body as string,
        ) as Record<string, unknown>;
        expect(request).toMatchObject({
            userId: ACTOR_ID,
            ttl: "1h",
            channels: {
                [`room-${PROJECT_ID}`]: ["connect", "publish"],
            },
        });
    });

    it("does not call Portal for a missing project", async () => {
        vi.mocked(findProjectForCanvasById).mockResolvedValue(null);
        const fetchImpl = vi.fn<typeof fetch>();

        const result = await getPortalTokenService(
            ACTOR_ID,
            PROJECT_ID,
            "Ada Lovelace",
            fetchImpl,
        );

        expect(result).toMatchObject({
            ok: false,
            error: { code: "NOT_FOUND" },
        });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("converts project lookup failures into an internal error", async () => {
        vi.mocked(findProjectForCanvasById).mockRejectedValue(
            new Error("database unavailable"),
        );
        const fetchImpl = vi.fn<typeof fetch>();

        const result = await getPortalTokenService(
            ACTOR_ID,
            PROJECT_ID,
            "Ada Lovelace",
            fetchImpl,
        );

        expect(result).toMatchObject({
            ok: false,
            error: { code: "INTERNAL_SERVER_ERROR" },
        });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("converts invalid Portal responses into an internal error", async () => {
        vi.mocked(findProjectForCanvasById).mockResolvedValue({
            id: PROJECT_ID,
        } as never);
        const fetchImpl = vi
            .fn<typeof fetch>()
            .mockResolvedValue(
                new Response(JSON.stringify({ token: "" }), { status: 200 }),
            );

        const result = await getPortalTokenService(
            ACTOR_ID,
            PROJECT_ID,
            "Ada Lovelace",
            fetchImpl,
        );

        expect(result).toMatchObject({
            ok: false,
            error: { code: "INTERNAL_SERVER_ERROR" },
        });
    });

    it("does not expose the remote response body on HTTP failure", async () => {
        vi.mocked(findProjectForCanvasById).mockResolvedValue({
            id: PROJECT_ID,
        } as never);
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ secret: "should-not-leak" }), {
                status: 403,
            }),
        );

        const result = await getPortalTokenService(
            ACTOR_ID,
            PROJECT_ID,
            "Ada Lovelace",
            fetchImpl,
        );

        expect(result).toMatchObject({
            ok: false,
            error: { code: "INTERNAL_SERVER_ERROR" },
        });
        expect(JSON.stringify(result)).not.toContain("should-not-leak");
    });
});
