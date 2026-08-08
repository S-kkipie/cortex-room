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
