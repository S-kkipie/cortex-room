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
}): Promise<{ status: 200 | 401; events: AgentEvent[]; webhookId: string | null; anchorT0Ms: number | null }> {
    const { rawBody, headers, secret, t0Ms, meetingId, genId } = args;

    // Signature enforcement is opt-in: with no configured secret the endpoint
    // accepts unsigned realtime webhooks (demo posture — the meeting id in the
    // URL is the only guard). Set RECALL_WEBHOOK_SECRET to require valid svix
    // signatures and reject everything else.
    if (secret) {
        const ok = await verifyRecallSignature({ secret, headers, rawBody });
        if (!ok) return { status: 401, events: [], webhookId: null, anchorT0Ms: null };
    }

    const webhookId = headers["webhook-id"] ?? headers["svix-id"] ?? null;

    let payload: unknown;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return { status: 200, events: [], webhookId, anchorT0Ms: null };
    }

    const parsed = payload as { event?: unknown; data?: { data?: { timestamp?: { absolute?: unknown; relative?: unknown } } } };
    const timestamp = parsed.data?.data?.timestamp;
    const absolute = timestamp?.absolute;
    const relative = timestamp?.relative;
    const parsedAbsolute = typeof absolute === "string" ? Date.parse(absolute) : Number.NaN;
    const anchorT0Ms =
        typeof parsed.event === "string" &&
        parsed.event.startsWith("participant_events.") &&
        typeof relative === "number" &&
        Number.isFinite(parsedAbsolute)
            ? parsedAbsolute - relative * 1000
            : null;

    return { status: 200, events: mapRecallEvent(payload, { meetingId, t0Ms, genId }), webhookId, anchorT0Ms };
}
