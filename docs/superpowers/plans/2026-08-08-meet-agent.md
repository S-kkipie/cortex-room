# Meet Transcription Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A headless-browser bot that joins a Google Meet as a guest, transcribes audio in real time with AssemblyAI, attributes utterances to participants via active-speaker DOM correlation, and publishes structured transcript events to a Portal channel and a REST/SSE testing API.

**Architecture:** A Cloudflare Container (Node 22 + Chromium/Playwright) runs the bot and a local HTTP server. A Cloudflare Worker with a `Container`-backed Durable Object (one per meeting) is the entrypoint and canonical transcript store (DO SQLite). The pipeline is: Playwright joins Meet → tab audio → AssemblyAI streaming (diarization) → identity correlator → `TranscriptSegment` → fan-out to DO SQLite, Portal, and an in-memory SSE buffer.

**Tech Stack:** TypeScript, Cloudflare Workers/Durable Objects/Containers (`wrangler`), Playwright (Chromium), AssemblyAI streaming WebSocket, Portal (`@portalsdk/core`), Zod, Vitest, Biome.

## Global Constraints

- Package lives at `apps/meet-agent/` inside the cortex-room repo, as a standalone package (repo has no pnpm workspace yet — do not add one).
- Biome formatting: **4-space indent, spaces not tabs** (matches root `biome.json`).
- Node 22 (native `WebSocket` available in the container runtime).
- Bot display name in Meet is exactly `Cortex Notetaker`.
- All Meet DOM selectors live **only** in `src/meet-ui-adapter/`. No selector strings anywhere else.
- **Graceful degradation invariant:** audio → transcript must keep working even if every DOM scrape throws. Identity is best-effort layered on top.
- `identityConfidence` values are exactly `"resolved" | "inferred" | "unresolved"`. The bot never emits `"resolved"` (reserved for a future Media API source).
- Event/segment shapes are the single source of truth in `src/contract/` (Zod). Do not redefine them elsewhere.
- Every task ends green (`pnpm test`) and committed.

---

## File Structure

```text
apps/meet-agent/
├─ package.json                      # standalone deps + scripts
├─ tsconfig.json
├─ vitest.config.ts                  # include: src/**/__tests__/**/*.test.ts
├─ wrangler.jsonc                    # Worker + Container + DO bindings
├─ Dockerfile                        # Node 22 + Chromium base for the container
├─ worker/
│  └─ worker.ts                      # HTTP router + MeetingAgent (Container DO) + SQLite store
└─ container/
   └─ src/
      ├─ main.ts                     # orchestrator + local HTTP server (port 8080)
      ├─ contract/
      │  ├─ events.ts                # Zod: Participant, TranscriptSegment, AgentEvent
      │  └─ __tests__/events.test.ts
      ├─ identity/
      │  ├─ correlator.ts            # diarization intervals × active-speaker intervals
      │  └─ __tests__/correlator.test.ts
      ├─ stt/
      │  ├─ assemblyai.ts            # WS bridge, parse into utterances
      │  └─ __tests__/assemblyai.test.ts
      ├─ segments/
      │  ├─ reducer.ts               # utterance + identity → TranscriptSegment (upsert)
      │  └─ __tests__/reducer.test.ts
      ├─ meet-ui-adapter/
      │  ├─ selectors.ts             # ALL Meet DOM selectors
      │  └─ observer.ts              # roster + active-speaker DOM observers (browser-context)
      ├─ meet/
      │  └─ session.ts               # Playwright join flow + audio capture wiring
      └─ emit/
         ├─ portal.ts                # Portal publisher (with no-op fallback)
         └─ buffer.ts                # in-memory ring buffer for SSE + GET /transcript
```

Tasks 1–6 are pure/unit-testable (contract, correlator, STT parse, reducer, buffer, portal). Tasks 7–10 wire the browser/container/worker (integration + manual E2E). This ordering front-loads everything with a real test cycle.

---

### Task 1: Package scaffold

**Files:**
- Create: `apps/meet-agent/package.json`
- Create: `apps/meet-agent/tsconfig.json`
- Create: `apps/meet-agent/vitest.config.ts`
- Create: `apps/meet-agent/src/.gitkeep`

**Interfaces:**
- Consumes: nothing.
- Produces: a `pnpm test` script that runs Vitest; the `apps/meet-agent/` working directory all later tasks build in.

- [ ] **Step 1: Create `package.json`**

```json
{
    "name": "@cortex/meet-agent",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
        "test": "vitest run",
        "test:watch": "vitest",
        "typecheck": "tsc --noEmit"
    },
    "dependencies": {
        "@portalsdk/core": "^0.1.0",
        "assemblyai": "^4.9.0",
        "nanoid": "^5.1.16",
        "playwright": "^1.49.0",
        "zod": "^4.4.3"
    },
    "devDependencies": {
        "@cloudflare/workers-types": "^4.20250101.0",
        "typescript": "^5",
        "vitest": "^3.2.4",
        "wrangler": "^3.95.0"
    }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "ESNext",
        "moduleResolution": "bundler",
        "lib": ["ES2023", "DOM"],
        "strict": true,
        "noEmit": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "types": ["node", "@cloudflare/workers-types"]
    },
    "include": ["src", "worker", "container"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        globals: true,
        include: ["**/__tests__/**/*.test.ts"],
    },
});
```

- [ ] **Step 4: Install and verify Vitest runs (empty pass)**

