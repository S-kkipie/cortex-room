import { describe, expect, it } from "vitest";
import {
    getNextZoom,
    getZoomPercentage,
    INITIAL_VIEWPORT,
    MAX_ZOOM,
    MIN_ZOOM,
    VIEWPORT_ANIMATION_DURATION_MS,
} from "@/core/canvas/client/viewport";

describe("canvas viewport contract", () => {
    it("starts at the origin with 100% zoom", () => {
        expect(INITIAL_VIEWPORT).toEqual({ x: 0, y: 0, zoom: 1 });
        expect(MIN_ZOOM).toBe(0.25);
        expect(MAX_ZOOM).toBe(2);
        expect(VIEWPORT_ANIMATION_DURATION_MS).toBe(200);
    });

    it("calculates bounded zoom steps", () => {
        expect(getNextZoom(1, "in")).toBe(1.2);
        expect(getNextZoom(1, "out")).toBeCloseTo(1 / 1.2);
        expect(getNextZoom(1.9, "in")).toBe(MAX_ZOOM);
        expect(getNextZoom(0.3, "out")).toBe(MIN_ZOOM);
    });

    it("rounds the visible zoom percentage", () => {
        expect(getZoomPercentage(1)).toBe(100);
        expect(getZoomPercentage(1.245)).toBe(125);
        expect(getZoomPercentage(0.25)).toBe(25);
    });
});
