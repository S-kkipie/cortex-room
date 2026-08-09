// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasToolbar } from "@/core/canvas/client/ui/canvas-toolbar";

const elementId = "550e8400-e29b-41d4-a716-446655440001";

const contextMock = vi.hoisted(() => ({
    activeTool: "select" as string,
    setActiveTool: vi.fn(),
    isLoading: false,
    error: null as Error | null,
    selectedElementIds: ["550e8400-e29b-41d4-a716-446655440001"],
    actions: {
        deleteElement: vi.fn(),
    },
}));

vi.mock("@/core/canvas/client/controller/canvas-controller-context", () => ({
    useCanvasController: () => contextMock,
}));

function render(element: ReactElement) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(element));
    return {
        container,
        unmount: () => act(() => root.unmount()),
    };
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
    contextMock.activeTool = "select";
    contextMock.isLoading = false;
    contextMock.error = null;
    contextMock.selectedElementIds = [elementId];
    vi.clearAllMocks();
    document.body.replaceChildren();
});

describe("CanvasToolbar", () => {
    it("renders all tools with an accessible active state", () => {
        const view = render(createElement(CanvasToolbar));

        expect(
            view.container.querySelector('[aria-label="Canvas tools"]'),
        ).not.toBeNull();
        expect(
            view.container
                .querySelector('[aria-label="Canvas tools"]')
                ?.classList.contains("canvas-toolbar"),
        ).toBe(true);
        expect(
            view.container.querySelector('[aria-label="Select"]'),
        ).not.toBeNull();
        expect(
            view.container.querySelector('[aria-label="Hand"]'),
        ).not.toBeNull();
        expect(
            view.container.querySelector('[aria-label="Create sticky"]'),
        ).not.toBeNull();
        expect(
            view.container.querySelector('[aria-label="Create text"]'),
        ).not.toBeNull();
        expect(
            view.container.querySelector('[aria-label="Create card"]'),
        ).not.toBeNull();
        expect(
            view.container.querySelector('[aria-label="Create heading"]'),
        ).not.toBeNull();
        expect(
            view.container.querySelector(
                '[aria-label="Delete selected element"]',
            ),
        ).not.toBeNull();
        expect(
            view.container
                .querySelector('[aria-pressed="true"]')
                ?.getAttribute("aria-label"),
        ).toBe("Select");
        view.unmount();
    });

    it("selects tools and deletes through CanvasActions", () => {
        const view = render(createElement(CanvasToolbar));

        act(() => {
            view.container
                .querySelector<HTMLButtonElement>('[aria-label="Hand"]')
                ?.click();
            view.container
                .querySelector<HTMLButtonElement>(
                    '[aria-label="Delete selected element"]',
                )
                ?.click();
        });

        expect(contextMock.setActiveTool).toHaveBeenNthCalledWith(1, "hand");
        expect(contextMock.actions.deleteElement).toHaveBeenCalledWith(
            elementId,
        );
        expect(contextMock.setActiveTool).toHaveBeenLastCalledWith("select");
        view.unmount();
    });

    it("disables tools while the canvas is loading or failed", () => {
        contextMock.isLoading = true;
        const view = render(createElement(CanvasToolbar));

        expect(
            view.container.querySelector<HTMLButtonElement>(
                '[aria-label="Select"]',
            )?.disabled,
        ).toBe(true);
        view.unmount();
    });
});
