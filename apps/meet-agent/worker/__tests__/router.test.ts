import { describe, expect, it, vi } from "vitest";
import { routeRequest } from "../worker";

const deps = () => ({
    forward: vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    authToken: "secret",
});

describe("routeRequest", () => {
    it("rejects a missing bearer token with 401", async () => {
        const res = await routeRequest(new Request("https://x/meetings/m1/start", { method: "POST" }), deps());
        expect(res.status).toBe(401);
    });

    it("forwards an authorized start to the meeting DO", async () => {
        const d = deps();
        const res = await routeRequest(
            new Request("https://x/meetings/m1/start", { method: "POST", headers: { authorization: "Bearer secret" } }),
            d,
        );
        expect(res.status).toBe(200);
        expect(d.forward).toHaveBeenCalledWith("m1", expect.any(Request));
    });

    it("404s an unknown path", async () => {
        const res = await routeRequest(new Request("https://x/nope", { headers: { authorization: "Bearer secret" } }), deps());
        expect(res.status).toBe(404);
    });
});
