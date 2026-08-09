import type { CanvasNote } from "./types";

function normalize(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?,;:]+$/, "");
}

export class NoteDedup {
    private seen = new Set<string>();

    fingerprint(note: CanvasNote): string {
        return `${note.category}|${normalize(note.text)}`;
    }

    filterNew(notes: CanvasNote[]): CanvasNote[] {
        const fresh: CanvasNote[] = [];
        for (const note of notes) {
            const fp = this.fingerprint(note);
            if (this.seen.has(fp)) continue;
            this.seen.add(fp);
            fresh.push(note);
        }
        return fresh;
    }
}
