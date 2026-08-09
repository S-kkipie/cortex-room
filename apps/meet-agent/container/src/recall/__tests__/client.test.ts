import { describe, expect, it, vi } from "vitest";
import { createRecallBot, RECALL_EVENTS, stopRecallBot } from "../client";

describe("createRecallBot", () => {
    it("POSTs the correct Recall create-bot request and returns the bot id", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "bot_123" }), { status: 201 }));
        const { botId } = await createRecallBot(
            { apiKey: "KEY", region: "us-west-2", meetingUrl: "https://meet.google.com/abc", webhookUrl: "https://x/webhooks/recall/m1/" },
            fetchImpl as unknown as typeof fetch,
        );
        expect(botId).toBe("bot_123");
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe("https://us-west-2.recall.ai/api/v1/bot/");
        expect((init as RequestInit).method).toBe("POST");
        expect((init as RequestInit & { headers: Record<string, string> }).headers.authorization).toBe("KEY");
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.meeting_url).toBe("https://meet.google.com/abc");
        expect(body.recording_config.transcript.provider.recallai_streaming.mode).toBe("prioritize_low_latency");
        expect(body.recording_config.realtime_endpoints[0]).toMatchObject({ type: "webhook", url: "https://x/webhooks/recall/m1/", events: RECALL_EVENTS });
    });

    it("throws on a non-2xx response", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response("bad url", { status: 400 }));
        await expect(
            createRecallBot({ apiKey: "K", region: "us-west-2", meetingUrl: "x", webhookUrl: "y" }, fetchImpl as unknown as typeof fetch),
        ).rejects.toThrow(/400/);
    });

    it("stopRecallBot calls the leave_call endpoint", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
        await stopRecallBot({ apiKey: "K", region: "us-west-2", botId: "bot_123" }, fetchImpl as unknown as typeof fetch);
        expect(fetchImpl.mock.calls[0][0]).toBe("https://us-west-2.recall.ai/api/v1/bot/bot_123/leave_call/");
    });
});
