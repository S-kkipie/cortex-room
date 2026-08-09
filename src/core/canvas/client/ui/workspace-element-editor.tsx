"use client";

import { useCallback, useEffect, useRef } from "react";
import { useCanvasController } from "@/core/canvas/client/controller/canvas-controller-context";
import { TEXT_COMMIT_IDLE_MS } from "@/core/canvas/domain/schemas";
import type { WorkspaceElement } from "@/core/canvas/domain/types";
import { Textarea } from "@/frontend/components/ui/textarea";

export function WorkspaceElementEditor({
    element,
}: {
    element: WorkspaceElement;
}) {
    const { textDrafts, setTextDraft, confirmEditing, cancelEditing } =
        useCanvasController();
    const skipNextBlur = useRef(false);
    const value = textDrafts[element.id] ?? element.content;
    const confirm = useCallback(
        () =>
            Promise.resolve(confirmEditing(element.id)).finally(() => {
                skipNextBlur.current = false;
            }),
        [confirmEditing, element.id],
    );

    useEffect(() => {
        if (value === element.content) return;
        const timer = setTimeout(() => {
            void confirm().catch(() => undefined);
        }, TEXT_COMMIT_IDLE_MS);

        return () => clearTimeout(timer);
    }, [confirm, element.content, value]);

    return (
        <Textarea
            aria-label={`${element.type} content`}
            autoFocus
            className="canvas-node-editor nodrag nowheel h-full resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            value={value}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => setTextDraft(element.id, event.target.value)}
            onBlur={() => {
                if (skipNextBlur.current) {
                    skipNextBlur.current = false;
                    return;
                }
                void confirm().catch(() => undefined);
            }}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelEditing(element.id);
                    return;
                }

                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    skipNextBlur.current = true;
                    void confirm().catch(() => undefined);
                }
            }}
        />
    );
}
