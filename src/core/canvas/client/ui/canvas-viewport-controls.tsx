"use client";

import { useReactFlow, type Viewport } from "@xyflow/react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
    getNextZoom,
    getZoomPercentage,
    INITIAL_VIEWPORT,
    MAX_ZOOM,
    MIN_ZOOM,
    VIEWPORT_ANIMATION_DURATION_MS,
} from "@/core/canvas/client/viewport";
import { Button } from "@/frontend/components/ui/button";
import { Separator } from "@/frontend/components/ui/separator";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/frontend/components/ui/tooltip";

export function CanvasViewportControls({ viewport }: { viewport: Viewport }) {
    const { setViewport, zoomTo } = useReactFlow();
    const percentage = getZoomPercentage(viewport.zoom);

    const zoom = (direction: "in" | "out") => {
        void zoomTo(getNextZoom(viewport.zoom, direction), {
            duration: VIEWPORT_ANIMATION_DURATION_MS,
        });
    };

    const reset = () => {
        void setViewport(INITIAL_VIEWPORT, {
            duration: VIEWPORT_ANIMATION_DURATION_MS,
        });
    };

    return (
        <TooltipProvider>
            <fieldset
                aria-label="Canvas zoom controls"
                className="canvas-viewport-controls"
            >
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="canvas-control-button"
                            aria-label="Zoom out"
                            disabled={viewport.zoom <= MIN_ZOOM}
                            onClick={() => zoom("out")}
                        >
                            <Minus />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>
                        Zoom out
                    </TooltipContent>
                </Tooltip>
                <span aria-live="polite" className="canvas-zoom-value">
                    <span className="sr-only">Zoom </span>
                    {percentage}%
                </span>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="canvas-control-button"
                            aria-label="Zoom in"
                            disabled={viewport.zoom >= MAX_ZOOM}
                            onClick={() => zoom("in")}
                        >
                            <Plus />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>
                        Zoom in
                    </TooltipContent>
                </Tooltip>
                <Separator
                    orientation="vertical"
                    className="canvas-controls-separator"
                />
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="canvas-control-button"
                            aria-label="Reset viewport"
                            onClick={reset}
                        >
                            <RotateCcw />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>
                        Reset viewport
                    </TooltipContent>
                </Tooltip>
            </fieldset>
        </TooltipProvider>
    );
}
