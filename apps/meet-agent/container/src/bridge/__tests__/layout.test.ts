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
