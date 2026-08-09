// @vitest-environment happy-dom

import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavigableCanvas } from "@/core/canvas/client/ui/navigable-canvas";

type MockViewport = { x: number; y: number; zoom: number };

type MockFlowProps = {
    defaultNodes?: unknown[];
    edges: unknown[];
    minZoom: number;
    maxZoom: number;
    viewport: MockViewport;
    onViewportChange: (viewport: MockViewport) => void;
    panOnDrag: boolean;
    zoomOnScroll: boolean;
    zoomOnPinch: boolean;
    children: ReactNode;
};

const flowMock = vi.hoisted(() => ({
    zoomTo: vi.fn(),
    setViewport: vi.fn(),
    setNodes: vi.fn(),
    reactFlowProps: null as MockFlowProps | null,
}));

const contextMock = vi.hoisted(() => ({
    snapshot: null,
    isLoading: false,
    error: null,
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
    activeTool: "select",
    setActiveTool: vi.fn(),
    selectedElementIds: [],
    editingElementId: null,
    textDrafts: {},
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

vi.mock("@/core/canvas/client/controller/canvas-controller-context", () => ({
    CanvasControllerProvider: ({ children }: { children: ReactNode }) =>
        createElement(
            "div",
            { "data-testid": "controller-provider" },
            children,
        ),
    useCanvasController: () => contextMock,
}));

vi.mock("@xyflow/react", () => ({
    BackgroundVariant: { Dots: "dots" },
    Background: (props: {
        variant: string;
        gap: number;
        size: number;
        color?: string;
        style?: { opacity?: number };
    }) =>
        createElement("div", {
            "data-testid": "canvas-background",
            "data-variant": props.variant,
            "data-gap": props.gap,
            "data-size": props.size,
            "data-color": props.color,
            "data-opacity": props.style?.opacity,
        }),
    ReactFlowProvider: ({ children }: { children: ReactNode }) =>
        createElement(
            "div",
            { "data-testid": "react-flow-provider" },
            children,
        ),
    ReactFlow: (props: MockFlowProps) => {
        flowMock.reactFlowProps = props;

        return createElement(
            "div",
            {
                "data-testid": "react-flow",
                "data-node-count": props.defaultNodes?.length ?? 0,
                "data-edge-count": props.edges.length,
                "data-min-zoom": props.minZoom,
                "data-max-zoom": props.maxZoom,
                "data-zoom": props.viewport.zoom,
                "data-pan-on-drag": props.panOnDrag,
                "data-zoom-on-scroll": props.zoomOnScroll,
                "data-zoom-on-pinch": props.zoomOnPinch,
            },
            props.children,
        );
    },
    useReactFlow: () => flowMock,
}));

function render(element: ReactElement) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(element));
    return { container, unmount: () => act(() => root.unmount()) };
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
    flowMock.reactFlowProps = null;
    vi.clearAllMocks();
    document.body.replaceChildren();
});

describe("NavigableCanvas", () => {
    it("mounts an empty bounded flow with a dotted background and native gestures", () => {
        const view = render(
            createElement(NavigableCanvas, {
                projectId: "550e8400-e29b-41d4-a716-446655440000",
                userId: "user-1",
            }),
        );
        const flow = view.container.querySelector('[data-testid="react-flow"]');

        expect(flow?.getAttribute("data-node-count")).toBe("0");
        expect(flow?.getAttribute("data-edge-count")).toBe("0");
        expect(flow?.getAttribute("data-min-zoom")).toBe("0.25");
        expect(flow?.getAttribute("data-max-zoom")).toBe("2");
        expect(flow?.getAttribute("data-zoom")).toBe("1");
        expect(flow?.getAttribute("data-pan-on-drag")).toBe("true");
        expect(flow?.getAttribute("data-zoom-on-scroll")).toBe("true");
        expect(flow?.getAttribute("data-zoom-on-pinch")).toBe("true");
        expect(
            view.container
                .querySelector('[data-testid="canvas-background"]')
                ?.getAttribute("data-variant"),
        ).toBe("dots");
        expect(
            view.container
                .querySelector('[data-testid="canvas-background"]')
                ?.getAttribute("data-color"),
        ).toBe("var(--muted-foreground)");
        expect(
            view.container
                .querySelector('[data-testid="canvas-background"]')
                ?.getAttribute("data-opacity"),
        ).toBe("1");
        expect(view.container.querySelector('[role="group"]')).toBeNull();
        expect(view.container.querySelector("fieldset")).not.toBeNull();
        view.unmount();
    });

    it("updates the local percentage when React Flow reports a viewport change", () => {
        const view = render(
            createElement(NavigableCanvas, {
                projectId: "550e8400-e29b-41d4-a716-446655440000",
                userId: "user-1",
            }),
        );

        act(() => {
            flowMock.reactFlowProps?.onViewportChange({
                x: 42,
                y: -8,
                zoom: 1.25,
            });
        });

        expect(view.container.textContent).toContain("125%");
        expect(flowMock.reactFlowProps?.viewport).toEqual({
            x: 42,
            y: -8,
            zoom: 1.25,
        });
        view.unmount();
    });
});
