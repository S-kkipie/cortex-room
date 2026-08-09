# Meet → Canvas Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract structured notes (action/decision/topic/question/risk) from live Meet transcript with Gemini and publish them as STICKY elements to the canvas Portal channel, in real time.

**Architecture:** New `bridge/` module inside the existing MeetingAgent Durable Object. A windowed buffer of final utterances triggers a Gemini extraction, whose notes are owner-resolved, deduped, laid out in per-category columns, and published as canvas `created.final` Portal messages. Best-effort throughout — never interrupts transcription.

**Tech Stack:** TypeScript, Zod v4, Cloudflare Workers runtime (WebCrypto/`fetch`), Vitest, Gemini `generateContent` REST API.

## Global Constraints

- Runtime: Cloudflare Workers. No Node-only APIs. `crypto.randomUUID()` and `fetch` are available.
- All new files under `apps/meet-agent/container/src/bridge/`. Tests in sibling `__tests__/`.
- 4-space indent. meet-agent's own Biome/tsconfig (NOT repo root). Run checks from `apps/meet-agent`.
- Zod v4. Reuse `apps/meet-agent/container/src/contract/events.ts` types (`TranscriptSegment`, `Participant`).
- Canvas wire contract is authoritative and unchanged. Import the real schema:
  `import { canvasPortalMessageSchema } from "../../../../../src/core/canvas/domain/schemas"`.
  Produced messages MUST pass it, including the `created.final` superRefine:
  `eventId === element.lastOperationId`, `occurredAt === element.lastOperationAt`, matching `projectId`.
- No real network in tests. Gemini and Portal are injected (`extractImpl`, `_sendImpl`).
- Best-effort invariant: no bridge error propagates to transcript handling.
- Secrets via `wrangler secret put` only. New: `GEMINI_API_KEY`.
- Test command (run from `apps/meet-agent`): `pnpm test`. Typecheck: `pnpm typecheck`.

## File Structure

- `bridge/types.ts` — Zod contracts: `noteCategorySchema`, `canvasNoteSchema`, `extractionSchema`.
- `bridge/buffer.ts` — `BridgeBuffer` windowed accumulator.
- `bridge/dedup.ts` — `NoteDedup` fingerprint filter.
- `bridge/owners.ts` — `resolveOwners` name→participantId.
- `bridge/layout.ts` — `LayoutCursor` per-category column positions.
- `bridge/extract.ts` — `extractNotes` + `createGeminiExtractor`.
- `bridge/canvas-publish.ts` — `toCanvasMessage` + `createCanvasPublisher`.
- `bridge/bridge.ts` — `Bridge` orchestrator wiring the pipeline.
- `worker/worker.ts` — DO integration (modify).

---

### Task 1: Bridge contracts (`types.ts`)

**Files:**
- Create: `apps/meet-agent/container/src/bridge/types.ts`
- Test: `apps/meet-agent/container/src/bridge/__tests__/types.test.ts`

**Interfaces:**
- Produces: `noteCategorySchema`, `NoteCategory`, `canvasNoteSchema`, `CanvasNote`, `extractionSchema`, `Extraction`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { canvasNoteSchema, extractionSchema, noteCategorySchema } from "../types";

