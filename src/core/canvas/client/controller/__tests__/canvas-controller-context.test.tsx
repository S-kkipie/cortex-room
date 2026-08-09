// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    CanvasControllerProvider,
    useCanvasController,
} from "@/core/canvas/client/controller/canvas-controller-context";
import type { CanvasMutationResult } from "@/core/canvas/domain/types";

const elementId = "550e8400-e29b-41d4-a716-446655440001";
const element = {
    id: elementId,
    projectId: "550e8400-e29b-41d4-a716-446655440000",
    type: "STICKY" as const,
    content: "Original",
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

const controllerMock = vi.hoisted(() => ({
    updateElement: vi.fn(),
    createElement: vi.fn(),
    moveElement: vi.fn(),
    resizeElement: vi.fn(),
    deleteElement: vi.fn(),
    applyRemoteMessage: vi.fn(),
    publishMovePreview: vi.fn(),
    publishResizePreview: vi.fn(),
    publishTextPreview: vi.fn(),
    cancelPreviews: vi.fn(),
    cancelAllPreviews: vi.fn(),
    selectElements: vi.fn(),
    getElement: vi.fn(),
    getElements: vi.fn(),
    getSelectedElements: vi.fn(),
    refetch: vi.fn(),
}));

const selectionPortMock = vi.hoisted(() => ({
    current: null as { write(elementIds: string[]): void } | null,
}));

let probeRenderCount = 0;

vi.mock("@/core/canvas/client/hooks", () => ({
    useCanvas: () => ({
        useController: ({
            selection,
        }: {
            selection: { write(elementIds: string[]): void };
        }) => {
            selectionPortMock.current = selection;
            return {
                snapshotQuery: {
                    data: {
                        response: {
                            projectId: element.projectId,
                            elements: [element],
                            tombstones: [],
                        },
                    },
                    isPending: false,
                    isError: false,
                    error: null,
                    refetch: controllerMock.refetch,
                },
                actions: {
                    createElement: controllerMock.createElement,
                    updateElement:
                        controllerMock.updateElement.mockResolvedValue({
                            applied: true,
                            record: element,
                        } satisfies CanvasMutationResult),
                    moveElement: controllerMock.moveElement,
                    resizeElement: controllerMock.resizeElement,
                    deleteElement: controllerMock.deleteElement,
                    applyRemoteMessage: controllerMock.applyRemoteMessage,
                    publishMovePreview: controllerMock.publishMovePreview,
                    publishResizePreview: controllerMock.publishResizePreview,
                    publishTextPreview: controllerMock.publishTextPreview,
                    cancelPreviews: controllerMock.cancelPreviews,
                    cancelAllPreviews: controllerMock.cancelAllPreviews,
                    selectElements: controllerMock.selectElements,
                    getElement: controllerMock.getElement,
                    getElements: controllerMock.getElements,
                    getSelectedElements: controllerMock.getSelectedElements,
                },
            };
        },
    }),
}));

vi.mock("@/core/canvas/client/portal/canvas-portal-provider", () => ({
    useCanvasPortal: () => ({
        configured: false,
        status: "unavailable",
        historyReady: true,
        messages: [],
    }),
}));

function Probe() {
    probeRenderCount += 1;
    const controller = useCanvasController();

    return createElement(
        "div",
        null,
        createElement(
            "button",
            {
                type: "button",
                onClick: () => controller.beginEditing(elementId),
            },
            "begin",
        ),
        createElement(
            "button",
            {
                type: "button",
                onClick: () => controller.setTextDraft(elementId, "Updated"),
            },
            "draft",
        ),
        createElement(
            "button",
            {
                type: "button",
                onClick: () => void controller.confirmEditing(elementId),
            },
            "confirm",
        ),
        createElement(
            "button",
            {
                type: "button",
                onClick: () =>
                    controller.setMovePreview(elementId, { x: 80, y: 90 }),
            },
            "preview",
        ),
        createElement(
            "output",
            { "data-testid": "state" },
            `${controller.editingElementId ?? "none"}:${controller.getPreview(elementId)?.x ?? "none"}`,
        ),
    );
}

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
    vi.clearAllMocks();
    probeRenderCount = 0;
    selectionPortMock.current = null;
    document.body.replaceChildren();
});

describe("CanvasControllerProvider", () => {
    it("keeps previews ephemeral and confirms a changed text draft", async () => {
        controllerMock.getElement.mockReturnValue(element);
        const view = render(
            createElement(
                CanvasControllerProvider,
                { projectId: element.projectId, userId: "user-1" },
                createElement(Probe),
            ),
        );

        act(() => {
            view.container.querySelector<HTMLButtonElement>("button")?.click();
            view.container
                .querySelectorAll<HTMLButtonElement>("button")[1]
                ?.click();
            view.container
                .querySelectorAll<HTMLButtonElement>("button")[3]
                ?.click();
        });

        expect(
            view.container.querySelector("[data-testid=state]")?.textContent,
        ).toBe(`${elementId}:80`);

        await act(async () => {
            view.container
                .querySelectorAll<HTMLButtonElement>("button")[2]
                ?.click();
        });

        expect(controllerMock.updateElement).toHaveBeenCalledWith(elementId, {
            content: "Updated",
        });
        expect(controllerMock.publishTextPreview).toHaveBeenCalledWith(
            elementId,
            "Updated",
        );
        expect(
            view.container.querySelector("[data-testid=state]")?.textContent,
        ).toBe("none:80");
        view.unmount();
    });

    it("exposes retry through the snapshot query", () => {
        const view = render(
            createElement(
                CanvasControllerProvider,
                { projectId: element.projectId, userId: "user-1" },
                createElement(Probe),
            ),
        );

        expect(
            view.container.querySelector("[data-testid=state]"),
        ).not.toBeNull();
        view.unmount();
    });

    it("does not rerender when the same selection is written twice", () => {
        const view = render(
            createElement(
                CanvasControllerProvider,
                { projectId: element.projectId, userId: "user-1" },
                createElement(Probe),
            ),
        );

        act(() => selectionPortMock.current?.write([elementId]));
        const renderCountAfterFirstWrite = probeRenderCount;

        act(() => selectionPortMock.current?.write([elementId]));

        expect(probeRenderCount).toBe(renderCountAfterFirstWrite);
        view.unmount();
    });

    it("does not persist the same text draft twice while a commit is pending", async () => {
        let resolveUpdate: ((result: CanvasMutationResult) => void) | undefined;
        const view = render(
            createElement(
                CanvasControllerProvider,
                { projectId: element.projectId, userId: "user-1" },
                createElement(Probe),
            ),
        );
        controllerMock.updateElement.mockImplementationOnce(
            () =>
                new Promise<CanvasMutationResult>((resolve) => {
                    resolveUpdate = resolve;
                }),
        );

        act(() => {
            view.container.querySelector<HTMLButtonElement>("button")?.click();
            view.container
                .querySelectorAll<HTMLButtonElement>("button")[1]
                ?.click();
        });
        act(() => {
            view.container
                .querySelectorAll<HTMLButtonElement>("button")[2]
                ?.click();
            view.container
                .querySelectorAll<HTMLButtonElement>("button")[2]
                ?.click();
        });

        expect(controllerMock.updateElement).toHaveBeenCalledOnce();
        resolveUpdate?.({ applied: true, record: element });
        await act(async () => undefined);
        view.unmount();
    });
});
