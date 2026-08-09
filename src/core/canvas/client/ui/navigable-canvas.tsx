"use client";

import { ReactFlowProvider, type Viewport } from "@xyflow/react";
import { useState } from "react";
import { CanvasControllerProvider } from "@/core/canvas/client/controller/canvas-controller-context";
import { CanvasEditor } from "@/core/canvas/client/ui/canvas-editor";
import { CanvasViewportControls } from "@/core/canvas/client/ui/canvas-viewport-controls";
import { INITIAL_VIEWPORT } from "@/core/canvas/client/viewport";

export function NavigableCanvas({
    projectId,
    userId,
}: {
    projectId: string;
    userId: string;
}) {
    const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);

    return (
        <div
            data-testid="navigable-canvas"
            className="relative size-full overflow-hidden"
        >
            <ReactFlowProvider>
                <CanvasControllerProvider projectId={projectId} userId={userId}>
                    <CanvasEditor
                        viewport={viewport}
                        onViewportChange={setViewport}
                    />
                    <CanvasViewportControls viewport={viewport} />
                </CanvasControllerProvider>
            </ReactFlowProvider>
        </div>
    );
}
