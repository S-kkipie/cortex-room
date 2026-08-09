// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasShell } from "@/core/canvas/client/ui/canvas-shell";

vi.mock("next/link", () => ({
    default: ({ children, href }: { children?: ReactNode; href: string }) =>
        createElement("a", { href }, children),
}));

vi.mock("@/core/canvas/client/ui/navigable-canvas", () => ({
    NavigableCanvas: () =>
        createElement("div", { "data-testid": "navigable-canvas" }),
}));

vi.mock("@/frontend/components/auth/sign-out-button", () => ({
    SignOutButton: () => createElement("button", { type: "button" }),
}));

vi.mock("@/frontend/components/ui/button", () => ({
    Button: ({ children }: { children?: ReactNode }) =>
        createElement("button", { type: "button" }, children),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
});

describe("CanvasShell", () => {
    it("gives the canvas a definite viewport height", () => {
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);

        act(() => {
            root.render(
                createElement(CanvasShell, {
                    projectName: "Demo project",
                    userLabel: "user@example.com",
                }),
            );
        });

        const shell = container.firstElementChild;
        expect(shell?.classList.contains("h-svh")).toBe(true);
        expect(shell?.classList.contains("min-h-svh")).toBe(false);

        act(() => root.unmount());
    });
});
