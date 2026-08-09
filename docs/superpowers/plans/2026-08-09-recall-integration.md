# Recall.ai Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the participant-bot capture path with Recall.ai. A Cloudflare Worker + Durable Object dispatches a Recall bot to a meeting, receives HMAC-verified real-time webhooks (transcript + participant + speech events), normalizes them into our existing event contract, and publishes to a Portal channel and a REST/SSE testing API.

**Architecture:** No browser, no container. The Worker is the public entrypoint: control routes (`/meetings/:id/*`, bearer-authed) and a webhook receiver (`/webhooks/recall/:id/`, HMAC-verified) both forward to a per-meeting `MeetingAgent` Durable Object. The DO holds an in-memory `EventBuffer`, dedupes webhooks, maps Recall payloads to `AgentEvent`s, and fans out to the buffer (SSE + `/transcript`) and the Portal publisher. Recall handles the bot, audio, STT, and speaker attribution.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects (`wrangler`), WebCrypto (HMAC-SHA256 verification), Recall.ai REST API, `@portalsdk/core`, Zod, Vitest.

## Global Constraints

- Package: `apps/meet-agent/` (existing). Standalone, no pnpm workspace.
- Biome: **4-space indent, spaces not tabs**.
- Confirmed Recall config: region **`us-west-2`**, provider **`recallai_streaming`** (`mode: "prioritize_low_latency"`), transport **webhook**.
- The 6 subscribed Recall events, exactly: `transcript.data`, `participant_events.join`, `participant_events.leave`, `participant_events.update`, `participant_events.speech_on`, `participant_events.speech_off`.
- Event/segment shapes live only in `container/src/contract/events.ts` (single source of truth). The contract gains one additive variant `speaker.active`; nothing else changes shape.
- Recall API auth header is `Authorization: <API_KEY>` with **no `Bearer` prefix** (distinct from our control-route bearer).
- Webhook verification: base64 HMAC-SHA256 over `"{webhook-id}.{webhook-timestamp}.{rawBody}"`, key = base64-decoded secret after the `whsec_` prefix; accept if any space-separated `v1,<sig>` entry matches (constant-time compare). Accept both `webhook-*` and `svix-*` header names.
- Graceful-degradation invariant: a Portal outage or a null-participant utterance never stops transcript flow to the SSE/API feed. Portal publish is best-effort (never throws).
- Never process an unverified webhook. Invalid HMAC → 401, emit nothing.
- Secrets come from the Worker env binding, never hardcoded: `AUTH_TOKEN`, `RECALL_API_KEY`, `RECALL_REGION`, `RECALL_WEBHOOK_SECRET`, `PORTAL_API_KEY`, `PUBLIC_BASE_URL`.
- Every task ends green (`pnpm test`) and `pnpm typecheck` exit 0, and is committed.

## File Structure

```text
apps/meet-agent/
├─ worker/worker.ts                 # MODIFY: control routes + webhook route; MeetingAgent DO (plain, not Container)
├─ worker/__tests__/router.test.ts  # MODIFY: add webhook-route cases
├─ wrangler.jsonc                   # MODIFY: drop containers, plain DO binding, add vars
├─ container/src/
│  ├─ contract/events.ts            # MODIFY: add speaker.active variant
│  ├─ emit/buffer.ts                # UNCHANGED (survives)
│  ├─ emit/portal.ts                # UNCHANGED (survives)
│  └─ recall/                       # NEW
│     ├─ verify.ts                  # verifyRecallSignature (WebCrypto HMAC)
│     ├─ map.ts                     # mapRecallEvent(payload, ctx) → AgentEvent[]
│     ├─ client.ts                  # createRecallBot / stopRecallBot
│     ├─ webhook.ts                 # handleRecallWebhook (verify + parse + map)
│     └─ __tests__/{verify,map,webhook,client}.test.ts
└─ DELETED: container/src/meet/, meet-ui-adapter/, identity/, stt/, segments/,
            Dockerfile, .dockerignore, scripts/dev-join.ts
```

Tasks 1–5 are pure, unit-tested. Task 6 rewrites the DO (integration, typecheck-gated). Task 7 rewrites the router (pure, unit-tested). Task 8 deletes the dead capture stack. Task 9 is deploy config + smoke doc.

