import type { selectors as Selectors } from "./selectors";

export type RosterEntry = { participantId: string; displayName: string };
export type ActiveSpeakerSample = { participantId: string; displayName: string; at: number };

export function readRoster(doc: Document, sel: typeof Selectors): RosterEntry[] {
    const out: RosterEntry[] = [];
    for (const tile of Array.from(doc.querySelectorAll(sel.participantTile))) {
        const participantId = tile.getAttribute("data-participant-id");
        if (!participantId) continue;
        const nameEl = tile.querySelector(sel.participantName);
        out.push({ participantId, displayName: nameEl?.textContent?.trim() ?? participantId });
    }
    return out;
}

export function readActiveSpeakers(doc: Document, sel: typeof Selectors, now: number): ActiveSpeakerSample[] {
    const out: ActiveSpeakerSample[] = [];
    for (const tile of Array.from(doc.querySelectorAll(sel.participantTile))) {
        const participantId = tile.getAttribute("data-participant-id");
        if (!participantId) continue;
        if (!tile.matches(sel.activeSpeakerMarker)) continue;
        const nameEl = tile.querySelector(sel.participantName);
        out.push({ participantId, displayName: nameEl?.textContent?.trim() ?? participantId, at: now });
    }
    return out;
}
