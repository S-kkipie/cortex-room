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
                className="absolute right-4 bottom-4 z-10 flex items-center rounded-lg border bg-background/95 p-1 shadow-lg backdrop-blur"
            >
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
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
                <span
                    aria-live="polite"
                    className="min-w-14 px-2 text-center font-medium text-xs tabular-nums"
                >
                    <span className="sr-only">Zoom </span>
                    {percentage}%
                </span>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
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
                <Separator orientation="vertical" className="mx-1 h-6" />
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
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
