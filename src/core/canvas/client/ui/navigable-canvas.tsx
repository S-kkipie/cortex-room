"use client";

import {
    Background,
    BackgroundVariant,
    type Edge,
    type Node,
    ReactFlow,
    ReactFlowProvider,
    type Viewport,
} from "@xyflow/react";
import { useState } from "react";
import { CanvasViewportControls } from "@/core/canvas/client/ui/canvas-viewport-controls";
import {
    INITIAL_VIEWPORT,
    MAX_ZOOM,
    MIN_ZOOM,
} from "@/core/canvas/client/viewport";

const EMPTY_NODES: Node[] = [];
const EMPTY_EDGES: Edge[] = [];

export function NavigableCanvas() {
    const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);

    return (
        <div
            data-testid="navigable-canvas"
            className="relative size-full overflow-hidden"
        >
            <ReactFlowProvider>
                <ReactFlow
                    nodes={EMPTY_NODES}
                    edges={EMPTY_EDGES}
                    viewport={viewport}
                    onViewportChange={setViewport}
                    minZoom={MIN_ZOOM}
                    maxZoom={MAX_ZOOM}
                    panOnDrag
                    zoomOnScroll
                    zoomOnPinch
                    aria-label="Canvas"
                >
                    <Background
                        variant={BackgroundVariant.Dots}
                        gap={24}
                        size={1}
                        color="var(--muted-foreground)"
                        style={{ opacity: 1 }}
                    />
                </ReactFlow>
                <CanvasViewportControls viewport={viewport} />
            </ReactFlowProvider>
        </div>
    );
}
