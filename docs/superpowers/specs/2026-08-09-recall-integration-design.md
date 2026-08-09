# Meet Transcription Agent — Design Spec (v3: Recall.ai)

**Date:** 2026-08-09
**Status:** Approved direction, pending implementation plan
**Supersedes:** `2026-08-08-meet-agent-design.md` (v2 participant bot). See §2 for why.
**Scope:** Real-time transcription with participant identification for Google Meet, via Recall.ai. AI note generation and canvas rendering remain out of scope for this phase.

## 1. Goal

Given a meeting URL, dispatch a Recall.ai bot to join and transcribe the meeting, receive live speaker-attributed transcript events over a webhook, normalize them into our event contract, and publish to:

1. A Portal (useportal.co) realtime channel, consumed by the collaborative canvas (teammate — out of scope here).
2. A REST/SSE testing API.

## 2. Why Recall.ai (pivot from the v2 participant bot)

The v2 design (headless Chromium joins Meet as a guest, scrapes the DOM, captures tab audio, streams to AssemblyAI) was built and unit-tested, then verified live against `meet.google.com` with Playwright. Findings that killed it:

- **Google anti-bot blocks anonymous automated joins.** Pre-join shows *"System info will be sent to confirm you're not a bot"* + reCAPTCHA; anonymous headless joins were rejected before reaching admission.
- **Meet exposes no `<audio>`/`<video>` DOM elements for remote audio** (`document.querySelectorAll("audio,video")` returned 0 in a live meeting) — remote audio is routed through an internal WebRTC `AudioContext`, so the v2 tab-capture approach had nothing to capture.
- **The active-speaker indicator uses obfuscated CSS with no stable marker**, and doesn't animate without a decoded audio stream — speaker attribution degraded to `unresolved`.

Recall.ai is a managed meeting-bot API that solves all three: it operates the bot (handles anti-bot), extracts audio, runs streaming STT, and delivers **speaker-attributed** transcript utterances plus participant/speech events in real time. Our system becomes a thin normalization layer, which fits Cloudflare Workers cleanly.

What survives from v2: the event **contract** (`contract/events.ts`), the **EventBuffer** (SSE), the **Portal publisher**, and the **testing API** shape. What is deleted: Playwright, the `meet-ui-adapter`, the identity correlator, the AssemblyAI parser/bridge, the `MeetSession` browser orchestrator, and the segment reducer's diarization role.

## 3. Verified Recall.ai facts (from docs, 2026-08-09)

- **Create Bot:** `POST https://<region>.recall.ai/api/v1/bot/` with `Authorization: <API_KEY>` (no `Bearer` prefix), body `{ meeting_url, recording_config: { transcript: { provider }, realtime_endpoints: [...] } }`.
- **Regions** (separate deployments, region-local credentials): `us-west-2`, `us-east-1`, `eu-central-1`, `ap-northeast-1`. `api.recall.ai` == `us-east-1`.
- **Real-time transport:** webhook (`type: "webhook"`, HTTP POST to your `url`) or websocket (`type: "websocket"`, `wss://`). We use **webhook** — simplest fit for a Cloudflare Worker (receive POST, return 2xx).
- **Transcription provider:** set `recording_config.transcript.provider`. We use `recallai_streaming` (`mode: "prioritize_low_latency"`) — no extra STT key, low latency. AssemblyAI-via-Recall (`assembly_ai_v3_streaming`) is a config swap if wanted later.
- **Required for live transcripts:** both `transcript.provider` AND a `realtime_endpoints` entry listing `transcript.data`. Missing either → no utterances.
- **Events we subscribe to (6):** `transcript.data`, `participant_events.join`, `participant_events.leave`, `participant_events.update`, `participant_events.speech_on`, `participant_events.speech_off`.
- **Confirmed config:** region `us-west-2`, provider `recallai_streaming` (`mode: "prioritize_low_latency"`), transport **webhook**.
- **`transcript.data` payload** (`data.data`): `words: [{text, start_timestamp:{relative}, end_timestamp:{relative}|null}]`, `language_code`, `participant: {id:int, name:string|null, is_host, platform, email}`. **Speaker is already attributed** — no diarization/correlation needed.
- **`participant_events.*` payload** (`data.data`): `participant {id, name, is_host, platform, email}`, `timestamp: {absolute: ISO8601, relative: float}`.
- **Verification:** with a workspace verification secret (`whsec_...`), every request carries `webhook-id`, `webhook-timestamp`, `webhook-signature` headers. Signature = base64 HMAC-SHA256 over `"{id}.{timestamp}.{rawBody}"`, key = base64-decoded secret body. `webhook-signature` is space-separated `v1,<sig>` entries; accept if any matches (constant-time compare).
- **Timestamps:** `transcript.data` gives **relative** floats (seconds from recording start) only — no absolute. We derive absolute by anchoring to a session `t0` captured when the bot starts recording. `participant_events.*` carry `timestamp.absolute` directly.
- **Retry:** failed webhook deliveries retried up to 60× at 1s fixed interval, then the endpoint is marked `failed`. Return 2xx fast; process async.
- **`recording_id` caveat:** on `transcript.data` via webhook the `recording_id` is a zero-UUID; to correlate to our meeting, pass our own id as a **query param** on the webhook URL (Recall calls the exact URL including query string; requires a trailing `/` before the `?`).