Note: the DO's per-request logic that CAN be pure (webhook verify/parse/map) is extracted into `recall/webhook.ts` (Task 5) so it is unit-testable; the DO (Task 6) is a thin shell wiring it to the buffer, Portal, and Recall client.

---

### Task 1: Contract — add `speaker.active`

**Files:**
- Modify: `apps/meet-agent/container/src/contract/events.ts`
- Modify: `apps/meet-agent/container/src/contract/__tests__/events.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `agentEventSchema` gains a 6th discriminated-union member `{ type: "speaker.active", participantId: string, active: boolean, at: string }`. `AgentEvent` type updates automatically.

- [ ] **Step 1: Add the failing test**

Append inside the existing `describe("contract", ...)` block:

```ts
    it("discriminates a speaker.active event", () => {
        const ev = { type: "speaker.active", participantId: "42", active: true, at: "2026-08-09T00:00:00.000Z" };
        const parsed = agentEventSchema.parse(ev);
        expect(parsed.type).toBe("speaker.active");
        if (parsed.type === "speaker.active") expect(parsed.active).toBe(true);
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/meet-agent && pnpm test contract`
Expected: FAIL — `speaker.active` not in the union.

- [ ] **Step 3: Add the variant**

In `events.ts`, add this object as the last member of the `agentEventSchema` discriminated union (after the `transcript.segment` member):

```ts
    z.object({ type: z.literal("speaker.active"), participantId: z.string(), active: z.boolean(), at: z.string() }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/meet-agent && pnpm test contract`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/contract/
git commit -m "feat(meet-agent): add speaker.active event variant"
```

---

### Task 2: Recall webhook signature verification

**Files:**
- Create: `apps/meet-agent/container/src/recall/verify.ts`
- Test: `apps/meet-agent/container/src/recall/__tests__/verify.test.ts`

**Interfaces:**
- Consumes: WebCrypto global `crypto.subtle` (available in Workers and Node 22+).
- Produces: `verifyRecallSignature(args: { secret: string; headers: Record<string, string>; rawBody: string | null }): Promise<boolean>` — returns `true` iff the signature is valid; never throws.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/meet-agent && pnpm test verify`
Expected: FAIL — cannot resolve `../verify`.

- [ ] **Step 3: Implement `verify.ts`**

```ts
// Verifies Recall.ai webhook/websocket signatures (svix-compatible HMAC-SHA256).
// Signed string is `${id}.${timestamp}.${rawBody}`; key is the base64 body of a
// `whsec_`-prefixed secret. Header names may be webhook-* or svix-*.
function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export async function verifyRecallSignature(args: {
    secret: string;
    headers: Record<string, string>;
    rawBody: string | null;
}): Promise<boolean> {
    const { secret, headers, rawBody } = args;
    if (!secret || !secret.startsWith("whsec_")) return false;

    const id = headers["webhook-id"] ?? headers["svix-id"];
    const ts = headers["webhook-timestamp"] ?? headers["svix-timestamp"];
    const sigHeader = headers["webhook-signature"] ?? headers["svix-signature"];
    if (!id || !ts || !sigHeader) return false;

    let keyBytes: Uint8Array;
    try {
        keyBytes = Uint8Array.from(atob(secret.slice("whsec_".length)), (c) => c.charCodeAt(0));
    } catch {
        return false;
    }

    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${rawBody ?? ""}`));
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

    for (const part of sigHeader.split(" ")) {
        const [version, sig] = part.split(",");
        if (version !== "v1" || !sig) continue;
        if (constantTimeEqual(sig, expected)) return true;
    }
    return false;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/meet-agent && pnpm test verify`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/recall/verify.ts apps/meet-agent/container/src/recall/__tests__/verify.test.ts
git commit -m "feat(meet-agent): Recall webhook HMAC verification"
```

---

### Task 3: Map Recall payloads to AgentEvents

**Files:**
- Create: `apps/meet-agent/container/src/recall/map.ts`
- Test: `apps/meet-agent/container/src/recall/__tests__/map.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `Participant` (`../contract/events`).
- Produces:
  - `type MapCtx = { meetingId: string; t0Ms: number; genId: () => string }`
  - `mapRecallEvent(payload: unknown, ctx: MapCtx): AgentEvent[]` — pure; returns `[]` for unknown/empty events. Reads `payload.event` and the nested `payload.data.data`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { mapRecallEvent } from "../map";

const ctx = { meetingId: "m1", t0Ms: 1_000_000, genId: () => "seg1" };

describe("mapRecallEvent", () => {
    it("maps transcript.data to a resolved transcript.segment", () => {
        const payload = {
            event: "transcript.data",
            data: {
                data: {
                    words: [
                        { text: "hola", start_timestamp: { relative: 1.0 }, end_timestamp: { relative: 1.5 } },
                        { text: "equipo", start_timestamp: { relative: 1.5 }, end_timestamp: { relative: 2.0 } },
                    ],
                    language_code: "es",
                    participant: { id: 42, name: "Diego", is_host: true, email: "d@x.com" },
                },
            },
        };
        const evs = mapRecallEvent(payload, ctx);
        expect(evs).toHaveLength(1);
        const ev = evs[0];
        expect(ev.type).toBe("transcript.segment");
        if (ev.type === "transcript.segment") {
            expect(ev.segment.text).toBe("hola equipo");
            expect(ev.segment.speaker).toMatchObject({ participantId: "42", displayName: "Diego" });
            expect(ev.segment.identityConfidence).toBe("resolved");
            expect(ev.segment.startedAt).toBe(new Date(1_000_000 + 1000).toISOString());
            expect(ev.segment.endedAt).toBe(new Date(1_000_000 + 2000).toISOString());
            expect(ev.segment.isFinal).toBe(true);
        }
    });

    it("maps a null participant to unresolved", () => {
        const payload = {
            event: "transcript.data",
            data: { data: { words: [{ text: "eh", start_timestamp: { relative: 0 }, end_timestamp: { relative: 0.4 } }], participant: null } },
        };
        const ev = mapRecallEvent(payload, ctx)[0];
        expect(ev.type === "transcript.segment" && ev.segment.identityConfidence).toBe("unresolved");
        if (ev.type === "transcript.segment") expect(ev.segment.speaker).toMatchObject({ kind: "unresolved" });
    });

    it("drops an empty-word transcript", () => {
        const payload = { event: "transcript.data", data: { data: { words: [], participant: { id: 1, name: "A" } } } };
        expect(mapRecallEvent(payload, ctx)).toEqual([]);
    });

    it("maps participant_events.join", () => {
        const payload = {
            event: "participant_events.join",
            data: { data: { participant: { id: 7, name: "Sofia" }, timestamp: { absolute: "2026-08-09T00:00:05.000Z", relative: 5 } } },
        };
        const ev = mapRecallEvent(payload, ctx)[0];
        expect(ev).toMatchObject({ type: "participant.joined", at: "2026-08-09T00:00:05.000Z" });
        if (ev.type === "participant.joined") expect(ev.participant).toMatchObject({ participantId: "7", displayName: "Sofia" });
    });

    it("maps participant_events.update to an upsert participant.joined", () => {
        const payload = {
            event: "participant_events.update",
            data: { data: { participant: { id: 7, name: "Sofia", email: "s@x.com" }, timestamp: { absolute: "2026-08-09T00:00:06.000Z", relative: 6 } } },
        };
        const ev = mapRecallEvent(payload, ctx)[0];
        expect(ev.type).toBe("participant.joined");
    });

    it("maps participant_events.leave", () => {
        const payload = {
            event: "participant_events.leave",
            data: { data: { participant: { id: 7 }, timestamp: { absolute: "2026-08-09T00:01:00.000Z", relative: 60 } } },
        };
        expect(mapRecallEvent(payload, ctx)[0]).toMatchObject({ type: "participant.left", participantId: "7", at: "2026-08-09T00:01:00.000Z" });
    });

    it("maps speech_on / speech_off to speaker.active", () => {
        const on = {
            event: "participant_events.speech_on",
            data: { data: { participant: { id: 7 }, timestamp: { absolute: "2026-08-09T00:00:10.000Z", relative: 10 } } },
        };
        const off = {
            event: "participant_events.speech_off",
            data: { data: { participant: { id: 7 }, timestamp: { absolute: "2026-08-09T00:00:12.000Z", relative: 12 } } },
        };
        expect(mapRecallEvent(on, ctx)[0]).toMatchObject({ type: "speaker.active", participantId: "7", active: true });
        expect(mapRecallEvent(off, ctx)[0]).toMatchObject({ type: "speaker.active", participantId: "7", active: false });
    });

    it("returns [] for an unknown event", () => {
        expect(mapRecallEvent({ event: "video_separate_png.data", data: {} }, ctx)).toEqual([]);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/meet-agent && pnpm test map`
Expected: FAIL — cannot resolve `../map`.

- [ ] **Step 3: Implement `map.ts`**

```ts
import type { AgentEvent, Participant, SpeakerRef } from "../contract/events";

export type MapCtx = { meetingId: string; t0Ms: number; genId: () => string };

type RecallParticipant = { id: number | string; name?: string | null; email?: string | null } | null | undefined;

function toParticipant(p: RecallParticipant): Participant | null {
    if (!p || p.id === undefined || p.id === null) return null;
    const participantId = String(p.id);
    return p.name != null ? { participantId, displayName: p.name } : { participantId };
}

function iso(t0Ms: number, relativeSeconds: number): string {
    return new Date(t0Ms + relativeSeconds * 1000).toISOString();
}

export function mapRecallEvent(payload: unknown, ctx: MapCtx): AgentEvent[] {
    const p = payload as { event?: string; data?: { data?: Record<string, unknown> } };
    const event = p?.event;
    const inner = p?.data?.data ?? {};

    switch (event) {
        case "transcript.data": {
            const words = Array.isArray(inner.words) ? (inner.words as Array<Record<string, unknown>>) : [];
            const text = words
                .map((w) => (typeof w.text === "string" ? w.text : ""))
                .join(" ")
                .trim();
            if (!text) return [];
            const participant = toParticipant(inner.participant as RecallParticipant);
            const speaker: SpeakerRef = participant ?? { kind: "unresolved" };
            const rel = (w: Record<string, unknown> | undefined, key: string): number => {
                const stamp = w?.[key] as { relative?: number } | undefined;
                return typeof stamp?.relative === "number" ? stamp.relative : 0;
            };
            const start = rel(words[0], "start_timestamp");
            const end = rel(words[words.length - 1], "end_timestamp") || start;
            return [
                {
                    type: "transcript.segment",
                    segment: {
                        segmentId: ctx.genId(),
                        meetingId: ctx.meetingId,
                        speaker,
                        text,
                        startedAt: iso(ctx.t0Ms, start),
                        endedAt: iso(ctx.t0Ms, end),
                        isFinal: true,
                        identityConfidence: participant ? "resolved" : "unresolved",
                    },
                },
            ];
        }
        case "participant_events.join":
        case "participant_events.update": {
            const participant = toParticipant(inner.participant as RecallParticipant);
            if (!participant) return [];
            const at = (inner.timestamp as { absolute?: string })?.absolute ?? new Date(ctx.t0Ms).toISOString();
            return [{ type: "participant.joined", participant, at }];
        }
        case "participant_events.leave": {
            const participant = toParticipant(inner.participant as RecallParticipant);
            if (!participant) return [];
            const at = (inner.timestamp as { absolute?: string })?.absolute ?? new Date(ctx.t0Ms).toISOString();
            return [{ type: "participant.left", participantId: participant.participantId, at }];
        }
        case "participant_events.speech_on":
        case "participant_events.speech_off": {
            const participant = toParticipant(inner.participant as RecallParticipant);
            if (!participant) return [];
            const at = (inner.timestamp as { absolute?: string })?.absolute ?? new Date(ctx.t0Ms).toISOString();
            return [{ type: "speaker.active", participantId: participant.participantId, active: event === "participant_events.speech_on", at }];
        }
        default:
            return [];
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/meet-agent && pnpm test map`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/recall/map.ts apps/meet-agent/container/src/recall/__tests__/map.test.ts
git commit -m "feat(meet-agent): map Recall payloads to AgentEvents"
```

---

### Task 4: Recall REST client

**Files:**
- Create: `apps/meet-agent/container/src/recall/client.ts`
- Test: `apps/meet-agent/container/src/recall/__tests__/client.test.ts`

**Interfaces:**
- Consumes: a `fetch`-shaped function (injectable for tests).
- Produces:
  - `const RECALL_EVENTS: string[]` — the 6 subscribed events.
  - `createRecallBot(args: { apiKey: string; region: string; meetingUrl: string; webhookUrl: string; events?: string[] }, fetchImpl?: typeof fetch): Promise<{ botId: string }>`
  - `stopRecallBot(args: { apiKey: string; region: string; botId: string }, fetchImpl?: typeof fetch): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/meet-agent && pnpm test client`
Expected: FAIL — cannot resolve `../client`.

- [ ] **Step 3: Implement `client.ts`**

```ts
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
                transcript: { provider: { recallai_streaming: { mode: "prioritize_low_latency" } } },
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/meet-agent && pnpm test client`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/recall/client.ts apps/meet-agent/container/src/recall/__tests__/client.test.ts
git commit -m "feat(meet-agent): Recall create/stop bot client"
```

---

### Task 5: Webhook handler (verify + parse + map + dedupe signal)

**Files:**
- Create: `apps/meet-agent/container/src/recall/webhook.ts`
- Test: `apps/meet-agent/container/src/recall/__tests__/webhook.test.ts`

**Interfaces:**
- Consumes: `verifyRecallSignature` (`./verify`), `mapRecallEvent` + `MapCtx` (`./map`), `AgentEvent` (`../contract/events`).
- Produces: `handleRecallWebhook(args: { rawBody: string; headers: Record<string, string>; secret: string; t0Ms: number; meetingId: string; genId: () => string }): Promise<{ status: 200 | 401; events: AgentEvent[]; webhookId: string | null }>` — verifies, then parses+maps. Returns `401`/no events on bad signature; `200`/`[]` on malformed JSON; `200`/events otherwise. The caller (the DO) dedupes on `webhookId`.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/meet-agent && pnpm test webhook`
Expected: FAIL — cannot resolve `../webhook`.

- [ ] **Step 3: Implement `webhook.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/meet-agent && pnpm test webhook`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/recall/webhook.ts apps/meet-agent/container/src/recall/__tests__/webhook.test.ts
git commit -m "feat(meet-agent): compose Recall webhook verify + map"
```

---

### Task 6: Rewrite MeetingAgent as a plain Durable Object

**Files:**
- Modify: `apps/meet-agent/worker/worker.ts` (the `MeetingAgent` class only; the router is Task 7)
- Modify: `apps/meet-agent/wrangler.jsonc`

**Interfaces:**
- Consumes: `EventBuffer` (`../container/src/emit/buffer`), `createPortalPublisher` + `Publisher` (`../container/src/emit/portal`), `handleRecallWebhook` (`../container/src/recall/webhook`), `createRecallBot` + `stopRecallBot` + `RECALL_EVENTS` (`../container/src/recall/client`), `AgentEvent`/`Participant` (`../container/src/contract/events`).
- Produces: `class MeetingAgent extends DurableObject<Env>` with an internal `fetch(req)` router for `POST /start`, `POST /stop`, `GET /state`, `GET /transcript`, `GET /stream`, `POST /webhook`. `Env` type exported for the worker.

This task is integration; verification is `pnpm typecheck` exit 0 and the unchanged unit suite staying green (no new DO unit test — DO wiring is exercised in the Task 9 smoke run).

- [ ] **Step 1: Replace the `MeetingAgent` class and add `Env`**

Import at the top of `worker/worker.ts` (keep the existing `Container` import line only until Step 3 removes it — for now add these):

```ts
import { DurableObject } from "cloudflare:workers";
import { AgentEvent, Participant } from "../container/src/contract/events";
import { EventBuffer } from "../container/src/emit/buffer";
import { createPortalPublisher, type Publisher } from "../container/src/emit/portal";
import { createRecallBot, RECALL_EVENTS, stopRecallBot } from "../container/src/recall/client";
import { handleRecallWebhook } from "../container/src/recall/webhook";
```

Add the `Env` type and replace the `MeetingAgent extends Container` class with:

```ts
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
```

- [ ] **Step 2: Update `wrangler.jsonc` — plain DO, no container, add vars**

Replace the file with:

```jsonc
{
    "name": "cortex-meet-agent",
    "main": "worker/worker.ts",
    "compatibility_date": "2026-01-01",
    "durable_objects": {
        "bindings": [{ "name": "MEETING_AGENT", "class_name": "MeetingAgent" }],
    },
    "migrations": [{ "tag": "v1", "new_classes": ["MeetingAgent"] }],
    "vars": {
        "AUTH_TOKEN": "change-me-in-secrets",
        "RECALL_REGION": "us-west-2",
        "PUBLIC_BASE_URL": "https://cortex-meet-agent.example.workers.dev",
    },
}
```

(`RECALL_API_KEY`, `RECALL_WEBHOOK_SECRET`, `PORTAL_API_KEY`, and the real `AUTH_TOKEN` are set via `wrangler secret put`, not vars — see Task 9. The migration switches from `new_sqlite_classes` to `new_classes` because this is now a plain DO.)

- [ ] **Step 3: Typecheck (router still references old shape — expect it to compile only after Task 7)**

The default-export `fetch` in `worker.ts` still has the old `Env` inline type and calls the old routing. Update the default export's env parameter type to `Env`:

Find the default export and change its signature to use the exported `Env`:

```ts
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
```

Remove the now-unused `Container` import line and its `@ts-expect-error` comment.

Run: `cd apps/meet-agent && pnpm typecheck`
Expected: exit 0. (The router `routeRequest` is unchanged from the current file and still compiles; Task 7 extends it. `x-meeting-id` is read by the DO but not yet set by the router — that is added in Task 7; until then `/start` falls back to an empty `meetingId`, which is corrected in Task 7. This is acceptable mid-plan since no test exercises the DO.)

- [ ] **Step 4: Run the unit suite (unchanged, must stay green)**

Run: `cd apps/meet-agent && pnpm test`
Expected: PASS — all existing tests still green (the DO has no unit test; the router test is unchanged until Task 7).

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/worker/worker.ts apps/meet-agent/wrangler.jsonc
git commit -m "feat(meet-agent): rewrite MeetingAgent as plain DO backed by Recall webhooks"
```

---

### Task 7: Worker router — control + webhook routes

**Files:**
- Modify: `apps/meet-agent/worker/worker.ts` (the `routeRequest` function + `RouteDeps`)
- Modify: `apps/meet-agent/worker/__tests__/router.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `routeRequest(req, deps)` now also matches `POST /webhooks/recall/:id/` (no bearer, forwarded to the DO with pathname `/webhook`), sets an `x-meeting-id` header on every forwarded request, and keeps the bearer-authed control routes.

- [ ] **Step 1: Update the router tests**

Replace the body of `router.test.ts` with (keeps the existing intent, adds webhook cases):

```ts
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
        expect((await res.json()).path).toBe("/state");
    });

    it("preserves the transcript query string", async () => {
        const res = await routeRequest(new Request("https://x/meetings/m1/transcript?since=5", { headers: { authorization: "Bearer secret" } }), deps());
        // pathname is rewritten to /transcript; the DO reads ?since from the same URL
        expect((await res.json()).path).toBe("/transcript");
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
```

- [ ] **Step 2: Run to verify the webhook cases fail**

Run: `cd apps/meet-agent && pnpm test router`
Expected: FAIL — webhook path currently 401s (no bearer) and `x-meeting-id` is unset.

- [ ] **Step 3: Update `routeRequest`**

Replace the current `routeRequest` (and keep `RouteDeps`) with:

```ts
const CONTROL_RE = /^\/meetings\/([^/]+)(\/(start|stop|transcript|stream))?$/;
const WEBHOOK_RE = /^\/webhooks\/recall\/([^/]+)\/?$/;

function forwardTo(deps: RouteDeps, meetingId: string, url: URL, req: Request): Promise<Response> {
    const headers = new Headers(req.headers);
    headers.set("x-meeting-id", meetingId);
    return deps.forward(meetingId, new Request(url, { method: req.method, headers, body: req.body }));
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/meet-agent && pnpm test router && pnpm typecheck`
Expected: router PASS (6 tests); typecheck exit 0.

- [ ] **Step 5: Run the full suite**

Run: `cd apps/meet-agent && pnpm test`
Expected: PASS — all suites green.

- [ ] **Step 6: Commit**

```bash
git add apps/meet-agent/worker/worker.ts apps/meet-agent/worker/__tests__/router.test.ts
git commit -m "feat(meet-agent): route control + Recall webhook to the DO"
```

---

### Task 8: Delete the dead participant-bot capture stack

**Files:**
- Delete: `apps/meet-agent/container/src/meet/`, `container/src/meet-ui-adapter/`, `container/src/identity/`, `container/src/stt/`, `container/src/segments/` (all, including `__tests__`)
- Delete: `apps/meet-agent/Dockerfile`, `apps/meet-agent/.dockerignore`, `apps/meet-agent/scripts/dev-join.ts`
- Modify: `apps/meet-agent/package.json` (remove `playwright`, `assemblyai` deps and the `dev:join` script)

**Interfaces:**
- Consumes: nothing.
- Produces: a lean package with only contract, emit, recall, and worker code.

- [ ] **Step 1: Confirm nothing live imports the doomed modules**

Run: `cd apps/meet-agent && grep -rn "meet/session\|meet-ui-adapter\|identity/correlator\|stt/assemblyai\|segments/reducer" worker container/src/recall container/src/emit container/src/contract`
Expected: no output. (If any line prints, stop — a live module still depends on the capture stack; do not delete until it's removed.)

- [ ] **Step 2: Delete the modules and infra files**

```bash
cd apps/meet-agent
rm -rf container/src/meet container/src/meet-ui-adapter container/src/identity container/src/stt container/src/segments
rm -f Dockerfile .dockerignore scripts/dev-join.ts
rmdir scripts 2>/dev/null || true
```

- [ ] **Step 3: Remove dead dependencies and the dev:join script from `package.json`**

Edit `package.json`: delete the `"dev:join": ...` line from `scripts`, and delete `"playwright": "^1.49.0"` and `"assemblyai": "^4.9.0"` from `dependencies`. Then refresh the lockfile:

Run: `cd apps/meet-agent && pnpm install`
Expected: lockfile updates, no errors.

- [ ] **Step 4: Verify the suite and typecheck are still green**

Run: `cd apps/meet-agent && pnpm test && pnpm typecheck`
Expected: `pnpm test` PASS (contract + emit + recall/* + router suites); typecheck exit 0. No test references a deleted module.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(meet-agent): remove participant-bot capture stack (superseded by Recall)"
```

---

### Task 9: Deploy config + manual smoke checklist

**Files:**
- Create: `apps/meet-agent/README.md`
- Create: `apps/meet-agent/SMOKE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: operator docs. No code; verification is that the documented commands are internally consistent with `wrangler.jsonc` and the routes.

- [ ] **Step 1: Write `README.md`**

```markdown
# cortex-meet-agent

Recall.ai-backed real-time meeting transcription for Cortex Room. A Cloudflare
Worker + Durable Object dispatches a Recall bot to a Google Meet, receives
HMAC-verified real-time webhooks, and publishes speaker-attributed transcript
events to a Portal channel and a REST/SSE API.

## Layout

- `worker/worker.ts` — Worker router + `MeetingAgent` Durable Object.
- `container/src/contract/` — event contract (Zod). Single source of truth.
- `container/src/emit/` — in-memory `EventBuffer` (SSE) + best-effort Portal publisher.
- `container/src/recall/` — Recall client, HMAC verify, payload → event mapping, webhook handler.

## Configure secrets (once)

```bash
cd apps/meet-agent
wrangler secret put AUTH_TOKEN            # bearer for the control API
wrangler secret put RECALL_API_KEY        # Recall API key (rotate if ever exposed)
wrangler secret put RECALL_WEBHOOK_SECRET # whsec_... workspace verification secret
wrangler secret put PORTAL_API_KEY        # Portal publishable key
```

`RECALL_REGION` (`us-west-2`) and `PUBLIC_BASE_URL` are `vars` in `wrangler.jsonc`;
set `PUBLIC_BASE_URL` to the deployed Worker URL so Recall can reach the webhook.

## Deploy

```bash
wrangler deploy
```

## Control API (bearer-authed)

```text
POST /meetings/:id/start      { "meetingUrl": "https://meet.google.com/xxx" }
POST /meetings/:id/stop
GET  /meetings/:id            → { state, participants }
GET  /meetings/:id/transcript?since=<cursor>
GET  /meetings/:id/stream     → SSE
POST /webhooks/recall/:id/    ← Recall (HMAC-verified, not bearer)
```
```

- [ ] **Step 2: Write `SMOKE.md`**

```markdown
# Manual E2E smoke checklist (Recall.ai)

Prereqs: a deployed Worker (public URL), `RECALL_API_KEY` + `RECALL_WEBHOOK_SECRET`
+ `AUTH_TOKEN` set as secrets, `PUBLIC_BASE_URL` var = the deployed URL, and a real
Google Meet link. Recall billing is active per meeting-minute.

1. Deploy: `wrangler deploy`. Note the Worker URL; confirm it equals `PUBLIC_BASE_URL`.
2. Start:
   ```bash
   curl -XPOST "$URL/meetings/demo/start" -H "authorization: Bearer $AUTH_TOKEN" \
     -H 'content-type: application/json' -d '{"meetingUrl":"<meet-link>"}'
   ```
   Expect `{ "botId": "...", "state": "in_meeting" }`. A Recall bot joins the meeting.
3. Watch: `curl "$URL/meetings/demo/stream" -H "authorization: Bearer $AUTH_TOKEN"`.
4. Speak in the meeting with ≥2 participants. Confirm `transcript.segment` events
   appear with `identityConfidence:"resolved"` and the correct `speaker.displayName`,
   plus `speaker.active` events on speech start/stop.
5. Roster: `curl "$URL/meetings/demo" -H "authorization: Bearer $AUTH_TOKEN"` lists participants.
6. Stop: `curl -XPOST "$URL/meetings/demo/stop" -H "authorization: Bearer $AUTH_TOKEN"`.
   The bot leaves; a `session.ended` event appears on the stream.
7. Replay: `curl "$URL/meetings/demo/transcript?since=0" -H "authorization: Bearer $AUTH_TOKEN"`.

## Live-verification points (confirm against current Recall docs during this run)
- Stop-bot endpoint path (`/api/v1/bot/{id}/leave_call/`).
- That `transcript.data` `words[].start_timestamp.relative` are seconds (drives absolute time).
- Webhook signature header names for your workspace (webhook-* vs svix-* for legacy workspaces).
```

- [ ] **Step 3: Commit**

```bash
git add apps/meet-agent/README.md apps/meet-agent/SMOKE.md
git commit -m "docs(meet-agent): Recall deploy + smoke checklist"
```

---

## Self-Review

**Spec coverage:**
- §3 Create Bot / provider / events / verification / regions → Tasks 4 (client), 2 (verify), 3 (map), 9 (config).
- §5 topology (Worker + DO, webhook receiver) → Tasks 6, 7.
- §6 event mapping (all 6 events + session.started/ended) → Task 3 (map) + Task 6 (session.started on /start, session.ended on /stop).
- §7 API routes (control + webhook, bearer vs HMAC) → Task 7 (routing), Task 6 (handlers).
- §8 error handling (401 on bad HMAC, dedupe on webhook-id, null participant → unresolved, Portal best-effort, malformed → 2xx) → Tasks 2/3/5/6.
- §9 testing (verify, map, webhook, client unit; smoke) → Tasks 2–5, 9.
- Contract `speaker.active` addition → Task 1.
- Cleanup of the superseded v2 stack → Task 8.

**Deferred (documented, not placeholders):** DO SQLite persistence (in-memory buffer only), SSE subscription teardown on disconnect, and `t0` persistence across DO eviction are called out inline (Task 6) and in the spec §10. The stop-bot endpoint, timestamp units, and legacy webhook header names are live-verification points listed in `SMOKE.md` (Task 9).

**Placeholder scan:** every code step is concrete; the only "confirm live" notes are external-API facts (Recall stop endpoint, timestamp units) isolated in `client.ts`/`SMOKE.md`.

**Type consistency:** `AgentEvent`, `Participant`, `SpeakerRef`, `MapCtx`, `Publisher`, `EventBuffer`, `handleRecallWebhook`, `createRecallBot`/`stopRecallBot`/`RECALL_EVENTS`, `verifyRecallSignature`, `Env`, `routeRequest`/`RouteDeps` are used consistently across Tasks 1–9. The DO reads `x-meeting-id` (set by the router in Task 7) and forwards pathnames the DO switches on (`/start`,`/stop`,`/state`,`/transcript`,`/stream`,`/webhook`).