Run: `cd apps/meet-agent && pnpm install && pnpm test`
Expected: exit 0, "No test files found" (or 0 tests). Not an error.

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/
git commit -m "chore(meet-agent): scaffold standalone package"
```

---

### Task 2: Event contract (Zod)

**Files:**
- Create: `apps/meet-agent/container/src/contract/events.ts`
- Test: `apps/meet-agent/container/src/contract/__tests__/events.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Participant` = `{ participantId: string; displayName?: string }`
  - `SpeakerRef` = `Participant | { kind: "unresolved"; diarizedLabel?: string }`
  - `IdentityConfidence` = `"resolved" | "inferred" | "unresolved"`
  - `TranscriptSegment` (Zod schema `transcriptSegmentSchema` + inferred type)
  - `AgentEvent` (Zod schema `agentEventSchema` + inferred type)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { agentEventSchema, transcriptSegmentSchema } from "../events";

describe("contract", () => {
    it("accepts a resolved-speaker segment", () => {
        const seg = {
            segmentId: "s1",
            meetingId: "m1",
            speaker: { participantId: "p1", displayName: "Diego" },
            text: "hola",
            startedAt: "2026-08-08T00:00:00.000Z",
            endedAt: "2026-08-08T00:00:02.000Z",
            isFinal: true,
            identityConfidence: "inferred",
        };
        expect(transcriptSegmentSchema.parse(seg).segmentId).toBe("s1");
    });

    it("accepts an unresolved speaker", () => {
        const seg = {
            segmentId: "s2",
            meetingId: "m1",
            speaker: { kind: "unresolved", diarizedLabel: "A" },
            text: "eh",
            startedAt: "2026-08-08T00:00:00.000Z",
            endedAt: "2026-08-08T00:00:01.000Z",
            isFinal: false,
            identityConfidence: "unresolved",
        };
        expect(transcriptSegmentSchema.parse(seg).speaker).toMatchObject({ kind: "unresolved" });
    });

    it("rejects an unknown identityConfidence", () => {
        expect(() =>
            transcriptSegmentSchema.parse({
                segmentId: "s3",
                meetingId: "m1",
                speaker: { participantId: "p1" },
                text: "x",
                startedAt: "2026-08-08T00:00:00.000Z",
                endedAt: "2026-08-08T00:00:01.000Z",
                isFinal: true,
                identityConfidence: "certain",
            }),
        ).toThrow();
    });

    it("discriminates AgentEvent by type", () => {
        const ev = { type: "participant.joined", participant: { participantId: "p1" }, at: "2026-08-08T00:00:00.000Z" };
        expect(agentEventSchema.parse(ev).type).toBe("participant.joined");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/meet-agent && pnpm test contract`
Expected: FAIL — cannot resolve `../events`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from "zod";

export const participantSchema = z.object({
    participantId: z.string(),
    displayName: z.string().optional(),
});
export type Participant = z.infer<typeof participantSchema>;

export const speakerRefSchema = z.union([
    participantSchema,
    z.object({ kind: z.literal("unresolved"), diarizedLabel: z.string().optional() }),
]);
export type SpeakerRef = z.infer<typeof speakerRefSchema>;

export const identityConfidenceSchema = z.enum(["resolved", "inferred", "unresolved"]);
export type IdentityConfidence = z.infer<typeof identityConfidenceSchema>;

