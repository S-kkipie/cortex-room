// @vitest-environment happy-dom

import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasControllerValue } from "@/core/canvas/client/controller/canvas-controller-context";
import { CanvasEditor } from "@/core/canvas/client/ui/canvas-editor";
import type { WorkspaceElement } from "@/core/canvas/domain/types";

const element: WorkspaceElement = {
    id: "550e8400-e29b-41d4-a716-446655440001",
    projectId: "550e8400-e29b-41d4-a716-446655440000",
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

const createdElement: WorkspaceElement = {
    ...element,
    id: "550e8400-e29b-41d4-a716-446655440003",
    x: 80,
    y: 110,
};

const flowMock = vi.hoisted(() => ({
    fitView: vi.fn(),
    setNodes: vi.fn(),
    screenToFlowPosition: vi.fn(() => ({ x: 200, y: 300 })),
    zoomTo: vi.fn(),
    setViewport: vi.fn(),
    reactFlowProps: null as Record<string, unknown> | null,
}));

const contextMock = vi.hoisted(() => ({
    projectId: "550e8400-e29b-41d4-a716-446655440000",
    portalConfigured: false,
    portalStatus: "unavailable" as const,
    snapshot: null as CanvasControllerValue["snapshot"] | null,
    isLoading: false,
    error: null as Error | null,
    retry: vi.fn(),
    actions: {
        createElement: vi.fn(),
        updateElement: vi.fn(),
        moveElement: vi.fn(),
        resizeElement: vi.fn(),
        deleteElement: vi.fn(),
        selectElements: vi.fn(),
        getElement: vi.fn(),
        getElements: vi.fn(),
        getSelectedElements: vi.fn(),
    },
    activeTool: "select" as CanvasControllerValue["activeTool"],
    setActiveTool: vi.fn(),
    selectedElementIds: [] as string[],
    editingElementId: null as string | null,
    textDrafts: {} as Record<string, string>,
    previews: new Map(),
    setMovePreview: vi.fn(),
    setResizePreview: vi.fn(),
    clearPreview: vi.fn(),
    getPreview: vi.fn(),
    beginEditing: vi.fn(),
    setTextDraft: vi.fn(),
    confirmEditing: vi.fn(),
    cancelEditing: vi.fn(),
    fitViewHasRun: false,
    markFitViewComplete: vi.fn(),
}));

vi.mock("@xyflow/react", () => ({
    BackgroundVariant: { Dots: "dots" },
    Background: () => createElement("div", { "data-testid": "background" }),
    ReactFlowProvider: ({ children }: { children: ReactNode }) =>
        createElement("div", { "data-testid": "provider" }, children),
    ReactFlow: (props: Record<string, unknown>) => {
        flowMock.reactFlowProps = props;
        return createElement("div", { "data-testid": "react-flow" });
    },
    NodeResizer: () => null,
    useReactFlow: () => flowMock,
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
        rerender(nextElement: ReactElement) {
            act(() => root.render(nextElement));
        },
        unmount: () => act(() => root.unmount()),
    };
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
    contextMock.snapshot = null;
    contextMock.isLoading = false;
    contextMock.error = null;
    contextMock.activeTool = "select";
    contextMock.fitViewHasRun = false;
    contextMock.selectedElementIds = [];
    flowMock.reactFlowProps = null;
    vi.clearAllMocks();
    document.body.replaceChildren();
});

describe("CanvasEditor", () => {
    it("renders loaded elements and fits the initial viewport once", () => {
        contextMock.snapshot = {
            projectId: element.projectId,
            elements: [element],
            tombstones: [],
        };

        const view = render(createElement(CanvasEditor));

        expect(flowMock.reactFlowProps?.nodes).toBeUndefined();
        expect(flowMock.reactFlowProps?.defaultNodes).toEqual([]);
        expect(flowMock.setNodes).toHaveBeenLastCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ id: element.id }),
            ]),
        );
        expect(flowMock.reactFlowProps?.nodeTypes).toBeDefined();
        expect(flowMock.fitView).toHaveBeenCalledWith({
            duration: 200,
            maxZoom: 1,
            padding: 0.2,
        });
        expect(contextMock.markFitViewComplete).toHaveBeenCalledOnce();
        view.unmount();
    });

    it("marks an empty initial snapshot complete without fitting", () => {
        contextMock.snapshot = {
            projectId: element.projectId,
            elements: [],
            tombstones: [],
        };

        const view = render(createElement(CanvasEditor));

        expect(flowMock.fitView).not.toHaveBeenCalled();
        expect(contextMock.markFitViewComplete).toHaveBeenCalledOnce();
        view.unmount();
    });

    it("uses explicit node and pane callbacks to update selection", () => {
        contextMock.activeTool = "select";
        const view = render(createElement(CanvasEditor));
        const onNodeClick = flowMock.reactFlowProps?.onNodeClick as (
            event: unknown,
            node: { id: string },
        ) => void;
        const onPaneClick = flowMock.reactFlowProps?.onPaneClick as (event: {
            clientX: number;
            clientY: number;
        }) => void;

        act(() => onNodeClick({}, { id: element.id }));
        expect(contextMock.actions.selectElements).toHaveBeenLastCalledWith([
            element.id,
        ]);

        act(() => onPaneClick({ clientX: 0, clientY: 0 }));
        expect(contextMock.actions.selectElements).toHaveBeenLastCalledWith([]);
        expect(flowMock.reactFlowProps?.onSelectionChange).toBeUndefined();
        view.unmount();
    });

    it("keeps derived nodes stable when canvas inputs do not change", () => {
        contextMock.snapshot = {
            projectId: element.projectId,
            elements: [element],
            tombstones: [],
        };
        const view = render(createElement(CanvasEditor));
        const initialNodes =
            flowMock.setNodes.mock.calls[
                flowMock.setNodes.mock.calls.length - 1
            ]?.[0];

        view.rerender(createElement(CanvasEditor));

        expect(flowMock.setNodes).toHaveBeenCalledOnce();
        expect(
            flowMock.setNodes.mock.calls[
                flowMock.setNodes.mock.calls.length - 1
            ]?.[0],
        ).toBe(initialNodes);
        view.unmount();
    });

    it("keeps React Flow drag handlers stable across rerenders", () => {
        const view = render(createElement(CanvasEditor));
        const initialDrag = flowMock.reactFlowProps?.onNodeDrag;
        const initialDragStop = flowMock.reactFlowProps?.onNodeDragStop;

        view.rerender(createElement(CanvasEditor));

        expect(flowMock.reactFlowProps?.onNodeDrag).toBe(initialDrag);
        expect(flowMock.reactFlowProps?.onNodeDragStop).toBe(initialDragStop);
        view.unmount();
    });

    it("creates an insertion tool element at the clicked flow coordinate", async () => {
        contextMock.activeTool = "STICKY";
        contextMock.actions.createElement.mockResolvedValue({
            applied: true,
            record: createdElement,
        });
        const view = render(createElement(CanvasEditor));
        const onPaneClick = flowMock.reactFlowProps?.onPaneClick as (event: {
            clientX: number;
            clientY: number;
        }) => void;

        await act(async () => {
            onPaneClick({ clientX: 200, clientY: 300 });
        });

        expect(contextMock.actions.createElement).toHaveBeenCalledWith({
            type: "STICKY",
            content: "",
            x: 80,
            y: 210,
            width: 240,
            height: 180,
        });
        expect(contextMock.setActiveTool).toHaveBeenCalledWith("select");
        expect(contextMock.beginEditing).toHaveBeenCalledWith(
            createdElement.id,
        );
        view.unmount();
    });

    it("uses Hand to disable node selection and dragging", () => {
        contextMock.activeTool = "hand";
        const view = render(createElement(CanvasEditor));

        expect(flowMock.reactFlowProps?.nodesDraggable).toBe(false);
        expect(flowMock.reactFlowProps?.elementsSelectable).toBe(false);
        view.unmount();
    });

    it("keeps drag previews local until drag stop", async () => {
        contextMock.snapshot = {
            projectId: element.projectId,
            elements: [element],
            tombstones: [],
        };
        const view = render(createElement(CanvasEditor));
        const onNodeDrag = flowMock.reactFlowProps?.onNodeDrag as (
            event: unknown,
            node: { id: string; position: { x: number; y: number } },
        ) => void;
        const onNodeDragStop = flowMock.reactFlowProps?.onNodeDragStop as (
            event: unknown,
            node: { id: string; position: { x: number; y: number } },
        ) => Promise<void>;
        const node = { id: element.id, position: { x: 100, y: 120 } };

        act(() => onNodeDrag({}, node));
        expect(contextMock.setMovePreview).toHaveBeenCalledWith(
            element.id,
            node.position,
        );
        expect(contextMock.actions.moveElement).not.toHaveBeenCalled();

        await act(async () => {
            await onNodeDragStop({}, node);
        });
        expect(contextMock.clearPreview).toHaveBeenCalledWith(element.id);
        expect(contextMock.actions.moveElement).toHaveBeenCalledWith(
            element.id,
            node.position,
        );
        view.unmount();
    });

    it("handles a synchronous move failure without rejecting the drag event", async () => {
        contextMock.snapshot = {
            projectId: element.projectId,
            elements: [element],
            tombstones: [],
        };
        contextMock.actions.moveElement.mockImplementationOnce(() => {
            throw new Error("invalid canvas record");
        });
        const view = render(createElement(CanvasEditor));
        const onNodeDragStop = flowMock.reactFlowProps?.onNodeDragStop as (
            event: unknown,
            node: { id: string; position: { x: number; y: number } },
        ) => Promise<void>;

        await expect(
            onNodeDragStop(
                {},
                { id: element.id, position: { x: 100, y: 120 } },
            ),
        ).resolves.toBeUndefined();
        view.unmount();
    });

    it("shows loading and error states without enabling editing", () => {
        contextMock.isLoading = true;
        const loadingView = render(createElement(CanvasEditor));
        expect(loadingView.container.textContent).toContain("Loading canvas");
        loadingView.unmount();

        contextMock.isLoading = false;
        contextMock.error = new Error("broken");
        const errorView = render(createElement(CanvasEditor));
        expect(errorView.container.textContent).toContain(
            "Unable to load canvas",
        );
        errorView.container.querySelector<HTMLButtonElement>("button")?.click();
        expect(contextMock.retry).toHaveBeenCalledOnce();
        errorView.unmount();
    });
});
