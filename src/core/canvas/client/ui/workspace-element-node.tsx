"use client";

import { type NodeProps, NodeResizer } from "@xyflow/react";
import { useCanvasController } from "@/core/canvas/client/controller/canvas-controller-context";
import {
    getElementDefaults,
    parseCardContent,
} from "@/core/canvas/client/controller/element-defaults";
import type { WorkspaceElementNode as WorkspaceElementNodeModel } from "@/core/canvas/client/controller/to-react-flow-nodes";
import type { WorkspaceElement } from "@/core/canvas/domain/types";
import { WorkspaceElementEditor } from "./workspace-element-editor";

function ElementContent({ element }: { element: WorkspaceElement }) {
    if (element.type === "CARD") {
        const { title, description } = parseCardContent(element.content);

        return (
            <>
                <p className="font-semibold text-sm">
                    {title || "Untitled card"}
                </p>
                {description ? (
                    <p className="mt-2 whitespace-pre-wrap text-muted-foreground text-xs">
                        {description}
                    </p>
                ) : null}
            </>
        );
    }

    return (
        <p
            className={
                element.type === "HEADING"
                    ? "font-semibold text-2xl"
                    : "whitespace-pre-wrap text-sm"
            }
        >
            {element.content || "Double-click to edit"}
        </p>
    );
}

export function WorkspaceElementNode({
    data,
    selected,
}: NodeProps<WorkspaceElementNodeModel>) {
    const {
        actions,
        editingElementId,
        beginEditing,
        setResizePreview,
        clearPreview,
    } = useCanvasController();
    const { element } = data;
    const defaults = getElementDefaults(element.type);
    const isEditing = editingElementId === element.id;

    return (
        // React Flow owns keyboard focus and node interaction for this container.
        // The double-click gesture only switches the selected node into editing.
        // biome-ignore lint/a11y/noStaticElementInteractions: React Flow node container
        <div
            data-element-type={element.type}
            className={`h-full w-full rounded-xl border p-4 shadow-sm ${
                element.type === "STICKY"
                    ? "border-amber-300 bg-amber-100/95 dark:border-amber-700 dark:bg-amber-950/70"
                    : element.type === "CARD"
                      ? "border-border bg-card"
                      : element.type === "HEADING"
                        ? "border-transparent bg-transparent p-2 shadow-none"
                        : "border-border/70 bg-background/95"
            }`}
            onDoubleClick={(event) => {
                event.stopPropagation();
                beginEditing(element.id);
            }}
        >
            {selected ? (
                <NodeResizer
                    isVisible
                    minWidth={defaults.minWidth}
                    minHeight={defaults.minHeight}
                    onResize={(_event, params) =>
                        setResizePreview(element.id, {
                            width: params.width,
                            height: params.height,
                        })
                    }
                    onResizeEnd={(_event, params) => {
                        clearPreview(element.id);
                        void Promise.resolve(
                            actions.resizeElement(element.id, {
                                width: params.width,
                                height: params.height,
                            }),
                        ).catch(() => undefined);
                    }}
                />
            ) : null}
            {isEditing ? (
                <WorkspaceElementEditor element={element} />
            ) : (
                <ElementContent element={element} />
            )}
        </div>
    );
}

export const WORKSPACE_NODE_TYPES = {
    workspaceElement: WorkspaceElementNode,
};