describe("bridge types", () => {
    it("accepts the five categories", () => {
        for (const c of ["action", "decision", "topic", "question", "risk"]) {
            expect(noteCategorySchema.parse(c)).toBe(c);
        }
    });

    it("rejects unknown category", () => {
        expect(() => noteCategorySchema.parse("idea")).toThrow();
    });

    it("parses a canvas note with optional owner fields", () => {
        const note = canvasNoteSchema.parse({ category: "action", text: "ship it" });
        expect(note.ownerName).toBeUndefined();
    });

    it("defaults missing extraction arrays to empty", () => {
        const ex = extractionSchema.parse({ actionItems: [{ text: "do x", owner: "Diego" }] });
        expect(ex.decisions).toEqual([]);
        expect(ex.questions).toEqual([]);
        expect(ex.risks).toEqual([]);
        expect(ex.topics).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/meet-agent && pnpm test types` → FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from "zod";

export const noteCategorySchema = z.enum(["action", "decision", "topic", "question", "risk"]);
export type NoteCategory = z.infer<typeof noteCategorySchema>;

export const canvasNoteSchema = z.object({
    category: noteCategorySchema,
    text: z.string().min(1),
    ownerName: z.string().optional(),
    ownerParticipantId: z.string().optional(),
});
export type CanvasNote = z.infer<typeof canvasNoteSchema>;

export const extractionSchema = z.object({
    actionItems: z.array(z.object({ text: z.string(), owner: z.string().optional() })).default([]),
    decisions: z.array(z.object({ text: z.string() })).default([]),
    topics: z.array(z.object({ text: z.string() })).default([]),
    questions: z.array(z.object({ text: z.string(), owner: z.string().optional() })).default([]),
    risks: z.array(z.object({ text: z.string() })).default([]),
});
export type Extraction = z.infer<typeof extractionSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/meet-agent && pnpm test types` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/bridge/types.ts apps/meet-agent/container/src/bridge/__tests__/types.test.ts
git commit -m "feat(bridge): note + extraction contracts"
```

---

### Task 2: Windowed buffer (`buffer.ts`)

**Files:**
- Create: `apps/meet-agent/container/src/bridge/buffer.ts`
- Test: `apps/meet-agent/container/src/bridge/__tests__/buffer.test.ts`

**Interfaces:**
- Consumes: `TranscriptSegment` from `../contract/events`.
- Produces: `class BridgeBuffer` with `append(segment): void`, `shouldFlush(nowMs: number): boolean`, `drain(nowMs: number): { text: string }`. Constructor `new BridgeBuffer(startMs: number)` sets initial `lastFlushMs`.

**Constants:** `FLUSH_COUNT = 8`, `FLUSH_MS = 30_000`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "../../contract/events";
import { BridgeBuffer } from "../buffer";

function seg(text: string, isFinal = true, speakerName = "Diego"): TranscriptSegment {
    return {
        segmentId: text,
        meetingId: "m1",
        speaker: { participantId: "p1", displayName: speakerName },
        text,
        startedAt: "2026-08-08T00:00:00.000Z",
        endedAt: "2026-08-08T00:00:01.000Z",
        isFinal,
        identityConfidence: "resolved",
    };
}

describe("BridgeBuffer", () => {
    it("ignores non-final segments", () => {
        const b = new BridgeBuffer(0);
        b.append(seg("partial", false));
        expect(b.shouldFlush(0)).toBe(false);
    });

    it("flushes at 8 final utterances", () => {
        const b = new BridgeBuffer(0);
        for (let i = 0; i < 7; i++) b.append(seg(`u${i}`));
        expect(b.shouldFlush(100)).toBe(false);
        b.append(seg("u7"));
        expect(b.shouldFlush(100)).toBe(true);
    });

    it("flushes after 30s when non-empty", () => {
        const b = new BridgeBuffer(0);
        b.append(seg("hi"));
        expect(b.shouldFlush(29_999)).toBe(false);
        expect(b.shouldFlush(30_000)).toBe(true);
    });

    it("does not flush on timeout when empty", () => {
        const b = new BridgeBuffer(0);
        expect(b.shouldFlush(60_000)).toBe(false);
    });

    it("drain concatenates speaker-labelled lines and resets", () => {
        const b = new BridgeBuffer(0);
        b.append(seg("hello", true, "Diego"));
        b.append(seg("world", true, "Ana"));
        const { text } = b.drain(1000);
        expect(text).toBe("Diego: hello\nAna: world");
        expect(b.shouldFlush(40_000)).toBe(false); // emptied + lastFlush reset
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/meet-agent && pnpm test buffer` → FAIL (BridgeBuffer not found). Note: existing `emit/buffer.test.ts` is unaffected; scope the filename filter.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { TranscriptSegment } from "../contract/events";

export const FLUSH_COUNT = 8;
export const FLUSH_MS = 30_000;

function speakerName(seg: TranscriptSegment): string {
    return "displayName" in seg.speaker && seg.speaker.displayName ? seg.speaker.displayName : "Unknown";
}

export class BridgeBuffer {
    private lines: string[] = [];
    private lastFlushMs: number;

    constructor(startMs: number) {
        this.lastFlushMs = startMs;
    }

    append(seg: TranscriptSegment): void {
        if (!seg.isFinal) return;
        this.lines.push(`${speakerName(seg)}: ${seg.text}`);
    }

    shouldFlush(nowMs: number): boolean {
        if (this.lines.length === 0) return false;
        return this.lines.length >= FLUSH_COUNT || nowMs - this.lastFlushMs >= FLUSH_MS;
    }

    drain(nowMs: number): { text: string } {
        const text = this.lines.join("\n");
        this.lines = [];
        this.lastFlushMs = nowMs;
        return { text };
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/meet-agent && pnpm test buffer` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/bridge/buffer.ts apps/meet-agent/container/src/bridge/__tests__/buffer.test.ts
git commit -m "feat(bridge): windowed utterance buffer with flush triggers"
```

---

### Task 3: Dedup (`dedup.ts`)

**Files:**
- Create: `apps/meet-agent/container/src/bridge/dedup.ts`
- Test: `apps/meet-agent/container/src/bridge/__tests__/dedup.test.ts`

**Interfaces:**
- Consumes: `CanvasNote` from `./types`.
- Produces: `class NoteDedup` with `fingerprint(note: CanvasNote): string` and `filterNew(notes: CanvasNote[]): CanvasNote[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { NoteDedup } from "../dedup";
import type { CanvasNote } from "../types";

const note = (category: CanvasNote["category"], text: string): CanvasNote => ({ category, text });

describe("NoteDedup", () => {
    it("filters exact repeats", () => {
        const d = new NoteDedup();
        expect(d.filterNew([note("action", "ship it")])).toHaveLength(1);
        expect(d.filterNew([note("action", "ship it")])).toHaveLength(0);
    });

    it("treats whitespace/case/trailing punctuation as same", () => {
        const d = new NoteDedup();
        d.filterNew([note("action", "Ship it")]);
        expect(d.filterNew([note("action", "  ship   it.  ")])).toHaveLength(0);
    });

    it("keeps same text under different category", () => {
        const d = new NoteDedup();
        d.filterNew([note("action", "review PR")]);
        expect(d.filterNew([note("risk", "review PR")])).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/meet-agent && pnpm test dedup` → FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { CanvasNote } from "./types";

function normalize(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?,;:]+$/, "");
}

export class NoteDedup {
    private seen = new Set<string>();

    fingerprint(note: CanvasNote): string {
        return `${note.category}|${normalize(note.text)}`;
    }

    filterNew(notes: CanvasNote[]): CanvasNote[] {
        const fresh: CanvasNote[] = [];
        for (const note of notes) {
            const fp = this.fingerprint(note);
            if (this.seen.has(fp)) continue;
            this.seen.add(fp);
            fresh.push(note);
        }
        return fresh;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/meet-agent && pnpm test dedup` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/bridge/dedup.ts apps/meet-agent/container/src/bridge/__tests__/dedup.test.ts
git commit -m "feat(bridge): note dedup by category+normalized text"
```

---

### Task 4: Owner resolution (`owners.ts`)

**Files:**
- Create: `apps/meet-agent/container/src/bridge/owners.ts`
- Test: `apps/meet-agent/container/src/bridge/__tests__/owners.test.ts`

**Interfaces:**
- Consumes: `CanvasNote` from `./types`, `Participant` from `../contract/events`.
- Produces: `resolveOwners(notes: CanvasNote[], participants: Iterable<Participant>): CanvasNote[]` (returns new notes; sets `ownerParticipantId` on name match).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { Participant } from "../../contract/events";
import { resolveOwners } from "../owners";
import type { CanvasNote } from "../types";

const participants: Participant[] = [
    { participantId: "p1", displayName: "Diego" },
    { participantId: "p2", displayName: "Ana García" },
];

describe("resolveOwners", () => {
    it("resolves a case-insensitive name match", () => {
        const notes: CanvasNote[] = [{ category: "action", text: "x", ownerName: "diego" }];
        expect(resolveOwners(notes, participants)[0].ownerParticipantId).toBe("p1");
    });

    it("leaves id undefined when no match", () => {
        const notes: CanvasNote[] = [{ category: "action", text: "x", ownerName: "Bob" }];
        expect(resolveOwners(notes, participants)[0].ownerParticipantId).toBeUndefined();
    });

    it("ignores notes without ownerName", () => {
        const notes: CanvasNote[] = [{ category: "topic", text: "x" }];
        expect(resolveOwners(notes, participants)[0].ownerParticipantId).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/meet-agent && pnpm test owners` → FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Participant } from "../contract/events";
import type { CanvasNote } from "./types";

export function resolveOwners(notes: CanvasNote[], participants: Iterable<Participant>): CanvasNote[] {
    const byName = new Map<string, string>();
    for (const p of participants) {
        if (p.displayName) byName.set(p.displayName.toLowerCase(), p.participantId);
    }
    return notes.map((note) => {
        if (!note.ownerName) return note;
        const id = byName.get(note.ownerName.toLowerCase());
        return id ? { ...note, ownerParticipantId: id } : note;
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/meet-agent && pnpm test owners` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/bridge/owners.ts apps/meet-agent/container/src/bridge/__tests__/owners.test.ts
git commit -m "feat(bridge): resolve note owners against participants"
```

---

### Task 5: Layout (`layout.ts`)

**Files:**
- Create: `apps/meet-agent/container/src/bridge/layout.ts`
- Test: `apps/meet-agent/container/src/bridge/__tests__/layout.test.ts`

**Interfaces:**
- Consumes: `NoteCategory` from `./types`.
- Produces: `class LayoutCursor` with `place(category: NoteCategory): { x: number; y: number; width: number; height: number }`. Constants exported: `NOTE_WIDTH=240`, `NOTE_HEIGHT=120`, `GAP_X=40`, `GAP_Y=24`. Column order: action, decision, topic, question, risk.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { GAP_X, GAP_Y, LayoutCursor, NOTE_HEIGHT, NOTE_WIDTH } from "../layout";

describe("LayoutCursor", () => {
    it("stacks notes vertically within a category column", () => {
        const c = new LayoutCursor();
        const a = c.place("action");
        const b = c.place("action");
        expect(a.x).toBe(b.x);
        expect(b.y - a.y).toBe(NOTE_HEIGHT + GAP_Y);
        expect(a.y).toBe(0);
    });

    it("puts different categories in different columns", () => {
        const c = new LayoutCursor();
        const action = c.place("action");
        const risk = c.place("risk");
        expect(action.x).toBe(0);
        expect(risk.x).toBe(4 * (NOTE_WIDTH + GAP_X));
    });

    it("returns fixed size", () => {
        const c = new LayoutCursor();
        const p = c.place("topic");
        expect(p.width).toBe(NOTE_WIDTH);
        expect(p.height).toBe(NOTE_HEIGHT);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/meet-agent && pnpm test layout` → FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { NoteCategory } from "./types";

export const NOTE_WIDTH = 240;
export const NOTE_HEIGHT = 120;
export const GAP_X = 40;
export const GAP_Y = 24;

const COLUMN_ORDER: NoteCategory[] = ["action", "decision", "topic", "question", "risk"];

export class LayoutCursor {
    private counts = new Map<NoteCategory, number>();

    place(category: NoteCategory): { x: number; y: number; width: number; height: number } {
        const col = COLUMN_ORDER.indexOf(category);
        const row = this.counts.get(category) ?? 0;
        this.counts.set(category, row + 1);
        return {
            x: col * (NOTE_WIDTH + GAP_X),
            y: row * (NOTE_HEIGHT + GAP_Y),
            width: NOTE_WIDTH,
            height: NOTE_HEIGHT,
        };
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/meet-agent && pnpm test layout` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/bridge/layout.ts apps/meet-agent/container/src/bridge/__tests__/layout.test.ts
git commit -m "feat(bridge): per-category column layout"
```

---

### Task 6: Extraction (`extract.ts`)

**Files:**
- Create: `apps/meet-agent/container/src/bridge/extract.ts`
- Test: `apps/meet-agent/container/src/bridge/__tests__/extract.test.ts`

**Interfaces:**
- Consumes: `extractionSchema`, `CanvasNote` from `./types`.
- Produces:
  - `type ExtractImpl = (prompt: string) => Promise<string>` (returns raw JSON text).
  - `extractNotes(args: { newText: string; alreadyEmitted: string[]; extractImpl: ExtractImpl }): Promise<CanvasNote[]>`.
  - `createGeminiExtractor(opts: { apiKey: string; model?: string; fetchImpl?: typeof fetch }): ExtractImpl`.
  - `buildPrompt(newText: string, alreadyEmitted: string[]): string` (exported for test).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { buildPrompt, createGeminiExtractor, extractNotes } from "../extract";

const fixture = JSON.stringify({
    actionItems: [{ text: "send the deck", owner: "Diego" }],
    decisions: [{ text: "use Recall" }],
    questions: [{ text: "what budget?" }],
    risks: [{ text: "API key exposed" }],
    topics: [{ text: "roadmap" }],
});

describe("extractNotes", () => {
    it("flattens all five categories with correct tags", async () => {
        const notes = await extractNotes({ newText: "x", alreadyEmitted: [], extractImpl: async () => fixture });
        expect(notes).toContainEqual({ category: "action", text: "send the deck", ownerName: "Diego" });
        expect(notes).toContainEqual({ category: "decision", text: "use Recall" });
        expect(notes).toContainEqual({ category: "question", text: "what budget?" });
        expect(notes).toContainEqual({ category: "risk", text: "API key exposed" });
        expect(notes).toContainEqual({ category: "topic", text: "roadmap" });
        expect(notes).toHaveLength(5);
    });

    it("returns [] on malformed JSON", async () => {
        expect(await extractNotes({ newText: "x", alreadyEmitted: [], extractImpl: async () => "not json" })).toEqual([]);
    });

    it("returns [] when extractImpl throws", async () => {
        expect(
            await extractNotes({
                newText: "x",
                alreadyEmitted: [],
                extractImpl: async () => {
                    throw new Error("boom");
                },
            }),
        ).toEqual([]);
    });

    it("includes already-emitted list in the prompt", () => {
        const prompt = buildPrompt("hello", ["send the deck"]);
        expect(prompt).toContain("send the deck");
    });
});

describe("createGeminiExtractor", () => {
    it("posts to the Gemini endpoint and returns the text part", async () => {
        const fetchImpl = vi.fn(async () =>
            new Response(
                JSON.stringify({ candidates: [{ content: { parts: [{ text: fixture }] } }] }),
                { status: 200 },
            ),
        ) as unknown as typeof fetch;
        const extract = createGeminiExtractor({ apiKey: "k", model: "gemini-2.0-flash", fetchImpl });
        const raw = await extract("prompt");
        expect(raw).toBe(fixture);
        const url = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(url).toContain("gemini-2.0-flash:generateContent");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/meet-agent && pnpm test extract` → FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import { type CanvasNote, extractionSchema } from "./types";

export type ExtractImpl = (prompt: string) => Promise<string>;

const SYSTEM = [
    "You extract structured meeting notes from a transcript window.",
    "Return ONLY new items not already captured. Output strict JSON with keys:",
    "actionItems[{text,owner?}], decisions[{text}], topics[{text}], questions[{text,owner?}], risks[{text}].",
    "owner is the speaker name responsible, when clear. Return empty arrays when nothing new. No prose.",
].join(" ");

export function buildPrompt(newText: string, alreadyEmitted: string[]): string {
    const emitted = alreadyEmitted.length ? alreadyEmitted.map((t) => `- ${t}`).join("\n") : "(none)";
    return `${SYSTEM}\n\nAlready captured (do NOT repeat):\n${emitted}\n\nNew transcript:\n${newText}`;
}

export async function extractNotes(args: {
    newText: string;
    alreadyEmitted: string[];
    extractImpl: ExtractImpl;
}): Promise<CanvasNote[]> {
    try {
        const raw = await args.extractImpl(buildPrompt(args.newText, args.alreadyEmitted));
        const parsed = extractionSchema.parse(JSON.parse(raw));
        const notes: CanvasNote[] = [];
        for (const a of parsed.actionItems) notes.push({ category: "action", text: a.text, ownerName: a.owner });
        for (const d of parsed.decisions) notes.push({ category: "decision", text: d.text });
        for (const t of parsed.topics) notes.push({ category: "topic", text: t.text });
        for (const q of parsed.questions) notes.push({ category: "question", text: q.text, ownerName: q.owner });
        for (const r of parsed.risks) notes.push({ category: "risk", text: r.text });
        return notes;
    } catch (err) {
        console.error("[bridge] extract failed (continuing):", err);
        return [];
    }
}

export function createGeminiExtractor(opts: {
    apiKey: string;
    model?: string;
    fetchImpl?: typeof fetch;
}): ExtractImpl {
    const model = opts.model ?? "gemini-2.0-flash";
    const doFetch = opts.fetchImpl ?? fetch;
    return async (prompt) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${opts.apiKey}`;
        const res = await doFetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: "application/json" },
            }),
        });
        if (!res.ok) throw new Error(`gemini ${res.status}`);
        const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    };
}
```

Note: `ownerName: undefined` keys are acceptable — `canvasNoteSchema` treats missing/undefined optional identically; the test uses `toContainEqual` with the key omitted, which matches an object whose `ownerName` is `undefined` under Vitest equality. If the reviewer finds a mismatch, drop undefined keys by conditional spread.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/meet-agent && pnpm test extract` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/bridge/extract.ts apps/meet-agent/container/src/bridge/__tests__/extract.test.ts
git commit -m "feat(bridge): Gemini note extraction with injected impl"
```

---

### Task 7: Canvas publish (`canvas-publish.ts`)

**Files:**
- Create: `apps/meet-agent/container/src/bridge/canvas-publish.ts`
- Test: `apps/meet-agent/container/src/bridge/__tests__/canvas-publish.test.ts`

**Interfaces:**
- Consumes: `CanvasNote`, `NoteCategory` from `./types`; `canvasPortalMessageSchema` from the canvas domain (relative import per Global Constraints).
- Produces:
  - `toCanvasMessage(args: { note: CanvasNote; projectId: string; pos: { x: number; y: number; width: number; height: number }; genId: () => string; nowIso: string }): CanvasPortalMessage`.
  - `createCanvasPublisher(opts: { apiKey: string; projectId: string; _sendImpl?: (msg: unknown) => Promise<void> }): { publish(msg: unknown): Promise<void> }`.
- `projectId` and note `id`/`lastOperationId` must be UUIDs — `genId` returns `crypto.randomUUID()` in production; tests pass a UUID-producing stub.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { canvasPortalMessageSchema } from "../../../../../src/core/canvas/domain/schemas";
import { createCanvasPublisher, toCanvasMessage } from "../canvas-publish";
import type { CanvasNote } from "../types";

let n = 0;
const UUIDS = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
];
const genId = () => UUIDS[n++ % UUIDS.length];
const projectId = "99999999-9999-4999-8999-999999999999";
const pos = { x: 0, y: 0, width: 240, height: 120 };
const nowIso = "2026-08-08T00:00:00.000Z";

describe("toCanvasMessage", () => {
    it("produces a message that passes the canvas schema", () => {
        n = 0;
        const note: CanvasNote = { category: "action", text: "ship it", ownerName: "Diego", ownerParticipantId: "p1" };
        const msg = toCanvasMessage({ note, projectId, pos, genId, nowIso });
        expect(() => canvasPortalMessageSchema.parse(msg)).not.toThrow();
        expect(msg.type).toBe("workspace.element.created");
        expect(msg.ephemeral).toBe(false);
        expect(msg.senderId).toBe("meet-agent");
    });

    it("prefixes by category and appends owner", () => {
        n = 0;
        const note: CanvasNote = { category: "risk", text: "leak", ownerName: "Ana" };
        const msg = toCanvasMessage({ note, projectId, pos, genId, nowIso });
        const content = (msg.content as { element: { content: string } }).element.content;
        expect(content).toBe("⚠️ leak — @Ana");
    });

    it("gives each note distinct element ids", () => {
        n = 0;
        const a = toCanvasMessage({ note: { category: "topic", text: "a" }, projectId, pos, genId, nowIso });
        const b = toCanvasMessage({ note: { category: "topic", text: "b" }, projectId, pos, genId, nowIso });
        const idA = (a.content as { element: { id: string } }).element.id;
        const idB = (b.content as { element: { id: string } }).element.id;
        expect(idA).not.toBe(idB);
    });
});

describe("createCanvasPublisher", () => {
    it("swallows send errors", async () => {
        const _sendImpl = vi.fn(async () => {
            throw new Error("down");
        });
        const pub = createCanvasPublisher({ apiKey: "k", projectId, _sendImpl });
        await expect(pub.publish({ any: true })).resolves.toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/meet-agent && pnpm test canvas-publish` → FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import { Portal } from "@portalsdk/core";
import type { CanvasPortalMessage } from "../../../../../src/core/canvas/domain/types";
import { canvasPortalMessageSchema } from "../../../../../src/core/canvas/domain/schemas";
import type { CanvasNote, NoteCategory } from "./types";

const PREFIX: Record<NoteCategory, string> = {
    action: "✅ ",
    decision: "🔷 ",
    topic: "💬 ",
    question: "❓ ",
    risk: "⚠️ ",
};

function renderContent(note: CanvasNote): string {
    const owner = note.ownerName ? ` — @${note.ownerName}` : "";
    return `${PREFIX[note.category]}${note.text}${owner}`;
}

export function toCanvasMessage(args: {
    note: CanvasNote;
    projectId: string;
    pos: { x: number; y: number; width: number; height: number };
    genId: () => string;
    nowIso: string;
}): CanvasPortalMessage {
    const { note, projectId, pos, genId, nowIso } = args;
    const elementId = genId();
    const opId = genId();
    const element = {
        id: elementId,
        projectId,
        type: "STICKY" as const,
        content: renderContent(note),
        x: pos.x,
        y: pos.y,
        width: pos.width,
        height: pos.height,
        createdBy: "meet-agent",
        createdAt: nowIso,
        updatedAt: nowIso,
        lastOperationAt: nowIso,
        lastOperationId: opId,
    };
    const message: CanvasPortalMessage = {
        type: "workspace.element.created",
        ephemeral: false,
        senderId: "meet-agent",
        content: {
            kind: "workspace.element.created.final",
            eventId: opId,
            projectId,
            occurredAt: nowIso,
            element,
        },
    };
    return canvasPortalMessageSchema.parse(message);
}

export function createCanvasPublisher(opts: {
    apiKey: string;
    projectId: string;
    token?: string;
    _sendImpl?: (msg: CanvasPortalMessage) => Promise<void>;
}): { publish(msg: CanvasPortalMessage): Promise<void> } {
    let send = opts._sendImpl;
    const ensure = (): ((msg: CanvasPortalMessage) => Promise<void>) => {
        if (send) return send;
        const portal = new Portal({ apiKey: opts.apiKey, token: opts.token });
        const room = portal.channel<CanvasPortalMessage>(`canvas-${opts.projectId}`);
        room.acquire();
        send = async (msg) => {
            await room.send({ content: msg });
        };
        return send;
    };
    return {
        async publish(msg) {
            try {
                await ensure()(msg);
            } catch (err) {
                console.error("[canvas] publish failed (continuing):", err);
            }
        },
    };
}
```

Note: `genId` must return RFC-4111 UUIDs because `workspaceElementSchema` fields are `z.uuid()`. The real bridge passes `crypto.randomUUID`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/meet-agent && pnpm test canvas-publish` → PASS. If the cross-package import fails typecheck, confirm `apps/meet-agent/tsconfig.json` `moduleResolution` is `bundler` (it is) — the pure-zod leaf resolves. Do not add the root path to `include`.

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/bridge/canvas-publish.ts apps/meet-agent/container/src/bridge/__tests__/canvas-publish.test.ts
git commit -m "feat(bridge): canvas created.final message + publisher"
```

---

### Task 8: Bridge orchestrator (`bridge.ts`)

**Files:**
- Create: `apps/meet-agent/container/src/bridge/bridge.ts`
- Test: `apps/meet-agent/container/src/bridge/__tests__/bridge.test.ts`

**Interfaces:**
- Consumes: everything above; `TranscriptSegment`, `Participant` from `../contract/events`.
- Produces: `class Bridge`.
  - Constructor: `new Bridge(opts: { projectId: string; extractImpl: ExtractImpl; publisher: { publish(m: CanvasPortalMessage): Promise<void> }; participants: () => Iterable<Participant>; genId: () => string; now: () => number; nowIso: () => string })`.
  - `onSegment(seg: TranscriptSegment): void` — appends; if `shouldFlush`, calls `void this.flush()`.
  - `flush(): Promise<void>` — drains buffer, extracts, resolves owners, dedups, lays out, publishes each; wraps whole body in try/catch (best-effort). Tracks `alreadyEmitted` texts (feeds next prompt).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import type { Participant, TranscriptSegment } from "../../contract/events";
import { Bridge } from "../bridge";

function seg(text: string): TranscriptSegment {
    return {
        segmentId: text, meetingId: "m", speaker: { participantId: "p1", displayName: "Diego" },
        text, startedAt: "2026-08-08T00:00:00.000Z", endedAt: "2026-08-08T00:00:01.000Z",
        isFinal: true, identityConfidence: "resolved",
    };
}

let uuidN = 0;
const genId = () => `0000000${uuidN++}`.slice(-8).replace(/(.{8})/, "$1-0000-4000-8000-000000000000");

function makeBridge(extractImpl: (p: string) => Promise<string>, publish = vi.fn(async () => {})) {
    const participants: Participant[] = [{ participantId: "p1", displayName: "Diego" }];
    let clock = 0;
    const bridge = new Bridge({
        projectId: "99999999-9999-4999-8999-999999999999",
        extractImpl,
        publisher: { publish },
        participants: () => participants,
        genId,
        now: () => clock,
        nowIso: () => "2026-08-08T00:00:00.000Z",
    });
    return { bridge, publish, advance: (ms: number) => { clock = ms; } };
}

describe("Bridge", () => {
    it("publishes a canvas message per fresh note after flush", async () => {
        const extractImpl = async () => JSON.stringify({ actionItems: [{ text: "ship", owner: "Diego" }] });
        const { bridge, publish } = makeBridge(extractImpl);
        for (let i = 0; i < 8; i++) bridge.onSegment(seg(`u${i}`));
        await bridge.flush();
        expect(publish).toHaveBeenCalledTimes(1);
    });

    it("does not re-publish a note already emitted", async () => {
        const extractImpl = async () => JSON.stringify({ decisions: [{ text: "use Recall" }] });
        const { bridge, publish } = makeBridge(extractImpl);
        bridge.onSegment(seg("a"));
        await bridge.flush();
        bridge.onSegment(seg("b"));
        await bridge.flush();
        expect(publish).toHaveBeenCalledTimes(1);
    });

    it("never throws when extract fails", async () => {
        const extractImpl = async () => { throw new Error("boom"); };
        const { bridge, publish } = makeBridge(extractImpl);
        bridge.onSegment(seg("a"));
        await expect(bridge.flush()).resolves.toBeUndefined();
        expect(publish).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/meet-agent && pnpm test bridge/__tests__/bridge` → FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { CanvasPortalMessage } from "../../../../../src/core/canvas/domain/types";
import type { Participant, TranscriptSegment } from "../contract/events";
import { BridgeBuffer } from "./buffer";
import { toCanvasMessage } from "./canvas-publish";
import { NoteDedup } from "./dedup";
import { type ExtractImpl, extractNotes } from "./extract";
import { LayoutCursor } from "./layout";
import { resolveOwners } from "./owners";

type Opts = {
    projectId: string;
    extractImpl: ExtractImpl;
    publisher: { publish(m: CanvasPortalMessage): Promise<void> };
    participants: () => Iterable<Participant>;
    genId: () => string;
    now: () => number;
    nowIso: () => string;
};

export class Bridge {
    private buffer: BridgeBuffer;
    private dedup = new NoteDedup();
    private layout = new LayoutCursor();
    private emitted: string[] = [];

    constructor(private opts: Opts) {
        this.buffer = new BridgeBuffer(opts.now());
    }

    onSegment(seg: TranscriptSegment): void {
        this.buffer.append(seg);
        if (this.buffer.shouldFlush(this.opts.now())) void this.flush();
    }

    async flush(): Promise<void> {
        try {
            const { text } = this.buffer.drain(this.opts.now());
            if (!text) return;
            const raw = await extractNotes({ newText: text, alreadyEmitted: this.emitted, extractImpl: this.opts.extractImpl });
            const owned = resolveOwners(raw, this.opts.participants());
            const fresh = this.dedup.filterNew(owned);
            for (const note of fresh) {
                this.emitted.push(note.text);
                const pos = this.layout.place(note.category);
                const msg = toCanvasMessage({
                    note, projectId: this.opts.projectId, pos,
                    genId: this.opts.genId, nowIso: this.opts.nowIso(),
                });
                await this.opts.publisher.publish(msg);
            }
        } catch (err) {
            console.error("[bridge] flush failed (continuing):", err);
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/meet-agent && pnpm test bridge/__tests__/bridge` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/container/src/bridge/bridge.ts apps/meet-agent/container/src/bridge/__tests__/bridge.test.ts
git commit -m "feat(bridge): orchestrator wiring the extraction pipeline"
```

---

### Task 9: DO integration (`worker/worker.ts`)

**Files:**
- Modify: `apps/meet-agent/worker/worker.ts`
- Test: `apps/meet-agent/worker/__tests__/bridge-integration.test.ts` (new)

**Interfaces:**
- Consumes: `Bridge` from `../container/src/bridge/bridge`, `createGeminiExtractor` from `../container/src/bridge/extract`, `createCanvasPublisher` from `../container/src/bridge/canvas-publish`.
- `Env` gains `GEMINI_API_KEY: string`.
- `/start` body extends to `{ meetingUrl: string; canvasProjectId?: string }`.

Changes to `MeetingAgent`:
1. Add `Env` field `GEMINI_API_KEY: string`.
2. Add private fields: `private canvasProjectId: string | null = null;` and `private bridge: Bridge | null = null;`.
3. In `/start` handler, after reading body, capture `canvasProjectId` and, when present, build the bridge:

```ts
const { meetingUrl, canvasProjectId } = (await req.json()) as { meetingUrl?: string; canvasProjectId?: string };
// ...existing meetingUrl guard + createRecallBot...
if (canvasProjectId) {
    this.canvasProjectId = canvasProjectId;
    this.bridge = new Bridge({
        projectId: canvasProjectId,
        extractImpl: createGeminiExtractor({ apiKey: this.env.GEMINI_API_KEY }),
        publisher: createCanvasPublisher({ apiKey: this.env.PORTAL_API_KEY, projectId: canvasProjectId }),
        participants: () => this.participants.values(),
        genId: () => crypto.randomUUID(),
        now: () => Date.now(),
        nowIso: () => new Date().toISOString(),
    });
}
```

4. In `emit(ev)`, after the existing buffer/publish, feed the bridge:

```ts
if (this.bridge && ev.type === "transcript.segment" && ev.segment.isFinal) {
    this.bridge.onSegment(ev.segment);
}
```

5. In `/stop` handler, before setting `state = "ended"`, drain the remainder: `if (this.bridge) await this.bridge.flush().catch(() => {});`

**Note (interface caution):** Tests dispatch through the DO via a fake. To test without a live DO harness, this task's test instead unit-tests the wiring predicate by constructing a `MeetingAgent`-like scenario is impractical; instead assert the two pure conditions in isolation.

- [ ] **Step 1: Write the failing test**

The DO is hard to instantiate standalone (extends `DurableObject`). Test the wiring decision as a pure helper. Add and export a small predicate in `worker.ts`:

```ts
export function bridgeShouldConsume(ev: AgentEvent): boolean {
    return ev.type === "transcript.segment" && ev.segment.isFinal;
}
```

Test:

```ts
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../container/src/contract/events";
import { bridgeShouldConsume } from "../worker";

const finalSeg: AgentEvent = {
    type: "transcript.segment",
    segment: {
        segmentId: "s", meetingId: "m", speaker: { kind: "unresolved" },
        text: "hi", startedAt: "2026-08-08T00:00:00.000Z", endedAt: "2026-08-08T00:00:01.000Z",
        isFinal: true, identityConfidence: "unresolved",
    },
};

describe("bridgeShouldConsume", () => {
    it("consumes final transcript segments", () => {
        expect(bridgeShouldConsume(finalSeg)).toBe(true);
    });
    it("skips non-final segments", () => {
        const partial = { ...finalSeg, segment: { ...finalSeg.segment, isFinal: false } } as AgentEvent;
        expect(bridgeShouldConsume(partial)).toBe(false);
    });
    it("skips non-transcript events", () => {
        expect(bridgeShouldConsume({ type: "session.ended", meetingId: "m", at: "t", reason: "x" })).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/meet-agent && pnpm test bridge-integration` → FAIL (`bridgeShouldConsume` not exported).

- [ ] **Step 3: Write minimal implementation**

Apply changes 1–5 above to `worker.ts`, add the exported `bridgeShouldConsume` predicate, and use it in `emit`:

```ts
if (this.bridge && bridgeShouldConsume(ev)) this.bridge.onSegment((ev as { segment: TranscriptSegment }).segment);
```

Add imports at top of `worker.ts`:

```ts
import { Bridge } from "../container/src/bridge/bridge";
import { createGeminiExtractor } from "../container/src/bridge/extract";
import { createCanvasPublisher } from "../container/src/bridge/canvas-publish";
import type { TranscriptSegment } from "../container/src/contract/events";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/meet-agent && pnpm test` → all suites PASS. Then `pnpm typecheck` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/meet-agent/worker/worker.ts apps/meet-agent/worker/__tests__/bridge-integration.test.ts
git commit -m "feat(bridge): wire bridge into MeetingAgent DO"
```

---

### Task 10: Config + docs

**Files:**
- Modify: `apps/meet-agent/wrangler.jsonc` (no secret values — document only)
- Modify: `apps/meet-agent/README.md`, `apps/meet-agent/SMOKE.md`

- [ ] **Step 1: Add `GEMINI_API_KEY` to the secrets list**

In `README.md` deploy section and `SMOKE.md`, add:

```bash
wrangler secret put GEMINI_API_KEY
```

Document `/start` new body field `canvasProjectId` (optional; omit → transcription-only, bridge disabled) and the canvas Portal channel `canvas-{projectId}`.

- [ ] **Step 2: Add a smoke step**

In `SMOKE.md`, add: "Start a bot with `canvasProjectId`; speak a clear action item; within ~30s confirm a `created.final` STICKY appears on Portal channel `canvas-{projectId}`. Verify no-`canvasProjectId` start still transcribes."

- [ ] **Step 3: Commit**

```bash
git add apps/meet-agent/README.md apps/meet-agent/SMOKE.md apps/meet-agent/wrangler.jsonc
git commit -m "docs(bridge): GEMINI_API_KEY secret + canvas smoke steps"
```

---

## Self-Review

- **Spec coverage:** buffer (T2), extract+Gemini (T6), dedup (T3), owners (T4), layout (T5), canvas-publish (T7), orchestrator (T8), DO integration + `/start` projectId + `/stop` drain (T9), secret+docs (T10), contracts (T1). All spec components covered.
- **Type consistency:** `CanvasNote` shape identical across tasks; `LayoutCursor.place` return shape matches `toCanvasMessage` `pos` param; `ExtractImpl` signature consistent T6→T8; `CanvasPortalMessage` from canvas domain used in T7/T8.
- **Placeholders:** none — every step has concrete code.
- **Known risk flagged:** cross-package zod import (T7) — mitigation documented (bundler resolution, pure-zod leaf).
- **Best-effort invariant:** every external call (extract, publish, flush) wrapped in try/catch returning safe defaults.
```
