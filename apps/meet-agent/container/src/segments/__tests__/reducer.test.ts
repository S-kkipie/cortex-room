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
