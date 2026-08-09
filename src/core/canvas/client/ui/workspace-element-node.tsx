"use client";

import { type NodeProps, NodeResizer } from "@xyflow/react";
import { useCanvasController } from "@/core/canvas/client/controller/canvas-controller-context";
import type { CanvasPreview } from "@/core/canvas/client/controller/canvas-preview";
import {
    getElementDefaults,
    parseCardContent,
} from "@/core/canvas/client/controller/element-defaults";
import type { WorkspaceElementNode as WorkspaceElementNodeModel } from "@/core/canvas/client/controller/to-react-flow-nodes";
import type { WorkspaceElement } from "@/core/canvas/domain/types";
import { WorkspaceElementEditor } from "./workspace-element-editor";

function ElementContent({
    element,
    preview,
}: {
    element: WorkspaceElement;
    preview?: CanvasPreview;
}) {
    const content = preview?.content ?? element.content;
    if (element.type === "CARD") {
        const { title, description } = parseCardContent(content);

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
            {content || "Double-click to edit"}
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
    const { element, preview } = data;
    const remoteSelectedBy = data.remoteSelectedBy ?? [];
    const defaults = getElementDefaults(element.type);
    const isEditing = editingElementId === element.id;
    const remoteSelectionLabel = remoteSelectedBy
        .map((participant) => participant.label)
        .join(", ");

    return (
        // React Flow owns keyboard focus and node interaction for this container.
        // The double-click gesture only switches the selected node into editing.
        // biome-ignore lint/a11y/noStaticElementInteractions: React Flow node container
        <div
            data-element-type={element.type}
            className={`relative h-full w-full rounded-xl border p-4 shadow-sm ${
                element.type === "STICKY"
                    ? "border-amber-300 bg-amber-100/95 dark:border-amber-700 dark:bg-amber-950/70"
                    : element.type === "CARD"
                      ? "border-border bg-card"
                      : element.type === "HEADING"
                        ? "border-transparent bg-transparent p-2 shadow-none"
                        : "border-border/70 bg-background/95"
            } ${remoteSelectedBy.length ? "ring-2 ring-sky-500/70 ring-offset-2 ring-offset-background" : ""}`}
            onDoubleClick={(event) => {
                event.stopPropagation();
                beginEditing(element.id);
            }}
        >
            {remoteSelectionLabel ? (
                <span className="pointer-events-none absolute -top-3 right-2 z-10 rounded-full bg-sky-500 px-2 py-0.5 font-medium text-[10px] text-white shadow-sm">
                    {remoteSelectionLabel}
                </span>
            ) : null}
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
                <ElementContent element={element} preview={preview} />
            )}
        </div>
    );
}

export const WORKSPACE_NODE_TYPES = {
    workspaceElement: WorkspaceElementNode,
};
