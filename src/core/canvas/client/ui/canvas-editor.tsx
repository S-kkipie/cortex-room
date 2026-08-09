"use client";

import {
    Background,
    BackgroundVariant,
    type Edge,
    ReactFlow,
    useReactFlow,
    type Viewport,
} from "@xyflow/react";
import { AlertTriangle } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useCallback, useEffect, useMemo } from "react";
import {
    type CanvasTool,
    useCanvasController,
} from "@/core/canvas/client/controller/canvas-controller-context";
import { getElementDefaults } from "@/core/canvas/client/controller/element-defaults";
import {
    toReactFlowNodes,
    type WorkspaceElementNode,
} from "@/core/canvas/client/controller/to-react-flow-nodes";
import {
    INITIAL_VIEWPORT,
    MAX_ZOOM,
    MIN_ZOOM,
} from "@/core/canvas/client/viewport";
import type { WorkspaceElementType } from "@/core/canvas/domain/types";
import { Button } from "@/frontend/components/ui/button";
import { CanvasConnectionStatus } from "./canvas-connection-status";
import { CanvasRemoteCursors } from "./canvas-remote-cursors";
import { CanvasToolbar } from "./canvas-toolbar";
import { WORKSPACE_NODE_TYPES } from "./workspace-element-node";

const EMPTY_EDGES: Edge[] = [];
const EMPTY_NODES: WorkspaceElementNode[] = [];
const ELEMENT_TOOLS: WorkspaceElementType[] = [
    "STICKY",
    "TEXT",
    "CARD",
    "HEADING",
];

function isElementTool(tool: CanvasTool): tool is WorkspaceElementType {
    return ELEMENT_TOOLS.includes(tool as WorkspaceElementType);
}

function isTextInput(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
    );
}

