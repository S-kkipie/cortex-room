"use client";

import type { PropsWithChildren } from "react";
import {
    createContext,
    useCallback,
    useContext,
    useRef,
    useState,
} from "react";
import { toast } from "sonner";
import { useCanvas } from "@/core/canvas/client/hooks";
import type {
    CanvasMutationResult,
    CanvasSnapshot,
} from "@/core/canvas/domain/types";
import type { CanvasActions, CanvasSelectionPort } from "./canvas-controller";

export type CanvasTool =
    | "select"
    | "hand"
    | "STICKY"
    | "TEXT"
    | "CARD"
    | "HEADING"
    | "delete";

export type CanvasPreview = {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
};

export type CanvasControllerValue = {
    projectId: string;
    snapshot: CanvasSnapshot | undefined;
    isLoading: boolean;
    error: Error | null;
    retry(): void;
    actions: CanvasActions;
    activeTool: CanvasTool;
    setActiveTool(tool: CanvasTool): void;
    selectedElementIds: string[];
    editingElementId: string | null;
    textDrafts: Record<string, string>;
    previews: ReadonlyMap<string, CanvasPreview>;
    setMovePreview(elementId: string, preview: { x: number; y: number }): void;
    setResizePreview(
        elementId: string,
        preview: { width: number; height: number },
    ): void;
    clearPreview(elementId: string): void;
    getPreview(elementId: string): CanvasPreview | undefined;
    beginEditing(elementId: string): void;
    setTextDraft(elementId: string, content: string): void;
    confirmEditing(
        elementId: string,
    ): Promise<CanvasMutationResult | undefined>;
    cancelEditing(elementId: string): void;
    fitViewHasRun: boolean;
    markFitViewComplete(): void;
};

const CanvasControllerContext = createContext<CanvasControllerValue | null>(
    null,
);

export function CanvasControllerProvider({
    projectId,
    userId,
    children,
}: PropsWithChildren<{ projectId: string; userId: string }>) {
    const [activeTool, setActiveTool] = useState<CanvasTool>("select");
    const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
    const [editingElementId, setEditingElementId] = useState<string | null>(
        null,
    );
    const [textDrafts, setTextDrafts] = useState<Record<string, string>>({});
    const [previews, setPreviews] = useState<Map<string, CanvasPreview>>(
        () => new Map(),
    );
    const [fitViewHasRun, setFitViewHasRun] = useState(false);
    const selectedElementIdsRef = useRef(selectedElementIds);
    const selectionRef = useRef<CanvasSelectionPort>({
        read: () => selectedElementIdsRef.current,
        write: (elementIds) => {
            const next = [...elementIds];
            const current = selectedElementIdsRef.current;
            if (
                current.length === next.length &&
                current.every((elementId, index) => elementId === next[index])
            ) {
                return;
            }
            selectedElementIdsRef.current = next;
            setSelectedElementIds(next);
        },
    });
    const canvas = useCanvas();
    const { snapshotQuery, actions } = canvas.useController({
        projectId,
        userId,
        selection: selectionRef.current,
        onError: () => toast.error("Unable to save canvas change"),
    });

    const setPreview = useCallback(
        (elementId: string, preview: CanvasPreview) => {
            setPreviews((current) => {
                const next = new Map(current);
                next.set(elementId, { ...current.get(elementId), ...preview });
                return next;
            });
        },
        [],
    );

    const clearPreview = useCallback((elementId: string) => {
        setPreviews((current) => {
            if (!current.has(elementId)) return current;
            const next = new Map(current);
            next.delete(elementId);
            return next;
        });
    }, []);

    const markFitViewComplete = useCallback(() => setFitViewHasRun(true), []);

    const beginEditing = (elementId: string) => {
        const element = actions.getElement(elementId);
        if (!element) return;
        setEditingElementId(elementId);
        setTextDrafts((current) => ({
            ...current,
            [elementId]: element.content,
        }));
    };

    const setTextDraft = (elementId: string, content: string) => {
        setTextDrafts((current) => ({ ...current, [elementId]: content }));
    };

    const clearEditing = (elementId: string) => {
        setEditingElementId((current) =>
            current === elementId ? null : current,
        );
        setTextDrafts((current) => {
            if (!(elementId in current)) return current;
            const next = { ...current };
            delete next[elementId];
            return next;
        });
    };

    const confirmEditing = async (elementId: string) => {
        const element = actions.getElement(elementId);
        const draft = textDrafts[elementId];
        if (!element || draft === undefined) return undefined;

        if (draft === element.content) {
            clearEditing(elementId);
            return undefined;
        }

        const result = await actions.updateElement(elementId, {
            content: draft,
        });
        clearEditing(elementId);
        return result;
    };

    const cancelEditing = (elementId: string) => {
        clearEditing(elementId);
    };

    const value: CanvasControllerValue = {
        projectId,
        snapshot: snapshotQuery.data?.response,
        isLoading: snapshotQuery.isPending,
        error: snapshotQuery.isError
            ? snapshotQuery.error instanceof Error
                ? snapshotQuery.error
                : new Error("Unable to load canvas")
            : null,
        retry: () => void snapshotQuery.refetch(),
        actions,
        activeTool,
        setActiveTool,
        selectedElementIds,
        editingElementId,
        textDrafts,
        previews,
        setMovePreview: setPreview,
        setResizePreview: setPreview,
        clearPreview,
        getPreview: (elementId) => previews.get(elementId),
        beginEditing,
        setTextDraft,
        confirmEditing,
        cancelEditing,
        fitViewHasRun,
        markFitViewComplete,
    };

    return (
        <CanvasControllerContext.Provider value={value}>
            {children}
        </CanvasControllerContext.Provider>
    );
}

export function useCanvasController(): CanvasControllerValue {
    const context = useContext(CanvasControllerContext);
    if (!context) {
        throw new Error(
            "useCanvasController must be used inside CanvasControllerProvider",
        );
    }
    return context;
}
