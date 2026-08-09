import type { NoteCategory } from "./types";

export const NOTE_WIDTH = 240;
export const NOTE_HEIGHT = 120;
export const GAP_X = 40;
export const GAP_Y = 24;

const COLUMN_ORDER: NoteCategory[] = ["action", "decision", "topic", "question", "risk"];

export class LayoutCursor {
    private counts = new Map<NoteCategory, number>();

    place(category: NoteCategory): { x: number; y: number; width: number; height: number } {
        const col = COLUMN_ORDER.indexOf(category);
        const row = this.counts.get(category) ?? 0;
        this.counts.set(category, row + 1);
        return {
            x: col * (NOTE_WIDTH + GAP_X),
            y: row * (NOTE_HEIGHT + GAP_Y),
            width: NOTE_WIDTH,
            height: NOTE_HEIGHT,
        };
    }
}
