import { describe, expect, it } from "vitest";
import {
    ELEMENT_DEFAULTS,
    getElementDefaults,
    parseCardContent,
} from "@/core/canvas/client/controller/element-defaults";

describe("canvas element defaults", () => {
    it("defines the approved initial and minimum dimensions", () => {
        expect(ELEMENT_DEFAULTS).toEqual({
            STICKY: { width: 240, height: 180, minWidth: 160, minHeight: 100 },
            TEXT: { width: 280, height: 120, minWidth: 160, minHeight: 64 },
            CARD: { width: 320, height: 200, minWidth: 220, minHeight: 120 },
            HEADING: { width: 360, height: 96, minWidth: 200, minHeight: 64 },
        });
        expect(getElementDefaults("CARD").width).toBe(320);
    });

    it("parses the first card line as title and the rest as description", () => {
        expect(parseCardContent("Title\nDescription\n")).toEqual({
            title: "Title",
            description: "Description",
        });
    });

    it("allows an empty card content", () => {
        expect(parseCardContent("")).toEqual({ title: "", description: "" });
    });
});
