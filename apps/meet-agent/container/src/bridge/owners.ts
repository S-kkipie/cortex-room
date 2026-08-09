import type { Participant } from "../contract/events";
import type { CanvasNote } from "./types";

export function resolveOwners(notes: CanvasNote[], participants: Iterable<Participant>): CanvasNote[] {
    const byName = new Map<string, string>();
    for (const p of participants) {
        if (p.displayName) byName.set(p.displayName.toLowerCase(), p.participantId);
    }
    return notes.map((note) => {
        if (!note.ownerName) return note;
        const id = byName.get(note.ownerName.toLowerCase());
        return id ? { ...note, ownerParticipantId: id } : note;
    });
}
