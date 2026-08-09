import type { WorkspaceElementType } from "@/core/canvas/domain/types";

export const ELEMENT_DEFAULTS = {
    STICKY: { width: 240, height: 180, minWidth: 160, minHeight: 100 },
    TEXT: { width: 280, height: 120, minWidth: 160, minHeight: 64 },
    CARD: { width: 320, height: 200, minWidth: 220, minHeight: 120 },
    HEADING: { width: 360, height: 96, minWidth: 200, minHeight: 64 },
} as const satisfies Record<
    WorkspaceElementType,
    { width: number; height: number; minWidth: number; minHeight: number }
>;

export function getElementDefaults(type: WorkspaceElementType) {
    return ELEMENT_DEFAULTS[type];
}

export function parseCardContent(content: string) {
    const [titleLine = "", ...descriptionLines] = content.split(/\r?\n/);

    return {
        title: titleLine.trim(),
        description: descriptionLines.join("\n").trimEnd(),
    };
}
