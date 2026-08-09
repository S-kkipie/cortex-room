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
