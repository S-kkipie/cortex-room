import { DurableObject } from "cloudflare:workers";
import { AgentEvent, Participant } from "../container/src/contract/events";
import { EventBuffer } from "../container/src/emit/buffer";
import { createPortalPublisher, type Publisher } from "../container/src/emit/portal";
import { createRecallBot, RECALL_EVENTS, stopRecallBot } from "../container/src/recall/client";
import { handleRecallWebhook } from "../container/src/recall/webhook";

export type RouteDeps = {
    forward(meetingId: string, req: Request): Promise<Response>;
    authToken: string;
};

const CONTROL_RE = /^\/meetings\/([^/]+)(\/(start|stop|transcript|stream))?$/;
const WEBHOOK_RE = /^\/webhooks\/recall\/([^/]+)\/?$/;

function forwardTo(deps: RouteDeps, meetingId: string, url: URL, req: Request): Promise<Response> {
    const headers = new Headers(req.headers);
    headers.set("x-meeting-id", meetingId);
    const init = { method: req.method, headers, body: req.body, duplex: "half" } as RequestInit;
    return deps.forward(meetingId, new Request(url, init));
}

export async function routeRequest(req: Request, deps: RouteDeps): Promise<Response> {
    const url = new URL(req.url);

    // Recall webhook: HMAC-verified inside the DO, NOT bearer-authed.
    const wh = url.pathname.match(WEBHOOK_RE);
    if (wh) {
        const target = new URL(url);
        target.pathname = "/webhook";
        return forwardTo(deps, wh[1], target, req);
    }

    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${deps.authToken}`) return new Response("unauthorized", { status: 401 });

    const m = url.pathname.match(CONTROL_RE);
    if (!m) return new Response("not found", { status: 404 });
    const target = new URL(url);
    target.pathname = m[2] ?? "/state";
    return forwardTo(deps, m[1], target, req);
}

export type Env = {
    MEETING_AGENT: DurableObjectNamespace;
    AUTH_TOKEN: string;
    RECALL_API_KEY: string;
    RECALL_REGION: string;
    RECALL_WEBHOOK_SECRET: string;
    PORTAL_API_KEY: string;
    PUBLIC_BASE_URL: string;
};

type SessionState = "idle" | "in_meeting" | "ended";

function headerRecord(h: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    h.forEach((v, k) => {
        out[k.toLowerCase()] = v;
    });
    return out;
}

export class MeetingAgent extends DurableObject<Env> {
    private buffer = new EventBuffer();
    private participants = new Map<string, Participant>();
    private seen = new Set<string>();
    private publisher: Publisher | null = null;
    private meetingId = "";
    private t0Ms = 0;
    private botId: string | null = null;
    private state: SessionState = "idle";

    private pub(): Publisher {
        if (!this.publisher) {
            this.publisher = createPortalPublisher({ apiKey: this.env.PORTAL_API_KEY, channelId: `meeting-${this.meetingId}` });
        }
        return this.publisher;
    }

    private emit(ev: AgentEvent): void {
        if (ev.type === "participant.joined") this.participants.set(ev.participant.participantId, ev.participant);
        if (ev.type === "participant.left") this.participants.delete(ev.participantId);
        this.buffer.append(ev);
        void this.pub().publish(ev);
    }

    async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);
        const path = url.pathname;
        const meetingIdHeader = req.headers.get("x-meeting-id");
        if (meetingIdHeader) this.meetingId = meetingIdHeader;

        if (req.method === "POST" && path === "/start") {
            const { meetingUrl } = (await req.json()) as { meetingUrl?: string };
            if (!meetingUrl) return new Response("meetingUrl required", { status: 400 });
            this.t0Ms = Date.now();
            this.state = "in_meeting";
            const { botId } = await createRecallBot({
                apiKey: this.env.RECALL_API_KEY,
                region: this.env.RECALL_REGION,
                meetingUrl,
                webhookUrl: `${this.env.PUBLIC_BASE_URL}/webhooks/recall/${this.meetingId}/`,
                events: RECALL_EVENTS,
            });
            this.botId = botId;
            this.emit({ type: "session.started", meetingId: this.meetingId, at: new Date(this.t0Ms).toISOString() });
            return Response.json({ botId, state: this.state });
        }

        if (req.method === "POST" && path === "/stop") {
            if (this.botId) {
                await stopRecallBot({ apiKey: this.env.RECALL_API_KEY, region: this.env.RECALL_REGION, botId: this.botId }).catch(() => {});
            }
            this.state = "ended";
            this.emit({ type: "session.ended", meetingId: this.meetingId, at: new Date(Date.now()).toISOString(), reason: "requested" });
            return Response.json({ state: this.state });
        }

        if (path === "/state") {
            return Response.json({ state: this.state, participants: [...this.participants.values()] });
        }

        if (path === "/transcript") {
            const cursor = Number(url.searchParams.get("since") ?? 0);
            return Response.json(this.buffer.since(cursor));
        }

        if (path === "/stream") {
            const { readable, writable } = new TransformStream();
            const writer = writable.getWriter();
            const enc = new TextEncoder();
            // NOTE: subscription is not torn down on client disconnect (MVP). Documented
            // follow-up: unsubscribe when the DO detects the stream closed.
            this.buffer.subscribe((ev) => {
                writer.write(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)).catch(() => {});
            });
            return new Response(readable, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
        }

        if (req.method === "POST" && path === "/webhook") {
            const rawBody = await req.text();
            const res = await handleRecallWebhook({
                rawBody,
                headers: headerRecord(req.headers),
                secret: this.env.RECALL_WEBHOOK_SECRET,
                t0Ms: this.t0Ms || Date.now(),
                meetingId: this.meetingId,
                genId: () => crypto.randomUUID(),
            });
            if (res.status !== 200) return new Response("unauthorized", { status: res.status });
            if (res.webhookId && this.seen.has(res.webhookId)) return new Response("ok", { status: 200 });
            if (res.webhookId) this.seen.add(res.webhookId);
            for (const ev of res.events) this.emit(ev);
            return new Response("ok", { status: 200 });
        }

        return new Response("not found", { status: 404 });
    }
}

export default {
    async fetch(req: Request, env: Env): Promise<Response> {
        return routeRequest(req, {
            authToken: env.AUTH_TOKEN,
            forward: (meetingId, r) => {
                const id = env.MEETING_AGENT.idFromName(meetingId);
                return env.MEETING_AGENT.get(id).fetch(r);
            },
        });
    },
};
