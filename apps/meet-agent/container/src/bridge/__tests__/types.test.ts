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
