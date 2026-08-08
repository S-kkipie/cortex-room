# Meet Transcription Agent — Design Spec

**Date:** 2026-08-08
**Status:** Approved design, pending implementation plan
**Scope:** Real-time transcription agent for Google Meet with participant identification. AI note generation and canvas operations are explicitly out of scope for this phase.

## 1. Goal

A service that connects to a Google Meet conference, consumes real-time audio via the Google Meet Media API, transcribes it with streaming speech-to-text, attributes each utterance to a participant, and publishes structured transcript events to:

1. A Portal (useportal.co) realtime channel, consumed by the collaborative canvas (owned by a teammate — out of scope here).
2. A REST/SSE testing API for direct inspection.

## 2. Context and constraints (verified against Google docs)

- **Meet Media API is in Google Workspace Developer Preview.** The GCP project, the OAuth principal, and **all meeting participants** must be enrolled in the Developer Preview Program. This limits the MVP to controlled demos with enrolled accounts.
- The API delivers **raw media over WebRTC** (SDP offer/answer, ICE, RTP, data channels). Audio codec is **Opus**; the offer must include exactly 3 receive-only audio media descriptions. It does **not** provide transcription.
- Clients must support video codecs (VP8, VP9, AV1) and specific RTP header extensions even for audio-focused use, and Google recommends `libwebrtc` no more than 12 months behind Chromium STABLE. Minimum bandwidth 4 Mbps.
- Each participant is assigned a unique **CSRC** on join; the CSRC in each RTP packet header identifies the true source. Participant metadata is delivered over data channels. The `ssrc-audio-level` header extension is required, which gives per-packet speaker activity.
- Only **one Media API client** may connect to a conference at a time.
- Google's **TypeScript reference client runs in a browser** (requires Chrome ≥ 94, webpack, OAuth implicit flow). The C++ reference client ships a Dockerfile.
- Connection is refused for: encrypted/watermarked meetings, meetings with underage accounts, some consumer-owned meetings, or when the host disables access (`DISABLED_BY_ADMIN`). Consent dialog must be accepted by host/co-host/org participant.
- OAuth scopes: `meetings.conference.media.audio.readonly` (audio-only) + `meetings.space.read` for metadata.
- Meet REST API transcripts exist but are **post-meeting only** — rejected as primary source because the product requires live canvas updates.

## 3. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Media source | Meet Media API (real-time) | Live canvas is the product vision; REST transcripts are post-meeting only |
| STT | AssemblyAI streaming (WebSocket) | User choice; streaming latency acceptable, decent Spanish |
| LLM | None in this phase | Scope cut by user. Phase 2 will use Gemini (user has API credits) |
| Hosting | Cloudflare Workers + Durable Objects + Containers | User choice. Container is mandatory (WebRTC needs full networking); Worker/DO are the platform-imposed entrypoint (~30 lines) |
| Meet client runtime | Headless Chromium (Playwright) inside the container running Google's TS reference client | TS client is browser-only; Chromium satisfies codec/header-extension requirements for free; keeps the stack TypeScript. C++ client is the fallback if this proves unworkable |
| Canvas transport | Portal channel `meeting-{id}` | Teammate's canvas already uses Portal. Portal SDK is client-only by design; if publishing from Node fails, canvas falls back to our SSE endpoint |
| Repo layout | Monorepo `apps/meet-agent/` inside cortex-room | Shares zod types with the existing app; event contract exported as a shared package |

Portal cannot host the agent: `@portalsdk/core` is a client-only WebSocket SDK (channels, presence, inbox) with server-side config limited to authz/middleware. It is transport, not compute.

A plain Cloudflare Worker cannot run the agent: no UDP/ICE, no WebRTC stack, CPU limits. Cloudflare **Containers** provide a long-lived process with full networking, orchestrated by a Durable Object, with scale-to-zero billing (Workers Paid $5/mo; a 1h meeting on a `basic` instance costs cents).

## 4. Topology

```text
cortex-room (monorepo)
├─ src/...                        # existing Next.js/Elysia app (unchanged)
└─ apps/meet-agent/
   ├─ worker/                     # wrangler.jsonc + worker.ts
   │   └─ MeetingAgent extends Container  # DO class wrapping the container
   └─ container/                  # Dockerfile: Node 22 + Chromium (Playwright)
       ├─ src/main.ts             # orchestrator + local HTTP server (port 8080)
       ├─ src/meet/               # Playwright harness + Google TS reference client
       ├─ src/stt/                # AssemblyAI streaming bridge
       ├─ src/identity/           # CSRC → participant mapping
       └─ src/emit/               # Portal publisher + segment buffer
```

