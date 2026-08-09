export type CanvasPreview = {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    content?: string;
};

export type CanvasPreviewPort = {
    set(elementId: string, preview: CanvasPreview): void;
    clear(elementId: string): void;
};
