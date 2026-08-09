import type { Node } from "@xyflow/react";
import type { WorkspaceElement } from "@/core/canvas/domain/types";
import type { CanvasPreview } from "./canvas-preview";

export type WorkspaceElementNodeData = {
    element: WorkspaceElement;
    preview?: CanvasPreview;
};

export type WorkspaceElementNode = Node<
    WorkspaceElementNodeData,
    "workspaceElement"
>;

export function toReactFlowNodes(
    elements: WorkspaceElement[],
    previews: ReadonlyMap<string, CanvasPreview>,
    selectedElementIds: readonly string[] = [],
): WorkspaceElementNode[] {
    return elements.map((element) => {
        const preview = previews.get(element.id);
        const width = preview?.width ?? element.width;
        const height = preview?.height ?? element.height;

        return {
            id: element.id,
            type: "workspaceElement",
            selected: selectedElementIds.includes(element.id),
            position: {
                x: preview?.x ?? element.x,
                y: preview?.y ?? element.y,
            },
            style: {
                width,
                height,
            },
            measured: { width, height },
            data: { element, preview },
        };
    });
}
