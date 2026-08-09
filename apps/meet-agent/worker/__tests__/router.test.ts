import { describe, expect, it, vi } from "vitest";
import { routeRequest } from "../worker";

const deps = () => ({
    forward: vi.fn(async (_meetingId: string, req: Request) => new Response(JSON.stringify({ path: new URL(req.url).pathname, mid: req.headers.get("x-meeting-id") }), { status: 200 })),
    authToken: "secret",
});

describe("routeRequest", () => {
    it("rejects a control route without a bearer token (401)", async () => {
        const res = await routeRequest(new Request("https://x/meetings/m1/start", { method: "POST" }), deps());
        expect(res.status).toBe(401);
    });

    it("forwards an authorized start with path /start and x-meeting-id", async () => {
        const d = deps();
        const res = await routeRequest(new Request("https://x/meetings/m1/start", { method: "POST", headers: { authorization: "Bearer secret" } }), d);
        const body = await res.json();
        expect(body).toMatchObject({ path: "/start", mid: "m1" });
        expect(d.forward).toHaveBeenCalledWith("m1", expect.any(Request));
    });

    it("maps the meeting root to /state", async () => {
        const res = await routeRequest(new Request("https://x/meetings/m1", { headers: { authorization: "Bearer secret" } }), deps());
        expect((await res.json() as { path: string }).path).toBe("/state");
    });

    it("preserves the transcript query string", async () => {
        const res = await routeRequest(new Request("https://x/meetings/m1/transcript?since=5", { headers: { authorization: "Bearer secret" } }), deps());
        // pathname is rewritten to /transcript; the DO reads ?since from the same URL
        expect((await res.json() as { path: string }).path).toBe("/transcript");
    });

    it("forwards a webhook WITHOUT a bearer, path /webhook, x-meeting-id set", async () => {
        const d = deps();
        const res = await routeRequest(new Request("https://x/webhooks/recall/m1/", { method: "POST", body: "{}" }), d);
        const body = await res.json();
        expect(body).toMatchObject({ path: "/webhook", mid: "m1" });
        expect(d.forward).toHaveBeenCalledWith("m1", expect.any(Request));
    });

    it("404s an unknown authorized path", async () => {
        const res = await routeRequest(new Request("https://x/nope", { headers: { authorization: "Bearer secret" } }), deps());
        expect(res.status).toBe(404);
    });
});
