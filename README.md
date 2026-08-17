# Cortex Room

**Real-time meeting intelligence.** An AI bot joins your Google Meet, transcribes
the conversation live with speaker attribution, and turns it into structured
notes — streamed to your app as it happens.

## How it works

```
Google Meet
  └─ Recall.ai bot (dispatched by a Cloudflare Worker + Durable Object)
       └─ HMAC-verified real-time webhooks
            └─ speaker-attributed transcript events
                 ├─ Portal channel (live) + REST/SSE API
                 └─ Gemini: AI note extraction
                      └─ Cortex Room web app
```

The `MeetingAgent` Durable Object owns one meeting: it starts the bot, verifies
every webhook, buffers events for SSE, publishes to a Portal channel, and asks
Gemini to distill notes from the transcript.

## Monorepo

| Path | What | Stack |
|---|---|---|
| `apps/meet-agent` | The meeting agent | Cloudflare Worker + Durable Object · Recall.ai · Gemini · Zod event contract · SSE |
| `src` | Web app + API + auth | Next 16 · Elysia (`/api/v1`) · Better Auth · Drizzle + Postgres |

## Setup

```bash
pnpm install
cp .env.example .env            # DATABASE_URL, BETTER_AUTH_SECRET, NEXT_PUBLIC_APP_URL
pnpm dev                        # web app :3000
```

The agent's secrets (Recall, Portal, Gemini) are set with `wrangler secret put`
— see [`apps/meet-agent/README.md`](./apps/meet-agent/README.md) for the full
list and deploy steps, and [`apps/meet-agent/SMOKE.md`](./apps/meet-agent/SMOKE.md)
for the end-to-end checklist.

## Deploy

```bash
cd apps/meet-agent && wrangler deploy   # the meeting agent (Worker + DO)
# web: Vercel / Cloudflare
```
