import { describe, expect, it, vi } from "vitest";
import { mintPortalToken } from "../portal-token";

const SECRET = "sk_test_123";
const PROJECT = "99999999-9999-4999-8999-999999999999";

function okFetch(token = "eyJ.portal.jwt") {
    return vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
            JSON.stringify({
                token,
                expiresAt: "2026-08-09T13:00:00.000Z",
            }),
            { status: 200 },
        ),
    );
}

describe("mintPortalToken", () => {
    it("returns the token from the Portal response", async () => {
        const fetchImpl = okFetch("tok-abc");
        const token = await mintPortalToken({
            secretKey: SECRET,
            projectId: PROJECT,
            fetchImpl,
        });
        expect(token).toBe("tok-abc");
    });

    it("POSTs to the tokens endpoint with the secret and a room-scoped connect+publish grant", async () => {
        const fetchImpl = okFetch();
        await mintPortalToken({
            secretKey: SECRET,
            projectId: PROJECT,
            fetchImpl,
        });

        expect(fetchImpl).toHaveBeenCalledWith(
            "https://api.useportal.co/v1/tokens",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    Authorization: `Bearer ${SECRET}`,
                }),
            }),
        );
        const body = JSON.parse(
            vi.mocked(fetchImpl).mock.calls[0]?.[1]?.body as string,
        ) as Record<string, unknown>;
        expect(body).toMatchObject({
            userId: "meet-agent",
            ttl: "1h",
            channels: { [`room-${PROJECT}`]: ["connect", "publish"] },
        });
    });

    it("throws on a non-ok response", async () => {
        const fetchImpl = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response("nope", { status: 401 }));
        await expect(
            mintPortalToken({
                secretKey: SECRET,
                projectId: PROJECT,
                fetchImpl,
            }),
        ).rejects.toThrow();
    });

    it("throws when the response has no token", async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ expiresAt: "x" }), {
                status: 200,
            }),
        );
        await expect(
            mintPortalToken({
                secretKey: SECRET,
                projectId: PROJECT,
                fetchImpl,
            }),
        ).rejects.toThrow();
    });
});