- **1 meeting = 1 Durable Object = 1 container instance** (`idFromName(meetingId)`).
- `sleepAfter: "5m"` — container sleeps after the meeting ends; charges stop.
- The DO persists transcript segments in its SQLite storage (free replay, survives container restarts).
- The Worker is a thin HTTP router that proxies to the right DO.

## 5. Data flow

```text
POST /meetings/:id/start {meetCode}
  → Worker → DO(meetingId) → container.start()
  → container boots headless Chromium, loads Meet TS client with injected OAuth token
  → Meet client: SDP offer → consent granted → STATE_JOINED
  → audio frames + CSRC + participant metadata bridged from page to Node
      (page.exposeFunction / CDP)
  → Node: single mixed audio stream → AssemblyAI WS
      active speaker resolved per utterance via ssrc-audio-level + CSRC map
  → final utterance → TranscriptSegment
  → fan-out to 3 sinks:
      1. DO SQLite (canonical store, replay)
      2. Portal channel meeting-{id}
      3. in-memory buffer for GET /transcript + SSE
```

**Identity resolution.** The container maintains `Map<csrc, Participant>` built from participant metadata events. Each segment ships with the resolved speaker or an `unresolved` marker; late resolution re-emits the same `segmentId` as an upsert.

## 6. Event contract (v0)

Zod schemas live in a shared package imported by both the agent and (eventually) the canvas.

```ts
type Participant = {
  participantId: string;
  displayName?: string;
  csrc?: number;
};

type TranscriptSegment = {
  segmentId: string;          // stable — re-emission = upsert
  meetingId: string;
  speaker: Participant | { kind: "unresolved"; csrc?: number };
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

Two separate confidence dimensions: transcription accuracy and speaker identity. Downstream consumers must not collapse "possibly Diego" into "Diego said X".

## 7. Testing API (Worker routes)

```text
POST /meetings/:id/start        { meetCode }         start a session
POST /meetings/:id/stop                              stop it
GET  /meetings/:id                                   session state + participants
GET  /meetings/:id/transcript?since=<cursor>         paginated segments (from DO SQLite)
GET  /meetings/:id/stream                            SSE live feed (Portal fallback)
```

Auth: single shared bearer token (hackathon-grade).

## 8. Error handling

| Failure | Behavior |
|---|---|
| Chromium crash / WebRTC drop | DO restarts container, reconnects, emits `session.started {resumed: true}`. Transcript intact in SQLite. |
| AssemblyAI WS drop | Reconnect with backoff; ~10 s in-memory audio buffer; longer loss → next segment marked `gap: true` |
| CSRC with no metadata yet | Emit `unresolved`; upsert the segment when identity arrives |
| Meet refuses connection (`DISABLED_BY_ADMIN`, `NO_ACTIVE_CONFERENCE`, …) | `session.ended` with `reason` set to the error code |
| Portal publish fails | Log + continue; SSE endpoint remains the reliable feed |

## 9. Testing strategy

- **Unit (Vitest):** CSRC→participant mapper, segment reducer/upsert logic, AssemblyAI event parser (recorded fixtures).
- **Integration:** container pipeline fed a WAV fixture through the STT bridge — no Meet dependency.
- **E2E (manual):** real meeting with Preview-enrolled accounts; checklist: join, consent, ≥2 speakers correctly attributed, reconnect mid-meeting, stop.

## 10. Accepted risks / open items

1. **Developer Preview enrollment** (GCP project + every participant) — administrative blocker for any real demo; start the enrollment immediately.
2. **OAuth in headless Chromium:** the reference client uses the implicit flow interactively; we will inject a server-side-obtained access token (refresh-token flow) into the page. Mechanics resolved during implementation.
3. **Portal publish from Node:** SDK targets browsers; Node ≥ 22 has native WebSocket so it may work as-is. If not, canvas consumes our SSE endpoint until Portal exposes a server SDK.
4. **Audio bridge performance:** shuttling PCM from the page to Node via CDP may need tuning (chunk size, transfer encoding). Fallback: capture via Chromium's `--use-file-for-fake-audio-capture` alternatives or move to the C++ client.

## 11. Out of scope (this phase)

- AI note/diagram generation (phase 2: Gemini structured output).
- Canvas implementation and Portal channel consumption (teammate).
- Video/screen-share analysis, per-person agents, agent speaking in the meeting.
- Meetings outside the Developer Preview cohort.