export function CanvasEditor({
    viewport = INITIAL_VIEWPORT,
    onViewportChange,
}: {
    viewport?: Viewport;
    onViewportChange?: (nextViewport: Viewport) => void;
}) {
    const { fitView, screenToFlowPosition, setNodes } = useReactFlow();
    const {
        actions,
        activeTool,
        beginEditing,
        clearPreview,
        editingElementId,
        error,
        fitViewHasRun,
        isLoading,
        markFitViewComplete,
        previews,
        publishCursor,
        remoteParticipants,
        retry,
        selectedElementIds,
        setActiveTool,
        setMovePreview,
        snapshot,
    } = useCanvasController();
    const nodes = useMemo(
        () =>
            toReactFlowNodes(
                snapshot?.elements ?? [],
                previews,
                selectedElementIds,
                remoteParticipants,
            ),
        [remoteParticipants, snapshot?.elements, previews, selectedElementIds],
    );

    const handleCanvasMouseMove = useCallback(
        (event: MouseEvent<HTMLDivElement>) => {
            publishCursor(
                screenToFlowPosition({
                    x: event.clientX,
                    y: event.clientY,
                }),
            );
        },
        [publishCursor, screenToFlowPosition],
    );

    const handleNodeDrag = useCallback(
        (
            _event: unknown,
            node: { id: string; position: { x: number; y: number } },
        ) => {
            if (activeTool === "select") {
                setMovePreview(node.id, node.position);
            }
        },
        [activeTool, setMovePreview],
    );

    const handleNodeDragStop = useCallback(
        async (
            _event: unknown,
            node: { id: string; position: { x: number; y: number } },
        ) => {
            if (activeTool !== "select") return;
            try {
                await actions.moveElement(node.id, node.position);
            } catch {
                // The controller already surfaces persistence errors.
            } finally {
                clearPreview(node.id);
            }
        },
        [actions, activeTool, clearPreview],
    );

    useEffect(() => {
        setNodes(nodes);
    }, [nodes, setNodes]);

    useEffect(() => {
        if (!snapshot || fitViewHasRun) return;
        if (snapshot.elements.length === 0) {
            markFitViewComplete();
            return;
        }

        void fitView({
            duration: 200,
            maxZoom: 1,
            padding: 0.2,
        });
        markFitViewComplete();
    }, [fitView, fitViewHasRun, markFitViewComplete, snapshot]);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (
            editingElementId ||
            isTextInput(event.target) ||
            !["Delete", "Backspace"].includes(event.key)
        ) {
            return;
        }

        const elementId = selectedElementIds[0];
        if (!elementId) return;

        event.preventDefault();
        void Promise.resolve(actions.deleteElement(elementId)).catch(
            () => undefined,
        );
        actions.selectElements([]);
        setActiveTool("select");
    };

    return (
        <div
            aria-label="Canvas editor"
            className="canvas-editor relative size-full"
            onKeyDown={handleKeyDown}
            role="application"
            onMouseMove={handleCanvasMouseMove}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Canvas editor is the keyboard focus target
            tabIndex={0}
        >
            {isLoading ? (
                <div
                    aria-live="polite"
                    className="canvas-overlay canvas-loading-overlay pointer-events-none absolute inset-0 z-20"
                >
                    <div className="canvas-loading-card">
                        <span className="canvas-loader" aria-hidden="true" />
                        <span>Loading canvas</span>
                    </div>
                </div>
            ) : null}
            {error ? (
                <div className="canvas-overlay canvas-error-overlay absolute inset-0 z-20">
                    <div aria-live="assertive" className="canvas-error-card">
                        <span className="canvas-error-icon" aria-hidden="true">
                            <AlertTriangle />
                        </span>
                        <p className="canvas-error-title">
                            Unable to load canvas
                        </p>
                        <p className="canvas-error-copy">
                            Try again or return to projects if the problem
                            continues.
                        </p>
                        <Button
                            className="canvas-retry-button"
                            type="button"
                            onClick={retry}
                        >
                            Retry
                        </Button>
                    </div>
                </div>
            ) : null}
            <CanvasToolbar />
            <CanvasConnectionStatus />
            <ReactFlow
                aria-label="Canvas"
                defaultNodes={EMPTY_NODES}
                edges={EMPTY_EDGES}
                nodeTypes={WORKSPACE_NODE_TYPES}
                viewport={viewport}
                onViewportChange={onViewportChange}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                panOnDrag={activeTool === "select" || activeTool === "hand"}
                zoomOnScroll
                zoomOnPinch
                nodesDraggable={activeTool === "select"}
                elementsSelectable={activeTool === "select"}
                nodesConnectable={false}
                selectionOnDrag={false}
                onPaneClick={(event) => {
                    if (!isElementTool(activeTool)) {
                        actions.selectElements([]);
                        return;
                    }

                    const position = screenToFlowPosition({
                        x: event.clientX,
                        y: event.clientY,
                    });
                    const defaults = getElementDefaults(activeTool);
                    const creation = actions.createElement({
                        type: activeTool,
                        content: "",
                        x: position.x - defaults.width / 2,
                        y: position.y - defaults.height / 2,
                        width: defaults.width,
                        height: defaults.height,
                    });

                    setActiveTool("select");
                    void creation
                        .then((result) => {
                            if (
                                result.applied &&
                                !("deletedAt" in result.record)
                            ) {
                                beginEditing(result.record.id);
                            }
                        })
                        .catch(() => undefined);
                }}
                onNodeClick={(_event, node) => {
                    if (activeTool === "select")
                        actions.selectElements([node.id]);
                }}
                onNodeDoubleClick={(event, node) => {
                    event.stopPropagation();
                    if (activeTool === "select") beginEditing(node.id);
                }}
                onNodeDrag={handleNodeDrag}
                onNodeDragStop={handleNodeDragStop}
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={24}
                    size={1}
                    color="var(--canvas-grid)"
                    style={{ opacity: 1 }}
                />
                <CanvasRemoteCursors participants={remoteParticipants} />
            </ReactFlow>
        </div>
    );
}
