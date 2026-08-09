"use client";

import {
    Hand,
    Heading,
    MousePointer2,
    Square,
    StickyNote,
    Trash2,
    Type,
} from "lucide-react";
import { useCanvasController } from "@/core/canvas/client/controller/canvas-controller-context";
import { Button } from "@/frontend/components/ui/button";
import { Separator } from "@/frontend/components/ui/separator";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/frontend/components/ui/tooltip";

const TOOL_BUTTONS = [
    {
        tool: "select",
        label: "Select",
        ariaLabel: "Select",
        icon: MousePointer2,
    },
    { tool: "hand", label: "Hand", ariaLabel: "Hand", icon: Hand },
    {
        tool: "STICKY",
        label: "Sticky",
        ariaLabel: "Create sticky",
        icon: StickyNote,
    },
    { tool: "TEXT", label: "Text", ariaLabel: "Create text", icon: Type },
    { tool: "CARD", label: "Card", ariaLabel: "Create card", icon: Square },
    {
        tool: "HEADING",
        label: "Heading",
        ariaLabel: "Create heading",
        icon: Heading,
    },
] as const;

export function CanvasToolbar() {
    const {
        actions,
        activeTool,
        error,
        isLoading,
        selectedElementIds,
        setActiveTool,
    } = useCanvasController();
    const disabled = isLoading || error !== null;

    return (
        <TooltipProvider>
            <fieldset aria-label="Canvas tools" className="canvas-toolbar">
                <span className="canvas-toolbar-label" aria-hidden="true">
                    Tools
                </span>
                {TOOL_BUTTONS.map(({ tool, label, ariaLabel, icon: Icon }) => (
                    <Tooltip key={tool}>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant={
                                    activeTool === tool ? "secondary" : "ghost"
                                }
                                size="icon-sm"
                                className="canvas-tool-button"
                                aria-label={ariaLabel}
                                aria-pressed={activeTool === tool}
                                disabled={disabled}
                                onClick={() => setActiveTool(tool)}
                            >
                                <Icon />
                                <span className="sr-only">{label}</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" sideOffset={8}>
                            {label}
                        </TooltipContent>
                    </Tooltip>
                ))}
                <Separator
                    orientation="vertical"
                    className="canvas-toolbar-separator"
                />
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="canvas-tool-button canvas-delete-button"
                            aria-label="Delete selected element"
                            disabled={
                                disabled || selectedElementIds.length === 0
                            }
                            onClick={() => {
                                const elementId = selectedElementIds[0];
                                if (!elementId) return;
                                void Promise.resolve(
                                    actions.deleteElement(elementId),
                                ).catch(() => undefined);
                                setActiveTool("select");
                            }}
                        >
                            <Trash2 />
                            <span className="sr-only">Delete</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={8}>
                        Delete
                    </TooltipContent>
                </Tooltip>
            </fieldset>
        </TooltipProvider>
    );
}
