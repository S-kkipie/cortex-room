# Meet Transcription Agent — Design Spec (v2: participant bot)

**Date:** 2026-08-08
**Status:** Approved design, pending implementation plan
**Scope:** Real-time transcription agent for Google Meet with participant identification. AI note generation and canvas operations are explicitly out of scope for this phase.

## 1. Goal

A bot that joins a Google Meet conference as a regular participant, captures the meeting audio, transcribes it with streaming speech-to-text, attributes each utterance to a participant, and publishes structured transcript events to:

1. A Portal (useportal.co) realtime channel, consumed by the collaborative canvas (owned by a teammate — out of scope here).
2. A REST/SSE testing API for direct inspection.

## 2. Why a participant bot (and not the Meet Media API)

The Google Meet **Media API** was evaluated first (v1 of this spec). Verified blockers:

- It is in **Google Workspace Developer Preview**: the GCP project, OAuth principal, and **every meeting participant** must be enrolled, enrollment requires a Google Workspace account, and preview features "may not be included in public applications prior to the General Availability (GA) announcement".
- The team currently has **no Google Workspace account** (consumer gmail only), which makes enrollment impossible and blocks even a private demo.
- Meet REST API transcripts are post-meeting only — incompatible with a live canvas.

Therefore v2: a **headless-browser bot** that joins meet.google.com as an ordinary guest. Works with any gmail account, no enrollment, publishable now. Trade-offs are accepted and listed in §10. The event contract is source-agnostic, so a future migration back to the Media API (at GA, or once Workspace exists) only replaces the capture module (`src/meet/`).

## 3. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Meeting access | Headless Chromium (Playwright) joins as guest participant "Cortex Notetaker"; host admits it manually | No Workspace/Preview requirements; publishable now |
| Audio capture | Tab audio capture (mixed stream) inside Chromium | Only audio surface available to a participant bot |
| Speaker identity | AssemblyAI diarization × DOM active-speaker indicator, correlated by time | Best available substitute for the Media API's CSRC attribution |
| STT | AssemblyAI streaming (WebSocket) | User choice; streaming + diarization; decent Spanish |
| LLM | None in this phase | Scope cut by user. Phase 2: Gemini structured output (user has API credits) |
| Hosting | Cloudflare Workers + Durable Objects + Containers | User choice. Container is mandatory (Chromium + long-lived process); Worker/DO are the platform-imposed entrypoint (~30 lines) |
| Canvas transport | Portal channel `meeting-{id}` | Teammate's canvas uses Portal. SDK is client-only; if Node publishing fails, canvas falls back to our SSE endpoint |
| Repo layout | Monorepo `apps/meet-agent/` inside cortex-room | Shares zod types with the existing app; event contract exported as a shared package |

Portal cannot host the agent: `@portalsdk/core` is a client-only WebSocket SDK (channels, presence, inbox) with server-side config limited to authz/middleware. It is transport, not compute.

A plain Cloudflare Worker cannot run the bot: no Chromium, no long-lived process, CPU limits. Cloudflare **Containers** provide a long-lived process orchestrated by a Durable Object, with scale-to-zero billing (Workers Paid $5/mo; a 1h meeting on a `basic` instance costs cents).

## 4. Topology

```text
cortex-room (monorepo)
├─ src/...                        # existing Next.js/Elysia app (unchanged)
└─ apps/meet-agent/
   ├─ worker/                     # wrangler.jsonc + worker.ts
   │   └─ MeetingAgent extends Container  # DO class wrapping the container
   └─ container/                  # Dockerfile: Node 22 + Chromium (Playwright)
       ├─ src/main.ts             # orchestrator + local HTTP server (port 8080)
       ├─ src/meet/               # Playwright harness: join flow, audio capture
       ├─ src/meet-ui-adapter/    # ALL Meet DOM selectors centralized here
       ├─ src/stt/                # AssemblyAI streaming bridge (+ diarization)
       ├─ src/identity/           # diarized speaker × active-speaker correlation
       └─ src/emit/               # Portal publisher + segment buffer
```

- **1 meeting = 1 Durable Object = 1 container instance** (`idFromName(meetingId)`).
- `sleepAfter: "5m"` — container sleeps after the meeting ends; charges stop.
- The DO persists transcript segments in its SQLite storage (free replay, survives container restarts).
- The Worker is a thin HTTP router that proxies to the right DO.

## 5. Data flow

```text
POST /meetings/:id/start {meetUrl}
  → Worker → DO(meetingId) → container.start()
  → container boots headless Chromium
  → Playwright: open meetUrl → set name "Cortex Notetaker" → "Ask to join"
  → host admits bot → in-meeting
  → two parallel observers:
      A) tab audio capture → PCM chunks → AssemblyAI WS (diarization on)
      B) DOM observer (meet-ui-adapter):
           - participant roster (joins/leaves)
           - active-speaker indicator per tile, timestamped
  → final utterance from AssemblyAI (speaker label + t0..t1)
  → identity module: overlap utterance window with active-speaker timeline
      → speaker resolved (inferred) | unresolved
  → TranscriptSegment → fan-out to 3 sinks:
      1. DO SQLite (canonical store, replay)
      2. Portal channel meeting-{id}
      3. in-memory buffer for GET /transcript + SSE
```

