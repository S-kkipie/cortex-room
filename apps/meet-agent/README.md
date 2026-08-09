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
wrangler secret put PORTAL_API_KEY        # Portal publishable key (pk_...)
wrangler secret put PORTAL_SECRET_KEY     # Portal secret key (sk_...) to mint the bot's room token
wrangler secret put GEMINI_API_KEY        # Gemini API key for AI note extraction
```

`RECALL_REGION` (`us-west-2`) and `PUBLIC_BASE_URL` are `vars` in `wrangler.jsonc`;
set `PUBLIC_BASE_URL` to the deployed Worker URL so Recall can reach the webhook.

## Deploy

```bash
wrangler deploy
```

## Control API (bearer-authed)

```text
POST /meetings/:id/start      { "meetingUrl": "https://meet.google.com/xxx", "canvasProjectId": "99999999-9999-4999-8999-999999999999" }
POST /meetings/:id/stop
GET  /meetings/:id            → { state, participants }
GET  /meetings/:id/transcript?since=<cursor>
GET  /meetings/:id/stream     → SSE
POST /webhooks/recall/:id/    ← Recall (HMAC-verified, not bearer)
```

`canvasProjectId` is optional on `/start` and, when present, must be a UUID (the canvas wire contract requires it) — a non-UUID value is rejected with 400. If provided, the agent extracts AI notes and publishes them as sticky notes to Portal channel `room-{projectId}`. If omitted, behavior stays back-compat as transcription-only. Note that AI note publishing is best-effort and is currently not persisted (Portal-only) until a dedicated canvas-mutation service is in place.
