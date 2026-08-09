// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceElementEditor } from "@/core/canvas/client/ui/workspace-element-editor";
import type { WorkspaceElement } from "@/core/canvas/domain/types";

const element: WorkspaceElement = {
    id: "550e8400-e29b-41d4-a716-446655440001",
    projectId: "550e8400-e29b-41d4-a716-446655440000",
    type: "TEXT",
    content: "Original",
    x: 10,
    y: 20,
    width: 280,
    height: 120,
    createdBy: "user-1",
    createdAt: "2026-08-09T12:00:00.000Z",
    updatedAt: "2026-08-09T12:00:00.000Z",
    lastOperationAt: "2026-08-09T12:00:00.000Z",
    lastOperationId: "550e8400-e29b-41d4-a716-446655440002",
};

const contextMock = vi.hoisted(() => ({
    textDrafts: {} as Record<string, string>,
    setTextDraft: vi.fn(),
    confirmEditing: vi.fn(),
    cancelEditing: vi.fn(),
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

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
    contextMock.textDrafts = {};
    vi.clearAllMocks();
    document.body.replaceChildren();
});

describe("WorkspaceElementEditor", () => {
    it("confirms with Ctrl+Enter and cancels with Escape", () => {
        contextMock.textDrafts[element.id] = "Draft";
        const view = render(createElement(WorkspaceElementEditor, { element }));
        const textarea = view.container.querySelector("textarea");

        expect(textarea?.value).toBe("Draft");

        act(() => {
            textarea?.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    ctrlKey: true,
                    key: "Enter",
                }),
            );
        });
        expect(contextMock.confirmEditing).toHaveBeenCalledWith(element.id);

        act(() => {
            textarea?.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    key: "Escape",
                }),
            );
        });
        expect(contextMock.cancelEditing).toHaveBeenCalledWith(element.id);
        view.unmount();
    });

    it("does not confirm twice when Ctrl+Enter is followed by blur", async () => {
        contextMock.textDrafts[element.id] = "Draft";
        contextMock.confirmEditing.mockResolvedValue(undefined);
        const view = render(createElement(WorkspaceElementEditor, { element }));
        const textarea = view.container.querySelector("textarea");

        await act(async () => {
            textarea?.focus();
            textarea?.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    ctrlKey: true,
                    key: "Enter",
                }),
            );
            textarea?.blur();
        });

        expect(contextMock.confirmEditing).toHaveBeenCalledTimes(1);
        view.unmount();
    });
});