**Identity correlation.** AssemblyAI labels voices (`speaker A/B/…`) on the mixed stream. The DOM observer records `[t0, t1] → displayName` intervals for the active-speaker indicator. Overlapping the two yields `diarizedSpeaker → displayName` mappings that strengthen with each agreement. Overlapping speech or ambiguous indicators degrade to `unresolved`. Late resolution re-emits the same `segmentId` as an upsert.

## 6. Event contract (v0)

Zod schemas live in a shared package imported by both the agent and (eventually) the canvas. Contract is capture-source-agnostic.

```ts
type Participant = {
  participantId: string;      // stable per meeting (derived from roster identity)
  displayName?: string;
};

type TranscriptSegment = {
  segmentId: string;          // stable — re-emission = upsert
  meetingId: string;
  speaker: Participant | { kind: "unresolved"; diarizedLabel?: string };
  text: string;
  startedAt: string;          // ISO 8601
  endedAt: string;
  isFinal: boolean;
  transcriptionConfidence?: number;
  identityConfidence: "resolved" | "inferred" | "unresolved";
  gap?: boolean;              // true if preceded by lost audio
};

type AgentEvent =
  | { type: "session.started"; meetingId: string; at: string; resumed?: boolean }
  | { type: "session.ended"; meetingId: string; at: string; reason: string }
  | { type: "participant.joined"; participant: Participant; at: string }
  | { type: "participant.left"; participantId: string; at: string }
  | { type: "transcript.segment"; segment: TranscriptSegment };
```

Two separate confidence dimensions: transcription accuracy and speaker identity. Downstream consumers must not collapse "possibly Diego" into "Diego said X". With this capture method, `resolved` is reserved for future sources (Media API); the bot emits at best `inferred`.

## 7. Testing API (Worker routes)

```text
POST /meetings/:id/start        { meetUrl }          start a session (bot requests to join)
POST /meetings/:id/stop                              bot leaves, session ends
GET  /meetings/:id                                   session state + participants
GET  /meetings/:id/transcript?since=<cursor>         paginated segments (from DO SQLite)
GET  /meetings/:id/stream                            SSE live feed (Portal fallback)
```

Auth: single shared bearer token (hackathon-grade).

Session states: `starting → waiting_admission → in_meeting → ended(reason)`. `waiting_admission` times out (default 3 min) → `ended("admission_timeout")`.

## 8. Error handling

| Failure | Behavior |
|---|---|
| Host never admits the bot | `ended("admission_timeout")` after 3 min |
| Bot ejected / meeting ends | `session.ended` with reason (`removed`, `meeting_ended`) |
| Chromium crash | DO restarts container; bot re-requests admission; emits `session.started {resumed: true}`. Transcript intact in SQLite |
| AssemblyAI WS drop | Reconnect with backoff; ~10 s in-memory audio buffer; longer loss → next segment marked `gap: true` |
| Meet UI change breaks a selector | `meet-ui-adapter` throws typed error → identity degrades to `unresolved` (transcription continues); roster loss logged loudly |
| Ambiguous/overlapping speakers | Segment emitted as `unresolved` |
| Portal publish fails | Log + continue; SSE endpoint remains the reliable feed |

Graceful degradation principle: **audio → transcript must survive even if all DOM scraping breaks.** Identity is best-effort on top.

## 9. Testing strategy

- **Unit (Vitest):** identity correlator (diarization intervals × active-speaker intervals, fixtures), segment reducer/upsert, AssemblyAI event parser (recorded fixtures).
- **Integration:** container pipeline fed a WAV fixture through the STT bridge — no Meet dependency.
- **Selector smoke test:** headless Chromium against a real Meet lobby page; asserts `meet-ui-adapter` selectors still match (run manually / on demand, since it needs a live meeting).
- **E2E (manual):** real meeting, checklist: bot requests admission, admitted, ≥2 speakers attributed `inferred`, reconnect mid-meeting, stop, replay via API.

## 10. Accepted risks / open items

1. **Meet UI fragility:** selectors break without notice. Mitigation: all selectors in `meet-ui-adapter`, typed failures, graceful degradation to transcript-only.
2. **ToS gray area:** Google does not sanction scraper bots; this is the same mechanism used by mainstream notetakers. Accepted for hackathon use.
3. **Manual admission:** host must admit the bot every meeting. Accepted UX cost.
4. **Headless tab-audio capture mechanics:** requires Chromium flags (e.g. auto-accept tab capture) or an extension loaded via Playwright; exact mechanism resolved during implementation.
5. **Identity ceiling:** temporal correlation can misattribute during rapid exchanges or overlap; the contract exposes this honestly via `identityConfidence`.
6. **Portal publish from Node:** SDK targets browsers; Node ≥ 22 native WebSocket may work as-is. If not, canvas consumes our SSE endpoint until Portal exposes a server SDK.
7. **Future migration:** at Media API GA (or once a Workspace account exists), swap `src/meet/` + `src/identity/` for the CSRC-based implementation; contract and everything downstream unchanged.

## 11. Out of scope (this phase)

- AI note/diagram generation (phase 2: Gemini structured output).
- Canvas implementation and Portal channel consumption (teammate).
- Video/screen-share analysis, per-person agents, bot speaking in the meeting.
- Recording/storing raw audio (transcript only).
