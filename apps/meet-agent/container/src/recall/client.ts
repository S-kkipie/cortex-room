export const RECALL_EVENTS = [
    "transcript.data",
    "participant_events.join",
    "participant_events.leave",
    "participant_events.update",
    "participant_events.speech_on",
    "participant_events.speech_off",
];

export async function createRecallBot(
    args: { apiKey: string; region: string; meetingUrl: string; webhookUrl: string; events?: string[] },
    fetchImpl: typeof fetch = fetch,
): Promise<{ botId: string }> {
    const res = await fetchImpl(`https://${args.region}.recall.ai/api/v1/bot/`, {
        method: "POST",
        headers: { authorization: args.apiKey, accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
            meeting_url: args.meetingUrl,
            recording_config: {
                // prioritize_low_latency is English-only; accuracy mode supports
                // multilingual meetings (Spanish/English) at a small latency cost.
                transcript: { provider: { recallai_streaming: { language: "es" } } },
                realtime_endpoints: [{ type: "webhook", url: args.webhookUrl, events: args.events ?? RECALL_EVENTS }],
            },
        }),
    });
    if (!res.ok) throw new Error(`Recall create bot failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { id: string };
    return { botId: data.id };
}

export async function stopRecallBot(
    args: { apiKey: string; region: string; botId: string },
    fetchImpl: typeof fetch = fetch,
): Promise<void> {
    // Recall: a bot leaves the call via POST /api/v1/bot/{id}/leave_call/.
    // Confirm the exact endpoint against current docs during the live smoke run.
    const res = await fetchImpl(`https://${args.region}.recall.ai/api/v1/bot/${args.botId}/leave_call/`, {
        method: "POST",
        headers: { authorization: args.apiKey, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Recall stop bot failed: ${res.status} ${await res.text()}`);
}
