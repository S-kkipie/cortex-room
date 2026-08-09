// @vitest-environment happy-dom

import type { NodeProps } from "@xyflow/react";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceElementNode } from "@/core/canvas/client/controller/to-react-flow-nodes";
import { WorkspaceElementNode as WorkspaceElementNodeComponent } from "@/core/canvas/client/ui/workspace-element-node";
import type { WorkspaceElement } from "@/core/canvas/domain/types";

const element: WorkspaceElement = {
    id: "550e8400-e29b-41d4-a716-446655440001",
    projectId: "550e8400-e29b-41d4-a716-446655440000",
    type: "CARD",
    content: "Title\nDescription",
    x: 10,
    y: 20,
    width: 320,
    height: 200,
    createdBy: "user-1",
    createdAt: "2026-08-09T12:00:00.000Z",
    updatedAt: "2026-08-09T12:00:00.000Z",
    lastOperationAt: "2026-08-09T12:00:00.000Z",
    lastOperationId: "550e8400-e29b-41d4-a716-446655440002",
};

const contextMock = vi.hoisted(() => ({
    editingElementId: null as string | null,
    textDrafts: {} as Record<string, string>,
    beginEditing: vi.fn(),
    setTextDraft: vi.fn(),
    confirmEditing: vi.fn(),
    cancelEditing: vi.fn(),
    setResizePreview: vi.fn(),
    clearPreview: vi.fn(),
    actions: {
        resizeElement: vi.fn(),
    },
}));

vi.mock("@xyflow/react", () => ({
    NodeResizer: (props: {
        isVisible?: boolean;
        minWidth?: number;
        minHeight?: number;
    }) =>
        createElement("div", {
            "data-testid": "node-resizer",
            "data-visible": props.isVisible,
            "data-min-width": props.minWidth,
            "data-min-height": props.minHeight,
        }),
}));

vi.mock("@/core/canvas/client/controller/canvas-controller-context", () => ({
    useCanvasController: () => contextMock,
}));

function render(elementToRender: ReactElement) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(elementToRender));
    return {
        container,
        unmount: () => act(() => root.unmount()),
    };
}

function nodeProps(
    selected: boolean,
    preview?: { content?: string },
): NodeProps<WorkspaceElementNode> {
    return {
        id: element.id,
        data: { element, preview },
        selected,
        dragging: false,
        type: "workspaceElement",
        zIndex: 0,
        xPos: element.x,
        yPos: element.y,
        targetPosition: undefined,
        sourcePosition: undefined,
        positionAbsoluteX: element.x,
        positionAbsoluteY: element.y,
        width: element.width,
        height: element.height,
        selectable: true,
        deletable: true,
        draggable: true,
        isConnectable: false,
    } as NodeProps<WorkspaceElementNode>;
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
    contextMock.editingElementId = null;
    contextMock.textDrafts = {};
    vi.clearAllMocks();
    document.body.replaceChildren();
});

describe("WorkspaceElementNode", () => {
    it("renders Card content and its selected minimum resizer", () => {
        const view = render(
            createElement(WorkspaceElementNodeComponent, nodeProps(true)),
        );

        expect(
            view.container.querySelector('[data-element-type="CARD"]'),
        ).not.toBeNull();
        expect(view.container.textContent).toContain("Title");
        expect(view.container.textContent).toContain("Description");
        expect(
            view.container
                .querySelector('[data-testid="node-resizer"]')
                ?.getAttribute("data-visible"),
        ).toBe("true");
        expect(
            view.container
                .querySelector('[data-testid="node-resizer"]')
                ?.getAttribute("data-min-width"),
        ).toBe("220");
        view.unmount();
    });

    it("renders no resizer for an unselected node", () => {
        const view = render(
            createElement(WorkspaceElementNodeComponent, nodeProps(false)),
        );

        expect(
            view.container.querySelector('[data-testid="node-resizer"]'),
        ).toBeNull();
        view.unmount();
    });

    it("renders remote text previews without changing the persisted element", () => {
        const view = render(
            createElement(
                WorkspaceElementNodeComponent,
                nodeProps(true, { content: "Remote title\nRemote detail" }),
            ),
        );

        expect(view.container.textContent).toContain("Remote title");
        expect(view.container.textContent).toContain("Remote detail");
        expect(view.container.textContent).not.toContain("Title");
        view.unmount();
    });
});
