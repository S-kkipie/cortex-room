import { describe, expect, it } from "vitest";
import { handleRecallWebhook } from "../webhook";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

async function sign(id: string, ts: string, body: string): Promise<string> {
    const keyBytes = Uint8Array.from(atob(SECRET.slice("whsec_".length)), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
    return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

const base = { secret: SECRET, t0Ms: 1_000_000, meetingId: "m1", genId: () => "seg1" };

describe("handleRecallWebhook", () => {
    it("verifies and maps a transcript.data event", async () => {
        const body = JSON.stringify({
            event: "transcript.data",
            data: { data: { words: [{ text: "hi", start_timestamp: { relative: 0 }, end_timestamp: { relative: 1 } }], participant: { id: 5, name: "Ada" } } },
        });
        const headers = { "webhook-id": "w1", "webhook-timestamp": "1", "webhook-signature": await sign("w1", "1", body) };
        const res = await handleRecallWebhook({ ...base, rawBody: body, headers });
        expect(res.status).toBe(200);
        expect(res.webhookId).toBe("w1");
        expect(res.events[0].type).toBe("transcript.segment");
    });

    it("anchors participant events and not transcript events", async () => {
        const absolute = "2026-08-08T12:00:10.000Z";
        const relative = 10.5;
        const participantBody = JSON.stringify({
            event: "participant_events.join",
            data: { data: { participant: { id: 5, name: "Ada" }, timestamp: { absolute, relative } } },
        });
        const participantHeaders = {
            "webhook-id": "participant-1",
            "webhook-timestamp": "1",
            "webhook-signature": await sign("participant-1", "1", participantBody),
        };
        const participantRes = await handleRecallWebhook({ ...base, rawBody: participantBody, headers: participantHeaders });
        expect(participantRes.anchorT0Ms).toBe(Date.parse(absolute) - relative * 1000);

        const transcriptBody = JSON.stringify({
            event: "transcript.data",
            data: { data: { words: [], participant: null, timestamp: { absolute, relative } } },
        });
        const transcriptHeaders = {
            "webhook-id": "transcript-1",
            "webhook-timestamp": "1",
            "webhook-signature": await sign("transcript-1", "1", transcriptBody),
        };
        const transcriptRes = await handleRecallWebhook({ ...base, rawBody: transcriptBody, headers: transcriptHeaders });
        expect(transcriptRes.anchorT0Ms).toBeNull();
    });

    it("rejects an invalid signature with 401 and no events", async () => {
        const body = JSON.stringify({ event: "transcript.data", data: { data: { words: [], participant: null } } });
        const res = await handleRecallWebhook({ ...base, rawBody: body, headers: { "webhook-id": "w2", "webhook-timestamp": "1", "webhook-signature": "v1,bad" } });
        expect(res.status).toBe(401);
        expect(res.events).toEqual([]);
    });

    it("returns 200 with no events on malformed JSON", async () => {
        const body = "{not json";
        const headers = { "webhook-id": "w3", "webhook-timestamp": "1", "webhook-signature": await sign("w3", "1", body) };
        const res = await handleRecallWebhook({ ...base, rawBody: body, headers });
        expect(res.status).toBe(200);
        expect(res.events).toEqual([]);
    });
});
