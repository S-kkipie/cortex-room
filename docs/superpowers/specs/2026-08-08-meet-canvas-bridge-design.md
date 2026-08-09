# Meet → Canvas Bridge Design

**Date:** 2026-08-08
**Status:** Approved (design)
**Scope:** Real-time AI note extraction from Meet transcript, published as canvas elements. Extends the existing `apps/meet-agent` Recall integration. Does NOT modify the canvas server (no mutation service exists yet — writes go via Portal directly).

## Goal

Turn live Meet transcription into structured sticky notes on the collaborative canvas: action items, decisions, topics, questions, and risks — attributed to identified participants where possible.

## Architecture

Extend the **MeetingAgent Durable Object** with a `bridge/` module. The DO already owns the transcript stream, the participants map, and a Portal publisher. The bridge adds: a windowed accumulator, a Gemini extraction call, dedup, layout, and a second Portal publisher targeting the canvas channel.

The bridge is **best-effort**: any failure (Gemini timeout, canvas publish error) is logged and swallowed. It never interrupts transcription — preserving the graceful-degradation invariant of the meet-agent.

```
transcript.segment (isFinal)  ── inside DO.emit()
   → BridgeBuffer.append(segment)
   → trigger when: 30s elapsed since last flush  OR  8 new final utterances
   → drain() → newText + speaker attributions
   → extractNotes({ newText, alreadyEmitted, participants })   [Gemini]
      → { actionItems[], decisions[], topics[], questions[], risks[] }
   → resolveOwners(notes, participants)        name → participantId
   → dedup(notes)                              drop fingerprints already emitted
   → layout(freshNotes)                        column per category, vertical stack
   → canvasPublish(note)                       → canvasPortalMessage created.final
   → Portal channel `canvas-{projectId}`
```

## Global Constraints

