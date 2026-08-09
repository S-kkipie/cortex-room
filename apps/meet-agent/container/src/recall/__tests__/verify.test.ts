import { describe, expect, it } from "vitest";
import { verifyRecallSignature } from "../verify";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"; // base64 body after prefix

async function sign(id: string, ts: string, body: string, secret: string): Promise<string> {
    const keyBytes = Uint8Array.from(atob(secret.slice("whsec_".length)), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
    return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

describe("verifyRecallSignature", () => {
    const id = "msg_abc";
    const ts = "1731705121";
    const body = '{"event":"transcript.data"}';

    it("accepts a valid v1 signature", async () => {
        const sig = await sign(id, ts, body, SECRET);
        const ok = await verifyRecallSignature({
            secret: SECRET,
            headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` },
            rawBody: body,
        });
        expect(ok).toBe(true);
    });

    it("accepts svix-* header aliases", async () => {
        const sig = await sign(id, ts, body, SECRET);
        const ok = await verifyRecallSignature({
            secret: SECRET,
            headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` },
            rawBody: body,
        });
        expect(ok).toBe(true);
    });

    it("rejects a tampered body", async () => {
        const sig = await sign(id, ts, body, SECRET);
        const ok = await verifyRecallSignature({
            secret: SECRET,
            headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` },
            rawBody: body + "x",
        });
        expect(ok).toBe(false);
    });

    it("rejects a wrong secret", async () => {
        const sig = await sign(id, ts, body, SECRET);
        const ok = await verifyRecallSignature({
            secret: "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` },
            rawBody: body,
        });
        expect(ok).toBe(false);
    });

    it("rejects missing headers", async () => {
        expect(await verifyRecallSignature({ secret: SECRET, headers: {}, rawBody: body })).toBe(false);
    });

    it("rejects a non-whsec secret", async () => {
        expect(
            await verifyRecallSignature({
                secret: "nope",
                headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": "v1,x" },
                rawBody: body,
            }),
        ).toBe(false);
    });
});
