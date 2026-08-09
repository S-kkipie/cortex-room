import type { Viewport } from "@xyflow/react";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
export const ZOOM_FACTOR = 1.2;
export const VIEWPORT_ANIMATION_DURATION_MS = 200;

export const INITIAL_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

type ZoomDirection = "in" | "out";

export function getNextZoom(zoom: number, direction: ZoomDirection) {
    const nextZoom =
        direction === "in" ? zoom * ZOOM_FACTOR : zoom / ZOOM_FACTOR;

    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
}

export function getZoomPercentage(zoom: number) {
    return Math.round(zoom * 100);
}
