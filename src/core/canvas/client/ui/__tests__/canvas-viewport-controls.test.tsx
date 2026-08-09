// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasViewportControls } from "@/core/canvas/client/ui/canvas-viewport-controls";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const flowMock = vi.hoisted(() => ({
    zoomTo: vi.fn(),
    setViewport: vi.fn(),
}));

vi.mock("@xyflow/react", () => ({
    useReactFlow: () => flowMock,
}));

function render(element: ReactElement) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => root.render(element));

    return {
        container,
        rerender(nextElement: ReactElement) {
            act(() => root.render(nextElement));
        },
        unmount() {
            act(() => root.unmount());
            container.remove();
        },
    };
}

afterEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
});

describe("CanvasViewportControls", () => {
    it("shows the current percentage and accessible actions", () => {
        const view = render(
            createElement(CanvasViewportControls, {
                viewport: { x: 0, y: 0, zoom: 1 },
            }),
        );

        expect(
            view.container
                .querySelector("fieldset")
                ?.getAttribute("aria-label"),
        ).toBe("Canvas zoom controls");
        expect(view.container.textContent).toContain("100%");
        expect(
            view.container.querySelector('[aria-label="Zoom out"]'),
        ).not.toBeNull();
        expect(
            view.container.querySelector('[aria-label="Zoom in"]'),
        ).not.toBeNull();
        expect(
            view.container.querySelector('[aria-label="Reset viewport"]'),
        ).not.toBeNull();

        view.rerender(
            createElement(CanvasViewportControls, {
                viewport: { x: 18, y: -4, zoom: 1.25 },
            }),
        );
        expect(view.container.textContent).toContain("125%");
        view.unmount();
    });

    it("uses bounded zoom operations and reset animation", () => {
        const view = render(
            createElement(CanvasViewportControls, {
                viewport: { x: 0, y: 0, zoom: 1 },
            }),
        );

        act(() => {
            view.container
                .querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')
                ?.click();
            view.container
                .querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')
                ?.click();
            view.container
                .querySelector<HTMLButtonElement>(
                    '[aria-label="Reset viewport"]',
                )
                ?.click();
        });

        expect(flowMock.zoomTo).toHaveBeenNthCalledWith(1, 1.2, {
            duration: 200,
        });
        expect(flowMock.zoomTo).toHaveBeenNthCalledWith(2, 1 / 1.2, {
            duration: 200,
        });
        expect(flowMock.setViewport).toHaveBeenCalledWith(
            { x: 0, y: 0, zoom: 1 },
            { duration: 200 },
        );
        view.unmount();
    });

    it("disables the operation that would exceed either zoom limit", () => {
        const view = render(
            createElement(CanvasViewportControls, {
                viewport: { x: 0, y: 0, zoom: 0.25 },
            }),
        );
        expect(
            view.container.querySelector<HTMLButtonElement>(
                '[aria-label="Zoom out"]',
            )?.disabled,
        ).toBe(true);
        expect(
            view.container.querySelector<HTMLButtonElement>(
                '[aria-label="Zoom in"]',
            )?.disabled,
        ).toBe(false);

        view.rerender(
            createElement(CanvasViewportControls, {
                viewport: { x: 0, y: 0, zoom: 2 },
            }),
        );
        expect(
            view.container.querySelector<HTMLButtonElement>(
                '[aria-label="Zoom in"]',
            )?.disabled,
        ).toBe(true);
        expect(
            view.container.querySelector<HTMLButtonElement>(
                '[aria-label="Zoom out"]',
            )?.disabled,
        ).toBe(false);
        view.unmount();
    });
});
