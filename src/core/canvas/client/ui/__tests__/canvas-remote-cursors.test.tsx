// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasRemoteCursors } from "@/core/canvas/client/ui/canvas-remote-cursors";

const viewportPortal = vi.hoisted(() => ({
    children: null as ReactElement | null,
}));

vi.mock("@xyflow/react", () => ({
    ViewportPortal: ({ children }: { children: ReactElement }) => {
        viewportPortal.children = children;
        return createElement(
            "div",
            { "data-testid": "viewport-portal" },
            children,
        );
    },
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
    viewportPortal.children = null;
    document.body.replaceChildren();
});

describe("CanvasRemoteCursors", () => {
    it("renders each remote cursor in the XYFlow viewport coordinate system", () => {
        const view = render(
            createElement(CanvasRemoteCursors, {
                participants: [
                    {
                        id: "remote-user",
                        label: "Ada",
                        cursor: { x: 80, y: 90 },
                        selectedElementIds: [],
                    },
                ],
            }),
        );

        const cursor = view.container.querySelector(
            '[data-participant-id="remote-user"]',
        ) as HTMLElement | null;
        expect(cursor?.getAttribute("aria-label")).toBe("Ada cursor");
        expect(cursor?.style.transform).toBe("translate(80px, 90px)");
        expect(cursor?.textContent).toContain("Ada");
        view.unmount();
    });

    it("does not mount a portal when no participant has a cursor", () => {
        const view = render(
            createElement(CanvasRemoteCursors, {
                participants: [
                    { id: "remote-user", label: "Ada", selectedElementIds: [] },
                ],
            }),
        );

        expect(
            view.container.querySelector("[data-testid=viewport-portal]"),
        ).toBeNull();
        expect(viewportPortal.children).toBeNull();
        view.unmount();
    });
});
