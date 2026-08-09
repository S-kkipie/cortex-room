import type { Node } from "@xyflow/react";
import type { CanvasRemoteParticipant } from "@/core/canvas/client/portal/canvas-awareness";
import type { WorkspaceElement } from "@/core/canvas/domain/types";
import type { CanvasPreview } from "./canvas-preview";

export type WorkspaceElementNodeData = {
    element: WorkspaceElement;
    preview?: CanvasPreview;
    remoteSelectedBy?: readonly Pick<CanvasRemoteParticipant, "id" | "label">[];
};

export type WorkspaceElementNode = Node<
    WorkspaceElementNodeData,
    "workspaceElement"
>;

export function toReactFlowNodes(
    elements: WorkspaceElement[],
    previews: ReadonlyMap<string, CanvasPreview>,
    selectedElementIds: readonly string[] = [],
    remoteParticipants: readonly CanvasRemoteParticipant[] = [],
): WorkspaceElementNode[] {
    return elements.map((element) => {
        const preview = previews.get(element.id);
        const width = preview?.width ?? element.width;
        const height = preview?.height ?? element.height;
        const remoteSelectedBy = remoteParticipants
            .filter((participant) =>
                participant.selectedElementIds.includes(element.id),
            )
            .map(({ id, label }) => ({ id, label }));

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
            data: { element, preview, remoteSelectedBy },
        };
    });
}
