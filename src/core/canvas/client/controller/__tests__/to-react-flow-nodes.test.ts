import { describe, expect, it } from "vitest";
import { toReactFlowNodes } from "@/core/canvas/client/controller/to-react-flow-nodes";
import type { WorkspaceElement } from "@/core/canvas/domain/types";

const projectId = "550e8400-e29b-41d4-a716-446655440000";
const stickyElement: WorkspaceElement = {
    id: "550e8400-e29b-41d4-a716-446655440001",
    projectId,
    type: "STICKY",
    content: "Sticky",
    x: 10,
    y: 20,
    width: 240,
    height: 180,
    createdBy: "user-1",
    createdAt: "2026-08-09T12:00:00.000Z",
    updatedAt: "2026-08-09T12:00:00.000Z",
    lastOperationAt: "2026-08-09T12:00:00.000Z",
    lastOperationId: "550e8400-e29b-41d4-a716-446655440002",
};
const cardElement: WorkspaceElement = {
    ...stickyElement,
    id: "550e8400-e29b-41d4-a716-446655440003",
    type: "CARD",
    content: "Card",
};

describe("toReactFlowNodes", () => {
    it("derives one React Flow node per active element", () => {
        const nodes = toReactFlowNodes(
            [stickyElement, cardElement],
            new Map(),
            [stickyElement.id],
        );

        expect(nodes).toHaveLength(2);
        expect(nodes[0]).toMatchObject({
            id: stickyElement.id,
            type: "workspaceElement",
            position: { x: stickyElement.x, y: stickyElement.y },
            style: { width: stickyElement.width, height: stickyElement.height },
            measured: {
                width: stickyElement.width,
                height: stickyElement.height,
            },
            selected: true,
            data: { element: stickyElement },
        });
        expect(nodes[1].selected).toBe(false);
    });

    it("overlays local move and resize previews without mutating the element", () => {
        const previews = new Map([
            [stickyElement.id, { x: 80, y: 90, width: 300, height: 220 }],
        ]);
        const nodes = toReactFlowNodes([stickyElement], previews);

        expect(nodes[0].position).toEqual({ x: 80, y: 90 });
        expect(nodes[0].style).toMatchObject({ width: 300, height: 220 });
        expect(nodes[0].measured).toEqual({ width: 300, height: 220 });
        expect(stickyElement.x).not.toBe(80);
    });

    it("derives remote selections without changing local selected state", () => {
        const nodes = toReactFlowNodes(
            [stickyElement],
            new Map(),
            [],
            [
                {
                    id: "remote-user",
                    label: "Ada",
                    selectedElementIds: [stickyElement.id],
                },
            ],
        );

        expect(nodes[0].selected).toBe(false);
        expect(nodes[0].data.remoteSelectedBy).toEqual([
            { id: "remote-user", label: "Ada" },
        ]);
    });
});
