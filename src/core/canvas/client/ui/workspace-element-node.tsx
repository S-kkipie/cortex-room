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
                <p className="canvas-node__title font-semibold text-sm">
                    {title || "Untitled card"}
                </p>
                {description ? (
                    <p className="canvas-node__description mt-2 whitespace-pre-wrap text-xs">
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
                    ? "canvas-node__heading font-semibold text-2xl"
                    : "canvas-node__text whitespace-pre-wrap text-sm"
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
    const nodeClassName = [
        "canvas-node",
        `canvas-node--${element.type.toLowerCase()}`,
        selected ? "canvas-node--selected" : "",
        remoteSelectedBy.length
            ? "canvas-node--remote ring-2 ring-sky-500/70 ring-offset-2 ring-offset-background"
            : "",
    ]
        .filter(Boolean)
        .join(" ");

    return (
        // React Flow owns keyboard focus and node interaction for this container.
        // The double-click gesture only switches the selected node into editing.
        // biome-ignore lint/a11y/noStaticElementInteractions: React Flow node container
        <div
            data-element-type={element.type}
            className={nodeClassName}
            onDoubleClick={(event) => {
                event.stopPropagation();
                beginEditing(element.id);
            }}
        >
            {remoteSelectionLabel ? (
                <span className="canvas-remote-label pointer-events-none absolute -top-3 right-2 z-10 rounded-full px-2 py-0.5 font-medium text-[10px] shadow-sm">
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