- Runtime: Cloudflare Workers (WebCrypto, `fetch`; no Node APIs). Same as existing meet-agent.
- Language/format: TypeScript, 4-space indent, Biome (meet-agent's own config, not repo root).
- Zod v4 for all contracts. Reuse `apps/meet-agent/container/src/contract/events.ts`.
- Canvas wire contract is authoritative and **unchanged**: `src/core/canvas/domain/schemas.ts`. The bridge produces messages that pass `canvasPortalMessageSchema` verbatim — including the `created.final` superRefine (`eventId === element.lastOperationId`, `occurredAt === element.lastOperationAt`, matching `projectId`).
- Secrets via `wrangler secret put` only. New: `GEMINI_API_KEY`. Never in code/vars/chat.
- No real LLM calls in tests. Gemini client is injected (`extractImpl`).
- Best-effort invariant: bridge errors never propagate to transcript handling.

## Components

All new files under `apps/meet-agent/container/src/bridge/`.

### `types.ts`
Canonical bridge contracts (Zod).

```ts
export const noteCategorySchema = z.enum(["action", "decision", "topic", "question", "risk"]);

export const canvasNoteSchema = z.object({
    category: noteCategorySchema,
    text: z.string().min(1),
    ownerName: z.string().optional(),      // raw name from Gemini, pre-resolution
    ownerParticipantId: z.string().optional(), // filled by resolveOwners
});
export type CanvasNote = z.infer<typeof canvasNoteSchema>;

export const extractionSchema = z.object({
    actionItems: z.array(z.object({ text: z.string(), owner: z.string().optional() })).default([]),
    decisions: z.array(z.object({ text: z.string() })).default([]),
    topics: z.array(z.object({ text: z.string() })).default([]),
    questions: z.array(z.object({ text: z.string(), owner: z.string().optional() })).default([]),
    risks: z.array(z.object({ text: z.string() })).default([]),
});
```

### `buffer.ts`
`BridgeBuffer` — accumulates final utterances since last flush.
- `append(segment: TranscriptSegment): void` — ignores non-final; stores `{ speakerName, text }`.
- `shouldFlush(nowMs): boolean` — true when `count >= 8` OR `nowMs - lastFlushMs >= 30_000` and buffer non-empty.
- `drain(nowMs): { text: string }` — concatenates buffered lines as `"<speaker>: <text>"`, clears buffer, sets lastFlushMs.

### `extract.ts`
`extractNotes({ newText, alreadyEmitted, extractImpl }): Promise<CanvasNote[]>`.
- Builds a prompt: system instruction + the new transcript window + the list of already-emitted note texts ("do NOT repeat these"). Instructs Gemini to return ONLY new items, `[]` when nothing new, as strict JSON matching `extractionSchema`.
- Calls `extractImpl(prompt)` (injected; real impl = Gemini fetch). Parses + validates with `extractionSchema`. Flattens the five arrays into `CanvasNote[]` tagging each with its `category`.
- On parse/validation failure or thrown error: return `[]` (best-effort).

`createGeminiExtractor({ apiKey, model }): ExtractImpl` — real fetch to `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, `response_mime_type: application/json`. Model default `gemini-2.0-flash`.

### `dedup.ts`
`NoteDedup` — holds a `Set<string>` of fingerprints.
- `fingerprint(note): string` — `category + "|" + normalize(text)` (lowercase, collapse whitespace, strip trailing punctuation).
- `filterNew(notes): CanvasNote[]` — returns notes whose fingerprint is unseen; adds them to the set.

### `owners.ts`
`resolveOwners(notes, participants): CanvasNote[]` — for each note with `ownerName`, case-insensitive match against `participant.displayName`; on match set `ownerParticipantId`. No match → leave name, id undefined.

### `layout.ts`
`LayoutCursor` — assigns non-overlapping positions.
- Column per category, fixed order: action, decision, topic, question, risk.
- Column X = `categoryIndex * (WIDTH + GAP_X)`; each new note in a column stacks: `y = count[category] * (HEIGHT + GAP_Y)`.
- `WIDTH=240, HEIGHT=120, GAP_X=40, GAP_Y=24`. Returns `{ x, y, width, height }`.

### `canvas-publish.ts`
`toCanvasMessage({ note, projectId, pos, genId, nowIso }): CanvasPortalMessage`.
- Builds a `WorkspaceElement`: `id=genId()`, `projectId`, `type:"STICKY"`, `content = prefix(category) + text`, position/size from `pos`, `createdBy:"meet-agent"`, all timestamps = `nowIso`, `lastOperationId = opId = genId()`.
- Wraps in `created.final` event: `eventId = opId`, `occurredAt = nowIso`, `projectId` — so the superRefine passes.
- Envelope: `{ type:"workspace.element.created", ephemeral:false, senderId:"meet-agent", content: event }`.
- Category prefix: action `✅ `, decision `🔷 `, topic `💬 `, question `❓ `, risk `⚠️ `. Owner suffix ` — @<displayName>` when resolved.
- Validate against `canvasPortalMessageSchema` before returning; throw on failure (caller swallows).

`createCanvasPublisher({ apiKey, projectId })` — Portal publisher to channel `canvas-{projectId}`, best-effort (mirrors `emit/portal.ts`).

## DO Integration (`worker/worker.ts`)

- `/start` body: `{ meetingUrl, canvasProjectId }`. Store `this.canvasProjectId`. If absent, bridge is disabled (transcription-only, back-compat).
- In `emit(ev)`: when `ev.type === "transcript.segment" && ev.segment.isFinal && this.canvasProjectId`, feed `this.bridge.onSegment(ev.segment)`.
- `bridge.onSegment` appends to buffer; when `shouldFlush`, runs the pipeline in a `void`-ed async task (never awaited in the request path) wrapped in try/catch.
- Gemini/canvas secrets read from `this.env` (`GEMINI_API_KEY`, `PORTAL_API_KEY`).
- Optional flush on `/stop` to drain remainder.

## Data Flow Summary

| Stage | Input | Output |
|---|---|---|
| buffer | final segments | 30s/8-utterance window text |
| extract | window + emitted list | `CanvasNote[]` (Gemini) |
| owners | notes + participants map | notes with `ownerParticipantId` |
| dedup | notes | fresh notes only |
| layout | fresh notes | notes + positions |
| publish | note + pos + projectId | `canvasPortalMessage` → Portal |

## Error Handling

- Gemini error/timeout/bad JSON → `extractNotes` returns `[]`; window discarded; next window proceeds.
- `toCanvasMessage` validation throw → that note skipped; others in the batch still publish.
- Portal publish failure → swallowed (best-effort publisher).
- No `canvasProjectId` → bridge inert; transcription unaffected.
- **No persistence:** notes live only on the Portal channel. A canvas client that joins/refreshes later does NOT see prior AI notes until the canvas mutation service exists (future work). Accepted trade-off.

## Testing

Unit (Vitest, no network):
- `buffer`: trigger at 8 utterances; trigger at 30s; ignores non-final; drain clears + resets.
- `extract`: injected `extractImpl` returning fixture JSON → correct `CanvasNote[]` with categories; malformed JSON → `[]`; thrown error → `[]`; dedup-hint list included in prompt.
- `owners`: name matches displayName (case-insensitive) → id set; no match → id undefined.
- `dedup`: same text different whitespace/case → filtered; different category same text → kept.
- `layout`: notes in same category stack vertically; different categories different X; no overlap.
- `canvas-publish`: output passes `canvasPortalMessageSchema`; prefix + owner suffix correct; distinct ids per note.
- DO integration: final segment with `canvasProjectId` triggers pipeline (mock extractor); no projectId → no bridge calls; bridge error does not throw from `emit`.

## Out of Scope

- Canvas persistence / mutation service (compañero, future).
- Update/move/delete of AI notes (create-only for now).
- Non-STICKY element types.
- Multi-language prompt tuning (English/Spanish handled by Gemini natively; no special handling).