## 4. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Bot/audio/STT | Recall.ai managed | Solves anti-bot, audio extraction, STT, and speaker attribution |
| Transport | Webhook (HTTP POST) | Simplest on Cloudflare Workers; websocket is a later option |
| STT provider | `recallai_streaming` (low latency) | No extra key; provider swap is one config field |
| Public endpoint | Cloudflare Worker | Already the entrypoint; public HTTPS URL, HMAC verify, forward |
| Meeting correlation | our `meetingId` as webhook URL query param | `recording_id` is zero-UUID on webhook `transcript.data` |
| Identity | `resolved` (Recall gives `participant.name`) | Strong attribution — the contract already models this |
| Verification | WebCrypto HMAC-SHA256 (Worker runtime) | Node `crypto` from the docs adapted to `crypto.subtle` |
| Persistence | in-memory EventBuffer for MVP (SSE + `/transcript`) | DO SQLite is a documented follow-up, same as v2 |
| Repo layout | reuse `apps/meet-agent/`, add `recall/` module; retire the browser modules | Keeps contract/buffer/portal; drops Playwright deps |

## 5. Topology

```text
apps/meet-agent/
├─ worker/worker.ts              # Worker: control API + Recall webhook receiver + MeetingAgent DO
├─ container/src/
│  ├─ contract/events.ts         # SURVIVES (minor: speaker resolved)
│  ├─ emit/buffer.ts             # SURVIVES
│  ├─ emit/portal.ts             # SURVIVES
│  └─ recall/
│     ├─ client.ts               # createBot(meetingUrl, opts) → Recall POST /api/v1/bot/
│     ├─ verify.ts               # verifyRecallSignature(secret, headers, rawBody) via WebCrypto
│     └─ map.ts                  # mapRecallEvent(payload, ctx) → AgentEvent[]
└─ (DELETED) meet/, meet-ui-adapter/, identity/, stt/, segments/
```

There is no long-lived container or browser anymore. The Worker/DO is the whole runtime:

```text
POST /meetings/:id/start {meetingUrl}
   → Worker → recall/client.createBot(meetingUrl, webhookUrl=".../webhooks/recall/:id/")
   → Recall dispatches its bot, joins the meeting, starts recording + STT

Recall → POST /webhooks/recall/:id/   (transcript.data, participant_events.*)
   → verify HMAC (reject if invalid) → return 2xx immediately
   → map payload → AgentEvent[] → fan-out:
       1. EventBuffer (SSE + GET /transcript)
       2. Portal channel meeting-{id}
   (DO SQLite persistence: documented follow-up)
```

## 6. Event mapping (Recall → our contract)

The contract types (`Participant`, `TranscriptSegment`, `AgentEvent`) are unchanged in shape. Mapping rules:

| Recall event | Our event |
|---|---|
| `transcript.data` | `transcript.segment` — `text` = `words.map(w=>w.text).join(" ")`; `speaker` = `{participantId: String(participant.id), displayName: participant.name ?? undefined}`; `identityConfidence: "resolved"`; `startedAt`/`endedAt` = ISO from `t0 + relative*1000`; `isFinal: true`; `segmentId` = generated (nanoid) |
| `transcript.partial_data` (optional, phase 2) | `transcript.segment` with `isFinal:false` — deferred; MVP consumes finals only |
| `participant_events.join` | `participant.joined` — `participant` from payload, `at` = `timestamp.absolute` |
| `participant_events.leave` | `participant.left` — `participantId` = `String(participant.id)`, `at` = `timestamp.absolute` |
| `participant_events.update` | `participant.joined` again (idempotent upsert of the same participant, now with email/updated fields) — consumers treat a repeat `participant.joined` as an upsert by `participantId` |
| `participant_events.speech_on`/`speech_off` | `speaker.active` — `{type:"speaker.active", participantId, active:boolean, at}` — the live active-speaker signal we could not scrape from the DOM, now resolved by Recall |
| bot start-of-recording (session t0 established) | `session.started` |
| bot leaves / meeting ends | `session.ended` |

