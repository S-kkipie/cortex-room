// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasConnectionStatus } from "@/core/canvas/client/ui/canvas-connection-status";

const contextMock = vi.hoisted(() => ({
    portalStatus: "ready" as
        | "idle"
        | "connecting"
        | "ready"
        | "reconnecting"
        | "degraded"
        | "degraded-http"
        | "blocked"
        | "unavailable",
    onlineParticipantCount: 0,
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
    contextMock.portalStatus = "ready";
    contextMock.onlineParticipantCount = 0;
    document.body.replaceChildren();
});

describe("CanvasConnectionStatus", () => {
    it.each([
        ["ready", "Live"],
        ["reconnecting", "Reconnecting"],
        ["degraded-http", "Degraded"],
        ["unavailable", "Unavailable"],
    ] as const)("renders the %s status accessibly", (status, label) => {
        contextMock.portalStatus = status;
        const view = render(createElement(CanvasConnectionStatus));
        const statusElement = view.container.querySelector(
            '[data-testid="canvas-connection-status"]',
        );

        expect(statusElement?.getAttribute("role")).toBe("status");
        expect(statusElement?.getAttribute("aria-live")).toBe("polite");
        expect(statusElement?.getAttribute("data-status")).toBe(status);
        expect(statusElement?.textContent).toContain(label);
        view.unmount();
    });

    it("shows the remote collaborator count with the connection status", () => {
        contextMock.onlineParticipantCount = 2;
        const view = render(createElement(CanvasConnectionStatus));

        expect(
            view.container.querySelector(
                '[data-testid="canvas-connection-status"]',
            )?.textContent,
        ).toContain("· 2");
        view.unmount();
    });
});
