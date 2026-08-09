import type { AgentEvent } from "../contract/events";
import { mapRecallEvent } from "./map";
import { verifyRecallSignature } from "./verify";

export async function handleRecallWebhook(args: {
    rawBody: string;
    headers: Record<string, string>;
    secret: string;
    t0Ms: number;
    meetingId: string;
    genId: () => string;
}): Promise<{ status: 200 | 401; events: AgentEvent[]; webhookId: string | null }> {
    const { rawBody, headers, secret, t0Ms, meetingId, genId } = args;

    const ok = await verifyRecallSignature({ secret, headers, rawBody });
    if (!ok) return { status: 401, events: [], webhookId: null };

    const webhookId = headers["webhook-id"] ?? headers["svix-id"] ?? null;

    let payload: unknown;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return { status: 200, events: [], webhookId };
    }

    return { status: 200, events: mapRecallEvent(payload, { meetingId, t0Ms, genId }), webhookId };
}
