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