`resolved` (unused by v2) is now the primary identity level. `unresolved` remains only for a `transcript.data` with a null participant.

The contract gains one new `AgentEvent` variant, `speaker.active` (`{type, participantId, active, at}`), additive to the existing five. All other contract shapes are unchanged.

## 7. Testing API (Worker routes)

```text
POST /meetings/:id/start        { meetingUrl }   creates a Recall bot pointed at our webhook
POST /meetings/:id/stop                          stops the Recall bot (Recall stop-bot API)
GET  /meetings/:id                               session state + known participants
GET  /meetings/:id/transcript?since=<cursor>     paginated segments (EventBuffer)
GET  /meetings/:id/stream                        SSE live feed
POST /webhooks/recall/:id/                       Recall → us (HMAC-verified; not bearer-authed)
```

Control routes (`/meetings/*`) use the shared bearer token. The webhook route uses **HMAC verification only** (Recall can't send our bearer). Note the trailing `/` on the webhook path before Recall appends its own query params.

Secrets (Cloudflare secrets, never in code): `AUTH_TOKEN`, `RECALL_API_KEY`, `RECALL_REGION`, `RECALL_WEBHOOK_SECRET` (`whsec_...`), `PORTAL_API_KEY`, `PUBLIC_BASE_URL`.

## 8. Error handling

| Failure | Behavior |
|---|---|
| Invalid/missing HMAC on webhook | 401, drop the event (never process unverified) |
| Recall create-bot fails (bad URL, quota) | `/start` returns the Recall error; no session created |
| `transcript.data` with null participant | segment emitted with `speaker: {kind:"unresolved"}`, `identityConfidence:"unresolved"` — transcription still flows |
| Portal publish fails | best-effort: log + continue; SSE remains the reliable feed (invariant preserved) |
| Duplicate webhook (Recall retry) | dedupe on `webhook-id`; already-seen id → 2xx, no re-emit |
| Malformed payload | 2xx (so Recall doesn't hammer retries) + log; emit nothing |

Graceful-degradation invariant carries over: a Portal outage or a null participant never stops transcript flow to the SSE/API feed.

## 9. Testing strategy

- **Unit (Vitest):** HMAC verify (valid sig passes, tampered body / wrong secret / missing header fails, constant-time path); `mapRecallEvent` for each event type against recorded fixture payloads (from the doc schemas); EventBuffer (carried over); Portal publisher no-throw (carried over).
- **Integration (local):** feed recorded Recall webhook JSON to the Worker route with a correctly-signed header; assert `transcript.segment` events appear on `/stream` and `/transcript`.
- **Manual E2E:** real meeting URL + Recall API key; `POST /meetings/:id/start`; confirm bot joins, `transcript.data` arrives with `identityConfidence:"resolved"` and the correct name, `/stream` shows segments, `/stop` ends it. Requires a public URL for the webhook (Cloudflare deploy, or a tunnel for local).

## 10. Accepted risks / open items

1. **Recall is paid** — every meeting-minute bills. Fine for demos; watch quota.
2. **Public webhook URL required** — Recall must reach us. Production: `wrangler deploy` gives a public Worker URL. Local dev: a tunnel (cloudflared/ngrok) or deploy to a preview.
3. **Absolute timestamps** derive from a session `t0`; if `t0` is mis-anchored, segment times drift. `participant_events` absolute timestamps can cross-check.
4. **DO SQLite persistence** deferred (same as v2) — `/transcript` serves the in-memory buffer; lost on Worker/DO eviction.
5. **Webhook verification for legacy workspaces** (created before 2025-12-15) may use separate Svix secrets — the verify helper accepts both `webhook-*` and `svix-*` header names.
6. **Meeting platform differences** in `speech_on/off` behavior (per Recall's Speaker Timelines docs) — not load-bearing for MVP since attribution comes from `transcript.data` directly.

## 11. Out of scope (this phase)

- AI note/diagram generation (phase 2: Gemini structured output).
- Canvas implementation and Portal channel consumption (teammate).
- Partial-transcript (`transcript.partial_data`) live-caption UX.
- Audio/video buffer events, screenshare, chat.
- Websocket transport (webhook only for MVP).