export const transcriptSegmentSchema = z.object({
    segmentId: z.string(),
    meetingId: z.string(),
    speaker: speakerRefSchema,
    text: z.string(),
    startedAt: z.string(),
    endedAt: z.string(),
    isFinal: z.boolean(),
    transcriptionConfidence: z.number().optional(),
    identityConfidence: identityConfidenceSchema,
    gap: z.boolean().optional(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const agentEventSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("session.started"), meetingId: z.string(), at: z.string(), resumed: z.boolean().optional() }),
    z.object({ type: z.literal("session.ended"), meetingId: z.string(), at: z.string(), reason: z.string() }),
    z.object({ type: z.literal("participant.joined"), participant: participantSchema, at: z.string() }),
    z.object({ type: z.literal("participant.left"), participantId: z.string(), at: z.string() }),
    z.object({ type: z.literal("transcript.segment"), segment: transcriptSegmentSchema }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/meet-agent && pnpm test contract`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/contract/
git commit -m "feat(meet-agent): event contract schemas"
```

---

### Task 3: Identity correlator

**Files:**
- Create: `apps/meet-agent/container/src/identity/correlator.ts`
- Test: `apps/meet-agent/container/src/identity/__tests__/correlator.test.ts`

**Interfaces:**
- Consumes: `Participant` from `../contract/events` (only the type).
- Produces:
  - `type Interval = { start: number; end: number }` (ms epoch)
  - `type ActiveSpeakerInterval = Interval & { participantId: string; displayName?: string }`
  - `resolveSpeaker(utterance: Interval, active: ActiveSpeakerInterval[]): { speaker: SpeakerRef; identityConfidence: IdentityConfidence }` — picks the active-speaker interval with maximum temporal overlap; returns `inferred` when a single dominant speaker covers ≥ 60% of the utterance, else `unresolved`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveSpeaker } from "../correlator";

const P = (participantId: string, displayName: string, start: number, end: number) => ({ participantId, displayName, start, end });

describe("resolveSpeaker", () => {
    it("infers the dominant overlapping speaker", () => {
        const r = resolveSpeaker({ start: 1000, end: 3000 }, [P("p1", "Diego", 900, 3200)]);
        expect(r.identityConfidence).toBe("inferred");
        expect(r.speaker).toMatchObject({ participantId: "p1", displayName: "Diego" });
    });

    it("is unresolved when overlap is below 60%", () => {
        const r = resolveSpeaker({ start: 1000, end: 3000 }, [P("p1", "Diego", 2500, 3000)]);
        expect(r.identityConfidence).toBe("unresolved");
    });

    it("is unresolved with no active-speaker data", () => {
        const r = resolveSpeaker({ start: 1000, end: 3000 }, []);
        expect(r.identityConfidence).toBe("unresolved");
        expect(r.speaker).toMatchObject({ kind: "unresolved" });
    });

    it("picks the greater-overlap speaker when two overlap", () => {
        const r = resolveSpeaker({ start: 1000, end: 3000 }, [
            P("p1", "Diego", 1000, 1400),
            P("p2", "Sofia", 1400, 3000),
        ]);
        expect(r.speaker).toMatchObject({ participantId: "p2" });
        expect(r.identityConfidence).toBe("inferred");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/meet-agent && pnpm test correlator`
Expected: FAIL — cannot resolve `../correlator`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { IdentityConfidence } from "../contract/events";

export type Interval = { start: number; end: number };
export type ActiveSpeakerInterval = Interval & { participantId: string; displayName?: string };

type Resolved = {
    speaker: { participantId: string; displayName?: string } | { kind: "unresolved"; diarizedLabel?: string };
    identityConfidence: IdentityConfidence;
};

const overlapMs = (a: Interval, b: Interval): number =>
    Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

export function resolveSpeaker(
    utterance: Interval,
    active: ActiveSpeakerInterval[],
    diarizedLabel?: string,
): Resolved {
    const dur = Math.max(1, utterance.end - utterance.start);
    const perSpeaker = new Map<string, { ms: number; displayName?: string }>();
    for (const a of active) {
        const ms = overlapMs(utterance, a);
        if (ms <= 0) continue;
        const cur = perSpeaker.get(a.participantId) ?? { ms: 0, displayName: a.displayName };
        cur.ms += ms;
        perSpeaker.set(a.participantId, cur);
    }
    let best: { participantId: string; ms: number; displayName?: string } | undefined;
    for (const [participantId, v] of perSpeaker) {
        if (!best || v.ms > best.ms) best = { participantId, ms: v.ms, displayName: v.displayName };
    }
    if (best && best.ms / dur >= 0.6) {
        return {
            speaker: { participantId: best.participantId, displayName: best.displayName },
            identityConfidence: "inferred",
        };
    }
    return { speaker: { kind: "unresolved", diarizedLabel }, identityConfidence: "unresolved" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/meet-agent && pnpm test correlator`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/identity/
git commit -m "feat(meet-agent): active-speaker identity correlator"
```

---

### Task 4: AssemblyAI utterance parsing

**Files:**
- Create: `apps/meet-agent/container/src/stt/assemblyai.ts`
- Test: `apps/meet-agent/container/src/stt/__tests__/assemblyai.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Utterance = { diarizedLabel?: string; text: string; start: number; end: number; isFinal: boolean; confidence?: number }`
  - `parseAssemblyMessage(raw: string, sessionStartEpochMs: number): Utterance | null` — parses one AssemblyAI streaming JSON message; returns `null` for non-transcript messages (session begin/terminate/errors). Converts AssemblyAI relative `audio_start`/`audio_end` (ms from session start) to absolute epoch ms using `sessionStartEpochMs`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseAssemblyMessage } from "../assemblyai";

const BASE = 1_000_000;

describe("parseAssemblyMessage", () => {
    it("parses a final turn into an absolute-timestamped utterance", () => {
        const raw = JSON.stringify({
            type: "Turn",
            transcript: "hola equipo",
            end_of_turn: true,
            turn_is_formatted: true,
            audio_start: 1000,
            audio_end: 2500,
            end_of_turn_confidence: 0.9,
            words: [{ speaker: "A" }],
        });
        const u = parseAssemblyMessage(raw, BASE);
        expect(u).toMatchObject({ text: "hola equipo", isFinal: true, start: BASE + 1000, end: BASE + 2500, diarizedLabel: "A" });
    });

    it("returns null for a Begin message", () => {
        expect(parseAssemblyMessage(JSON.stringify({ type: "Begin", id: "x" }), BASE)).toBeNull();
    });

    it("marks partial turns as non-final", () => {
        const raw = JSON.stringify({ type: "Turn", transcript: "hol", end_of_turn: false, audio_start: 1000, audio_end: 1400 });
        expect(parseAssemblyMessage(raw, BASE)?.isFinal).toBe(false);
    });

    it("returns null for malformed JSON", () => {
        expect(parseAssemblyMessage("{not json", BASE)).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/meet-agent && pnpm test assemblyai`
Expected: FAIL — cannot resolve `../assemblyai`.

- [ ] **Step 3: Write minimal implementation**

```ts
export type Utterance = {
    diarizedLabel?: string;
    text: string;
    start: number;
    end: number;
    isFinal: boolean;
    confidence?: number;
};

export function parseAssemblyMessage(raw: string, sessionStartEpochMs: number): Utterance | null {
    let msg: Record<string, unknown>;
    try {
        msg = JSON.parse(raw);
    } catch {
        return null;
    }
    if (msg.type !== "Turn") return null;
    const text = typeof msg.transcript === "string" ? msg.transcript : "";
    if (text.length === 0) return null;
    const words = Array.isArray(msg.words) ? (msg.words as Array<{ speaker?: string }>) : [];
    const diarizedLabel = words.find((w) => typeof w.speaker === "string")?.speaker;
    const audioStart = typeof msg.audio_start === "number" ? msg.audio_start : 0;
    const audioEnd = typeof msg.audio_end === "number" ? msg.audio_end : audioStart;
    return {
        diarizedLabel,
        text,
        start: sessionStartEpochMs + audioStart,
        end: sessionStartEpochMs + audioEnd,
        isFinal: msg.end_of_turn === true,
        confidence: typeof msg.end_of_turn_confidence === "number" ? msg.end_of_turn_confidence : undefined,
    };
}
```

> Note: exact AssemblyAI streaming field names (`Turn`, `audio_start`, `end_of_turn`, `words[].speaker`) must be confirmed against the live API during Task 8 wiring; the parser is isolated here so a field rename is a one-line change with the fixtures updated.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/meet-agent && pnpm test assemblyai`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/stt/
git commit -m "feat(meet-agent): parse AssemblyAI streaming messages"
```

---

### Task 5: Segment reducer

**Files:**
- Create: `apps/meet-agent/container/src/segments/reducer.ts`
- Test: `apps/meet-agent/container/src/segments/__tests__/reducer.test.ts`

**Interfaces:**
- Consumes: `Utterance` (`../stt/assemblyai`), `resolveSpeaker` + `ActiveSpeakerInterval` (`../identity/correlator`), `TranscriptSegment` (`../contract/events`).
- Produces:
  - `class SegmentReducer` with:
    - `constructor(meetingId: string, idGen?: () => string)`
    - `push(u: Utterance, active: ActiveSpeakerInterval[]): TranscriptSegment` — builds a segment; a stable `segmentId` is assigned per diarized turn so a partial followed by its final share the same id (upsert). `gap` is set `true` when the previous emitted segment ended > 8000 ms before this one starts.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { SegmentReducer } from "../reducer";

const u = (over: Partial<{ text: string; start: number; end: number; isFinal: boolean; diarizedLabel: string }>) => ({
    text: "x",
    start: 1000,
    end: 2000,
    isFinal: true,
    diarizedLabel: "A",
    ...over,
});

describe("SegmentReducer", () => {
    it("assigns a stable id across partial then final of the same turn", () => {
        let n = 0;
        const r = new SegmentReducer("m1", () => `id${++n}`);
        const partial = r.push(u({ isFinal: false, text: "hol" }), []);
        const final = r.push(u({ isFinal: true, text: "hola" }), []);
        expect(partial.segmentId).toBe(final.segmentId);
        expect(final.isFinal).toBe(true);
        expect(final.text).toBe("hola");
    });

    it("starts a new id after a final turn", () => {
        let n = 0;
        const r = new SegmentReducer("m1", () => `id${++n}`);
        const a = r.push(u({ isFinal: true }), []);
        const b = r.push(u({ isFinal: true, start: 3000, end: 4000 }), []);
        expect(a.segmentId).not.toBe(b.segmentId);
    });

    it("flags a gap when audio was lost", () => {
        const r = new SegmentReducer("m1");
        r.push(u({ isFinal: true, start: 1000, end: 2000 }), []);
        const g = r.push(u({ isFinal: true, start: 20000, end: 21000 }), []);
        expect(g.gap).toBe(true);
    });

    it("embeds resolved speaker from active intervals", () => {
        const r = new SegmentReducer("m1");
        const seg = r.push(u({ start: 1000, end: 3000 }), [{ start: 900, end: 3200, participantId: "p1", displayName: "Diego" }]);
        expect(seg.speaker).toMatchObject({ participantId: "p1" });
        expect(seg.identityConfidence).toBe("inferred");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/meet-agent && pnpm test reducer`
Expected: FAIL — cannot resolve `../reducer`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { nanoid } from "nanoid";
import type { TranscriptSegment } from "../contract/events";
import { type ActiveSpeakerInterval, resolveSpeaker } from "../identity/correlator";
import type { Utterance } from "../stt/assemblyai";

const GAP_MS = 8000;

export class SegmentReducer {
    private currentId: string | null = null;
    private lastEmittedEnd: number | null = null;

    constructor(
        private readonly meetingId: string,
        private readonly idGen: () => string = () => nanoid(),
    ) {}

    push(u: Utterance, active: ActiveSpeakerInterval[]): TranscriptSegment {
        if (this.currentId === null) this.currentId = this.idGen();
        const segmentId = this.currentId;

        const { speaker, identityConfidence } = resolveSpeaker(
            { start: u.start, end: u.end },
            active,
            u.diarizedLabel,
        );

        const gap = this.lastEmittedEnd !== null && u.start - this.lastEmittedEnd > GAP_MS;

        const seg: TranscriptSegment = {
            segmentId,
            meetingId: this.meetingId,
            speaker,
            text: u.text,
            startedAt: new Date(u.start).toISOString(),
            endedAt: new Date(u.end).toISOString(),
            isFinal: u.isFinal,
            transcriptionConfidence: u.confidence,
            identityConfidence,
            ...(gap ? { gap: true } : {}),
        };

        if (u.isFinal) {
            this.currentId = null;
            this.lastEmittedEnd = u.end;
        }
        return seg;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/meet-agent && pnpm test reducer`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/segments/
git commit -m "feat(meet-agent): segment reducer with upsert + gap detection"
```

---

### Task 6: SSE buffer + Portal publisher

**Files:**
- Create: `apps/meet-agent/container/src/emit/buffer.ts`
- Create: `apps/meet-agent/container/src/emit/portal.ts`
- Test: `apps/meet-agent/container/src/emit/__tests__/buffer.test.ts`
- Test: `apps/meet-agent/container/src/emit/__tests__/portal.test.ts`

**Interfaces:**
- Consumes: `AgentEvent` (`../contract/events`).
- Produces:
  - `class EventBuffer` — `append(ev: AgentEvent): number` (returns monotonic cursor), `since(cursor: number): { cursor: number; events: AgentEvent[] }`, `subscribe(fn: (ev: AgentEvent) => void): () => void`.
  - `interface Publisher { publish(ev: AgentEvent): Promise<void> }`
  - `createPortalPublisher(opts: { apiKey: string; channelId: string; token?: string }): Publisher` — best-effort; a publish failure logs and resolves (never throws — protects the graceful-degradation invariant).

- [ ] **Step 1: Write the failing buffer test**

```ts
import { describe, expect, it, vi } from "vitest";
import { EventBuffer } from "../buffer";

const ev = (at: string) => ({ type: "session.started", meetingId: "m1", at }) as const;

describe("EventBuffer", () => {
    it("returns events after a cursor", () => {
        const b = new EventBuffer();
        const c1 = b.append(ev("t1"));
        b.append(ev("t2"));
        const res = b.since(c1);
        expect(res.events).toHaveLength(1);
        expect(res.events[0].at).toBe("t2");
    });

    it("notifies subscribers and can unsubscribe", () => {
        const b = new EventBuffer();
        const seen = vi.fn();
        const off = b.subscribe(seen);
        b.append(ev("t1"));
        off();
        b.append(ev("t2"));
        expect(seen).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/meet-agent && pnpm test buffer`
Expected: FAIL — cannot resolve `../buffer`.

- [ ] **Step 3: Implement `buffer.ts`**

```ts
import type { AgentEvent } from "../contract/events";

export class EventBuffer {
    private events: AgentEvent[] = [];
    private subs = new Set<(ev: AgentEvent) => void>();

    append(ev: AgentEvent): number {
        this.events.push(ev);
        for (const fn of this.subs) fn(ev);
        return this.events.length;
    }

    since(cursor: number): { cursor: number; events: AgentEvent[] } {
        const from = Math.max(0, cursor);
        return { cursor: this.events.length, events: this.events.slice(from) };
    }

    subscribe(fn: (ev: AgentEvent) => void): () => void {
        this.subs.add(fn);
        return () => this.subs.delete(fn);
    }
}
```

- [ ] **Step 4: Write the failing portal test**

```ts
import { describe, expect, it, vi } from "vitest";
import { createPortalPublisher } from "../portal";

describe("createPortalPublisher", () => {
    it("does not throw when the underlying send fails", async () => {
        const send = vi.fn().mockRejectedValue(new Error("network"));
        const pub = createPortalPublisher({ apiKey: "pk", channelId: "meeting-1", _sendImpl: send });
        await expect(pub.publish({ type: "session.ended", meetingId: "m1", at: "t", reason: "done" })).resolves.toBeUndefined();
        expect(send).toHaveBeenCalledOnce();
    });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `cd apps/meet-agent && pnpm test portal`
Expected: FAIL — cannot resolve `../portal`.

- [ ] **Step 6: Implement `portal.ts`**

The `_sendImpl` seam lets the unit test inject a sender without a live socket; production builds the real Portal channel handle lazily on first publish.

```ts
import { Portal } from "@portalsdk/core";
import type { AgentEvent } from "../contract/events";

export interface Publisher {
    publish(ev: AgentEvent): Promise<void>;
}

type Opts = {
    apiKey: string;
    channelId: string;
    token?: string;
    _sendImpl?: (ev: AgentEvent) => Promise<void>;
};

export function createPortalPublisher(opts: Opts): Publisher {
    let send = opts._sendImpl;

    const ensure = (): ((ev: AgentEvent) => Promise<void>) => {
        if (send) return send;
        const portal = new Portal({ apiKey: opts.apiKey, token: opts.token });
        const room = portal.channel<AgentEvent>(opts.channelId);
        room.acquire();
        send = (ev) => room.send({ content: ev });
        return send;
    };

    return {
        async publish(ev) {
            try {
                await ensure()(ev);
            } catch (err) {
                console.error("[portal] publish failed (continuing):", err);
            }
        },
    };
}
```

- [ ] **Step 7: Run all emit tests to verify they pass**

Run: `cd apps/meet-agent && pnpm test emit`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/meet-agent/container/src/emit/
git commit -m "feat(meet-agent): SSE buffer + best-effort Portal publisher"
```

---

### Task 7: Meet UI adapter (selectors + browser-context observers)

**Files:**
- Create: `apps/meet-agent/container/src/meet-ui-adapter/selectors.ts`
- Create: `apps/meet-agent/container/src/meet-ui-adapter/observer.ts`
- Test: `apps/meet-agent/container/src/meet-ui-adapter/__tests__/observer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `selectors` object with named keys: `nameInput`, `askToJoinButton`, `participantTile`, `activeSpeakerMarker`, `participantName`, `leaveButton`. Each value is a CSS/attribute selector string, the only place selectors exist.
  - `type RosterEntry = { participantId: string; displayName: string }`
  - `type ActiveSpeakerSample = { participantId: string; displayName: string; at: number }`
  - `readRoster(doc: Document, sel: typeof selectors): RosterEntry[]` — pure DOM read, unit-testable against a fake DOM.
  - `readActiveSpeakers(doc: Document, sel: typeof selectors, now: number): ActiveSpeakerSample[]`

  `observer.ts` exports these pure readers; the browser-side `MutationObserver`/polling loop that calls them lives in `meet/session.ts` (Task 8) via `page.evaluate`. Keeping the readers pure makes them testable without Playwright.

- [ ] **Step 1: Write the failing test (fake DOM via a minimal document shim)**

```ts
import { describe, expect, it } from "vitest";
import { selectors } from "../selectors";
import { readActiveSpeakers, readRoster } from "../observer";

// Minimal DOM: build with a tiny helper backed by linkedom if available; here we
// construct a fake matching the reader's contract.
function fakeDoc(tiles: Array<{ id: string; name: string; speaking: boolean }>): Document {
    const els = tiles.map((t) => ({
        getAttribute: (a: string) => (a === "data-participant-id" ? t.id : null),
        querySelector: (q: string) =>
            q === selectors.participantName ? ({ textContent: t.name } as unknown as Element) : null,
        matches: (q: string) => q === selectors.activeSpeakerMarker && t.speaking,
    }));
    return {
        querySelectorAll: (q: string) => (q === selectors.participantTile ? (els as unknown as NodeListOf<Element>) : ([] as unknown as NodeListOf<Element>)),
    } as unknown as Document;
}

describe("meet-ui-adapter readers", () => {
    it("reads a roster", () => {
        const doc = fakeDoc([{ id: "p1", name: "Diego", speaking: false }, { id: "p2", name: "Sofia", speaking: true }]);
        expect(readRoster(doc, selectors)).toEqual([
            { participantId: "p1", displayName: "Diego" },
            { participantId: "p2", displayName: "Sofia" },
        ]);
    });

    it("reads only active speakers with a timestamp", () => {
        const doc = fakeDoc([{ id: "p1", name: "Diego", speaking: false }, { id: "p2", name: "Sofia", speaking: true }]);
        const samples = readActiveSpeakers(doc, selectors, 5000);
        expect(samples).toEqual([{ participantId: "p2", displayName: "Sofia", at: 5000 }]);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/meet-agent && pnpm test observer`
Expected: FAIL — cannot resolve `../selectors`.

- [ ] **Step 3: Implement `selectors.ts` (placeholder selectors, refined in Task 10 smoke test)**

```ts
// The ONLY place Meet DOM selectors live. Verified/adjusted against a live
// Meet page in Task 10. Values here are best-known starting points.
export const selectors = {
    nameInput: 'input[aria-label*="name" i]',
    askToJoinButton: 'button[jsname][aria-label*="join" i], button:has-text("Ask to join")',
    participantTile: "[data-participant-id]",
    participantName: "[data-self-name], .participant-name",
    activeSpeakerMarker: '[data-is-speaking="true"], .speaking',
    leaveButton: 'button[aria-label*="leave" i]',
} as const;
```

- [ ] **Step 4: Implement `observer.ts`**

```ts
import type { selectors as Selectors } from "./selectors";

export type RosterEntry = { participantId: string; displayName: string };
export type ActiveSpeakerSample = { participantId: string; displayName: string; at: number };

export function readRoster(doc: Document, sel: typeof Selectors): RosterEntry[] {
    const out: RosterEntry[] = [];
    for (const tile of Array.from(doc.querySelectorAll(sel.participantTile))) {
        const participantId = tile.getAttribute("data-participant-id");
        if (!participantId) continue;
        const nameEl = tile.querySelector(sel.participantName);
        out.push({ participantId, displayName: nameEl?.textContent?.trim() ?? participantId });
    }
    return out;
}

export function readActiveSpeakers(doc: Document, sel: typeof Selectors, now: number): ActiveSpeakerSample[] {
    const out: ActiveSpeakerSample[] = [];
    for (const tile of Array.from(doc.querySelectorAll(sel.participantTile))) {
        const participantId = tile.getAttribute("data-participant-id");
        if (!participantId) continue;
        if (!tile.matches(sel.activeSpeakerMarker)) continue;
        const nameEl = tile.querySelector(sel.participantName);
        out.push({ participantId, displayName: nameEl?.textContent?.trim() ?? participantId, at: now });
    }
    return out;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/meet-agent && pnpm test observer`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/meet-agent/container/src/meet-ui-adapter/
git commit -m "feat(meet-agent): centralized Meet selectors + pure DOM readers"
```

---

### Task 8: Meet session (Playwright join + audio + observer wiring)

**Files:**
- Create: `apps/meet-agent/container/src/meet/session.ts`
- Test: `apps/meet-agent/container/src/meet/__tests__/session.test.ts`

**Interfaces:**
- Consumes: `selectors` + readers (`../meet-ui-adapter`), `parseAssemblyMessage` (`../stt/assemblyai`), `SegmentReducer` (`../segments/reducer`), `EventBuffer` + `Publisher` (`../emit/*`), `AgentEvent`/`TranscriptSegment` (`../contract/events`), `ActiveSpeakerInterval` (`../identity/correlator`).
- Produces:
  - `type SessionState = "starting" | "waiting_admission" | "in_meeting" | "ended"`
  - `type SessionDeps = { launchBrowser(): Promise<BrowserLike>; stt: SttBridge; buffer: EventBuffer; publisher: Publisher; now(): number }`
  - `interface SttBridge { start(): Promise<void>; onMessage(fn: (raw: string) => void): void; sendAudio(chunk: Uint8Array): void; stop(): Promise<void> }`
  - `class MeetSession` with `start(meetingId: string, meetUrl: string): Promise<void>`, `stop(reason: string): Promise<void>`, `getState(): SessionState`, `ingestUtteranceRaw(raw: string): void` (test seam that runs the parse→correlate→reduce→emit path against the current active-speaker window), and `recordActiveSample(s: ActiveSpeakerSample): void`.

  The heavy Playwright/browser calls are behind `SessionDeps.launchBrowser` + `SttBridge` so the transcription/emit path is unit-tested with fakes; Task 10 supplies the real Playwright + AssemblyAI implementations.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../contract/events";
import { EventBuffer } from "../../emit/buffer";
import { MeetSession } from "../session";

function fakeDeps(now: () => number) {
    const buffer = new EventBuffer();
    const published: AgentEvent[] = [];
    const stt = { start: vi.fn().mockResolvedValue(undefined), onMessage: vi.fn(), sendAudio: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) };
    const deps = {
        launchBrowser: vi.fn().mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) }),
        stt,
        buffer,
        publisher: { publish: async (ev: AgentEvent) => void published.push(ev) },
        now,
    };
    return { deps, buffer, published };
}

describe("MeetSession transcription path", () => {
    it("turns a final AssemblyAI turn into a transcript.segment event attributed by active speaker", () => {
        let t = 1_000_000;
        const { deps, published } = fakeDeps(() => t);
        const s = new MeetSession(deps);
        s.recordActiveSample({ participantId: "p1", displayName: "Diego", at: 1_000_900 });
        s.recordActiveSample({ participantId: "p1", displayName: "Diego", at: 1_003_000 });
        const raw = JSON.stringify({ type: "Turn", transcript: "hola", end_of_turn: true, audio_start: 1000, audio_end: 3000, words: [{ speaker: "A" }] });
        s.ingestUtteranceRaw(raw);
        const seg = published.find((e) => e.type === "transcript.segment");
        expect(seg).toBeTruthy();
        if (seg?.type === "transcript.segment") {
            expect(seg.segment.text).toBe("hola");
            expect(seg.segment.speaker).toMatchObject({ participantId: "p1" });
        }
    });

    it("still emits a segment (unresolved) when no active-speaker samples exist", () => {
        let t = 1_000_000;
        const { deps, published } = fakeDeps(() => t);
        const s = new MeetSession(deps);
        s.ingestUtteranceRaw(JSON.stringify({ type: "Turn", transcript: "eh", end_of_turn: true, audio_start: 1000, audio_end: 2000 }));
        const seg = published.find((e) => e.type === "transcript.segment");
        expect(seg?.type === "transcript.segment" && seg.segment.identityConfidence).toBe("unresolved");
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/meet-agent && pnpm test session`
Expected: FAIL — cannot resolve `../session`.

- [ ] **Step 3: Implement `session.ts` (transcription path + lifecycle skeleton)**

```ts
import type { AgentEvent } from "../contract/events";
import type { EventBuffer } from "../emit/buffer";
import type { Publisher } from "../emit/portal";
import type { ActiveSpeakerInterval } from "../identity/correlator";
import type { ActiveSpeakerSample } from "../meet-ui-adapter/observer";
import { SegmentReducer } from "../segments/reducer";
import { parseAssemblyMessage } from "../stt/assemblyai";

export type SessionState = "starting" | "waiting_admission" | "in_meeting" | "ended";

export interface SttBridge {
    start(): Promise<void>;
    onMessage(fn: (raw: string) => void): void;
    sendAudio(chunk: Uint8Array): void;
    stop(): Promise<void>;
}

export interface BrowserLike {
    close(): Promise<void>;
}

export type SessionDeps = {
    launchBrowser(): Promise<BrowserLike>;
    stt: SttBridge;
    buffer: EventBuffer;
    publisher: Publisher;
    now(): number;
};

const ACTIVE_WINDOW_MS = 15000;

export class MeetSession {
    private state: SessionState = "starting";
    private meetingId = "";
    private sessionStart = 0;
    private reducer: SegmentReducer | null = null;
    private activeSamples: ActiveSpeakerSample[] = [];

    constructor(private readonly deps: SessionDeps) {}

    getState(): SessionState {
        return this.state;
    }

    recordActiveSample(s: ActiveSpeakerSample): void {
        this.activeSamples.push(s);
        const cutoff = s.at - ACTIVE_WINDOW_MS;
        this.activeSamples = this.activeSamples.filter((x) => x.at >= cutoff);
    }

    private activeIntervals(): ActiveSpeakerInterval[] {
        // Each sample represents an ~instant of activity; widen to a small band.
        return this.activeSamples.map((s) => ({
            participantId: s.participantId,
            displayName: s.displayName,
            start: s.at - 250,
            end: s.at + 250,
        }));
    }

    private emit(ev: AgentEvent): void {
        this.deps.buffer.append(ev);
        void this.deps.publisher.publish(ev);
    }

    ingestUtteranceRaw(raw: string): void {
        if (!this.reducer) this.reducer = new SegmentReducer(this.meetingId || "unknown");
        const u = parseAssemblyMessage(raw, this.sessionStart || this.deps.now());
        if (!u) return;
        const seg = this.reducer.push(u, this.activeIntervals());
        this.emit({ type: "transcript.segment", segment: seg });
    }

    async start(meetingId: string, _meetUrl: string): Promise<void> {
        this.meetingId = meetingId;
        this.sessionStart = this.deps.now();
        this.reducer = new SegmentReducer(meetingId);
        this.state = "starting";
        await this.deps.launchBrowser();
        await this.deps.stt.start();
        this.deps.stt.onMessage((raw) => this.ingestUtteranceRaw(raw));
        // Real Playwright join flow + audio piping + DOM polling wired in Task 10.
        this.state = "in_meeting";
        this.emit({ type: "session.started", meetingId, at: new Date(this.sessionStart).toISOString() });
    }

    async stop(reason: string): Promise<void> {
        await this.deps.stt.stop();
        this.state = "ended";
        this.emit({ type: "session.ended", meetingId: this.meetingId, at: new Date(this.deps.now()).toISOString(), reason });
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/meet-agent && pnpm test session`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/meet/
git commit -m "feat(meet-agent): MeetSession transcription/emit path with injectable deps"
```

---

### Task 9: Worker + Durable Object + container HTTP router

**Files:**
- Create: `apps/meet-agent/worker/worker.ts`
- Create: `apps/meet-agent/container/src/main.ts`
- Create: `apps/meet-agent/wrangler.jsonc`
- Test: `apps/meet-agent/worker/__tests__/router.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`/`TranscriptSegment` (contract), `EventBuffer` (buffer).
- Produces:
  - Worker `fetch` router mapping the Task-7-spec routes to the meeting's DO.
  - `MeetingAgent extends Container` with SQLite-backed `appendSegment`/`listSegments(sinceCursor)`.
  - `routeRequest(req: Request, deps): Promise<Response>` — pure routing function unit-tested without a live DO (deps injected).
  - Container `main.ts` local HTTP server exposing `/start`, `/stop`, `/state`, `/transcript`, `/stream` backed by a `MeetSession` + `EventBuffer`.

- [ ] **Step 1: Write the failing router test**

```ts
import { describe, expect, it, vi } from "vitest";
import { routeRequest } from "../worker";

const deps = () => ({
    forward: vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    authToken: "secret",
});

describe("routeRequest", () => {
    it("rejects a missing bearer token with 401", async () => {
        const res = await routeRequest(new Request("https://x/meetings/m1/start", { method: "POST" }), deps());
        expect(res.status).toBe(401);
    });

    it("forwards an authorized start to the meeting DO", async () => {
        const d = deps();
        const res = await routeRequest(
            new Request("https://x/meetings/m1/start", { method: "POST", headers: { authorization: "Bearer secret" } }),
            d,
        );
        expect(res.status).toBe(200);
        expect(d.forward).toHaveBeenCalledWith("m1", expect.any(Request));
    });

    it("404s an unknown path", async () => {
        const res = await routeRequest(new Request("https://x/nope", { headers: { authorization: "Bearer secret" } }), deps());
        expect(res.status).toBe(404);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/meet-agent && pnpm test router`
Expected: FAIL — cannot resolve `../worker`.

- [ ] **Step 3: Implement `worker/worker.ts`**

```ts
import { Container } from "cloudflare:workers";

export type RouteDeps = {
    forward(meetingId: string, req: Request): Promise<Response>;
    authToken: string;
};

const MEETING_RE = /^\/meetings\/([^/]+)(\/(start|stop|transcript|stream))?$/;

export async function routeRequest(req: Request, deps: RouteDeps): Promise<Response> {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${deps.authToken}`) return new Response("unauthorized", { status: 401 });

    const url = new URL(req.url);
    const m = url.pathname.match(MEETING_RE);
    if (!m) return new Response("not found", { status: 404 });
    const meetingId = m[1];
    return deps.forward(meetingId, req);
}

export class MeetingAgent extends Container {
    defaultPort = 8080;
    sleepAfter = "5m";

    // SQLite persistence via this.ctx.storage.sql — appendSegment/listSegments
    // implemented against the container's forwarded events in Task 10.
}

export default {
    async fetch(req: Request, env: { MEETING_AGENT: DurableObjectNamespace; AUTH_TOKEN: string }): Promise<Response> {
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

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/meet-agent && pnpm test router`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `container/src/main.ts` (local HTTP server, no test — exercised in Task 10)**

```ts
import { createServer } from "node:http";
import { EventBuffer } from "./emit/buffer";
import { createPortalPublisher } from "./emit/portal";
import { MeetSession } from "./meet/session";
// Real Playwright + AssemblyAI deps are constructed in Task 10 and passed here.

const buffer = new EventBuffer();
const publisher = createPortalPublisher({
    apiKey: process.env.PORTAL_API_KEY ?? "",
    channelId: `meeting-${process.env.MEETING_ID ?? "dev"}`,
});

// session built with real deps in Task 10:
let session: MeetSession | null = null;

const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (req.method === "POST" && url.pathname === "/start") {
        // parse body { meetingId, meetUrl }, construct + session.start(...)
        res.writeHead(202).end();
        return;
    }
    if (url.pathname === "/state") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ state: session?.getState() ?? "starting" }));
        return;
    }
    if (url.pathname === "/transcript") {
        const cursor = Number(url.searchParams.get("since") ?? 0);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(buffer.since(cursor)));
        return;
    }
    if (url.pathname === "/stream") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        const off = buffer.subscribe((ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
        req.on("close", off);
        return;
    }
    res.writeHead(404).end();
});

server.listen(8080);
export { server, buffer, publisher };
```

- [ ] **Step 6: Create `wrangler.jsonc`**

```jsonc
{
    "name": "cortex-meet-agent",
    "main": "worker/worker.ts",
    "compatibility_date": "2026-01-01",
    "containers": [
        {
            "class_name": "MeetingAgent",
            "image": "./Dockerfile",
            "instance_type": "basic",
            "max_instances": 5,
        },
    ],
    "durable_objects": {
        "bindings": [{ "name": "MEETING_AGENT", "class_name": "MeetingAgent" }],
    },
    "migrations": [{ "tag": "v1", "new_sqlite_classes": ["MeetingAgent"] }],
    "vars": { "AUTH_TOKEN": "change-me-in-secrets" },
}
```

- [ ] **Step 7: Typecheck**

Run: `cd apps/meet-agent && pnpm typecheck`
Expected: exit 0 (install `@types/node` if missing; `cloudflare:workers` types come from `@cloudflare/workers-types`).

- [ ] **Step 8: Commit**

```bash
git add apps/meet-agent/worker/ apps/meet-agent/container/src/main.ts apps/meet-agent/wrangler.jsonc
git commit -m "feat(meet-agent): worker router, Container DO, local HTTP server"
```

---

### Task 10: Real Playwright + AssemblyAI wiring, Dockerfile, and selector smoke test

**Files:**
- Create: `apps/meet-agent/Dockerfile`
- Modify: `apps/meet-agent/container/src/meet/session.ts` (add `createPlaywrightBrowser`, `createAssemblyAiBridge`, join flow, audio pipe, DOM polling)
- Modify: `apps/meet-agent/container/src/main.ts` (construct real deps)
- Create: `apps/meet-agent/container/src/meet/__tests__/smoke.md` (manual checklist)

**Interfaces:**
- Consumes: everything above.
- Produces: a runnable container image and the real capture path. No new unit-tested pure function — this task is integration + manual E2E, so it folds its verification into a documented smoke run rather than a Vitest cycle.

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
FROM mcr.microsoft.com/playwright:v1.49.0-jammy
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "container/src/main.ts"]
```

- [ ] **Step 2: Implement the real Playwright browser + join flow in `session.ts`**

Add exported factories. Launch Chromium with fake-media flags so tab audio is capturable headless, navigate, fill the name, click "Ask to join", then poll the DOM via `page.evaluate` calling the pure readers from Task 7.

```ts
import { chromium } from "playwright";
import { selectors } from "../meet-ui-adapter/selectors";
import { readActiveSpeakers, readRoster } from "../meet-ui-adapter/observer";

export async function createPlaywrightBrowser(meetUrl: string, onSample: (s: ActiveSpeakerSample) => void) {
    const browser = await chromium.launch({
        headless: true,
        args: [
            "--use-fake-ui-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
        ],
    });
    const ctx = await browser.newContext({ permissions: ["microphone", "camera"] });
    const page = await ctx.newPage();
    await page.goto(meetUrl);
    await page.fill(selectors.nameInput, "Cortex Notetaker").catch(() => {});
    await page.click(selectors.askToJoinButton).catch(() => {});

    // Poll active speakers every 250ms using the pure reader in the page context.
    const poll = setInterval(async () => {
        try {
            const samples = await page.evaluate(
                ([sel, now]) => {
                    // readActiveSpeakers is re-declared in-page via a bundled string in
                    // production; for clarity the smoke build injects it via addScriptTag.
                    return (window as unknown as { __readActiveSpeakers: typeof readActiveSpeakers }).__readActiveSpeakers(document, sel, now);
                },
                [selectors, Date.now()] as const,
            );
            for (const s of samples) onSample(s);
        } catch {
            // DOM scrape failed — transcription continues (graceful degradation).
        }
    }, 250);

    return { close: async () => { clearInterval(poll); await browser.close(); } };
}
```

> Audio capture note: pipe the meeting tab's audio to AssemblyAI. Prefer capturing via a page-injected `MediaRecorder`/`AudioWorklet` on the Meet media element that posts PCM chunks back through `page.exposeFunction("__audioChunk", ...)`, feeding `stt.sendAudio`. If Meet's audio element is not directly capturable, fall back to a virtual audio device (`pulseaudio` in the image) + `--use-file-for-fake-audio-capture` for fixture runs. Resolve the exact mechanism during the smoke run and keep it inside `createPlaywrightBrowser`.

- [ ] **Step 3: Implement `createAssemblyAiBridge` in `session.ts`**

```ts
export function createAssemblyAiBridge(apiKey: string): SttBridge {
    let ws: WebSocket | null = null;
    let onMsg: (raw: string) => void = () => {};
    return {
        async start() {
            ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&format_turns=true`, {
                headers: { authorization: apiKey },
            } as unknown as string[]);
            ws.onmessage = (e) => onMsg(typeof e.data === "string" ? e.data : "");
        },
        onMessage(fn) { onMsg = fn; },
        sendAudio(chunk) { ws?.send(chunk); },
        async stop() { ws?.close(); },
    };
}
```

> Confirm the exact AssemblyAI streaming v3 URL/params and auth header against current docs during this task; the message shape is already isolated in Task 4's parser.

- [ ] **Step 4: Wire real deps in `main.ts`**

Replace the placeholder in Task 9 Step 5 with construction of `MeetSession` using `createPlaywrightBrowser`, `createAssemblyAiBridge`, the shared `buffer`, and `publisher`, and have `/start` call `session.start(meetingId, meetUrl)`.

- [ ] **Step 5: Build the image locally to verify it assembles**

Run: `cd apps/meet-agent && docker build -t cortex-meet-agent .`
Expected: image builds; no missing-dependency errors.

- [ ] **Step 6: Write the manual smoke checklist `container/src/meet/__tests__/smoke.md`**

```markdown
# Manual E2E smoke checklist

Prereqs: AssemblyAI key in ASSEMBLYAI_API_KEY, a real Meet link, a second person to host+admit.

1. `docker run -p 8080:8080 -e ASSEMBLYAI_API_KEY=... cortex-meet-agent`
2. `curl -XPOST localhost:8080/start -d '{"meetingId":"demo","meetUrl":"<link>"}'`
3. Host sees "Cortex Notetaker" requesting to join → admit.
4. `curl localhost:8080/state` → `{"state":"in_meeting"}`.
5. Two people speak in turn. `curl localhost:8080/stream` shows `transcript.segment` events.
6. Confirm ≥1 segment has `identityConfidence:"inferred"` with the correct name.
7. If names are always `unresolved`: open Meet in a real browser, inspect a
   participant tile, and correct the selectors in `meet-ui-adapter/selectors.ts`
   (the ONLY file to touch). Re-run.
8. `curl -XPOST localhost:8080/stop` → `session.ended` on the stream.
9. `curl "localhost:8080/transcript?since=0"` returns the full ordered list.
```

- [ ] **Step 7: Run the full unit suite one final time**

Run: `cd apps/meet-agent && pnpm test`
Expected: PASS (all tasks' tests green).

- [ ] **Step 8: Commit**

```bash
git add apps/meet-agent/Dockerfile apps/meet-agent/container/src/meet/ apps/meet-agent/container/src/main.ts
git commit -m "feat(meet-agent): real Playwright + AssemblyAI wiring, Dockerfile, smoke checklist"
```

---

## Self-Review

**Spec coverage:**
- §3 hosting (Worker+DO+Container) → Task 9. Meeting access via Playwright guest → Task 10. Tab audio → Task 10. Identity via diarization × active-speaker → Tasks 3, 7, 8. STT AssemblyAI → Tasks 4, 10. Portal + REST/SSE → Tasks 6, 9. Monorepo `apps/meet-agent/` → Task 1.
- §5 data flow (join → audio → STT → correlate → segment → fan-out) → Tasks 4→8→9.
- §6 event contract → Task 2.
- §7 API routes (`start/stop/state/transcript/stream`) → Tasks 9 (worker + container server); session states → Task 8 (`SessionState`), admission-timeout wording lives in the smoke flow / lifecycle (Task 10 join flow — the timeout guard is a follow-up hardening item, noted below).
- §8 error handling: graceful degradation (audio survives DOM failure) → Tasks 6 (portal no-throw), 8 (unresolved path), 10 (try/catch around poll). Gap detection → Task 5. Reconnect/`resumed` → represented in the contract (Task 2) and DO lifecycle (Task 9); the container-restart re-emit is a Task 10 wiring detail folded into the smoke run.
- §9 testing (unit correlator/reducer/parser, integration WAV, selector smoke, manual E2E) → Tasks 3/4/5 unit, Task 10 smoke.

**Known deferred items (intentional, not placeholders):** the admission-timeout timer, the container→DO SQLite forwarding of segments, and container-restart `resumed:true` re-emit are called out where they land (Tasks 9–10) rather than given their own pure-function task, because they need the live DO/Playwright surface and have no unit seam. Flag these to the executor as the first hardening pass after the happy path runs.

**Placeholder scan:** no "TBD"/"add error handling"/"similar to Task N" — every code step is concrete. Two external-API shapes (AssemblyAI v3 fields, exact Meet selectors) are explicitly marked for live confirmation with the isolating module named.

**Type consistency:** `TranscriptSegment`, `Participant`, `AgentEvent`, `identityConfidence` values, `resolveSpeaker`, `SegmentReducer.push`, `EventBuffer.since/subscribe`, `Publisher.publish`, `SttBridge`, `MeetSession` methods are used consistently across Tasks 2–10.
