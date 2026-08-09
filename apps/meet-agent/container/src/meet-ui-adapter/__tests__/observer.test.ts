import { describe, expect, it } from "vitest";
import { selectors } from "../selectors";
import { readActiveSpeakers, readRoster } from "../observer";

// Minimal DOM: build with a tiny helper backed by linkedom if available; here we
// construct a fake matching the reader's contract.
function fakeDoc(tiles: Array<{ id: string; name: string; speaking: boolean }>): Document {
    const els = tiles.map((t) => ({
        getAttribute: (a: string) => (a === selectors.participantIdAttr ? t.id : null),
        querySelector: (q: string) =>
            q === selectors.participantName ? ({ textContent: t.name } as unknown as Element) : null,
        matches: (q: string) => q === selectors.activeSpeakerMarker && t.speaking,
    }));
    return {
        querySelectorAll: (q: string) => (q === selectors.participantTile ? (els as unknown as NodeListOf<Element>) : ([] as unknown as NodeListOf<Element>)),
    } as unknown as Document;
}

describe("meet-ui-adapter readers", () => {
    it("reads a roster", () => {
        const doc = fakeDoc([{ id: "p1", name: "Diego", speaking: false }, { id: "p2", name: "Sofia", speaking: true }]);
        expect(readRoster(doc, selectors)).toEqual([
            { participantId: "p1", displayName: "Diego" },
            { participantId: "p2", displayName: "Sofia" },
        ]);
    });

    it("reads only active speakers with a timestamp", () => {
        const doc = fakeDoc([{ id: "p1", name: "Diego", speaking: false }, { id: "p2", name: "Sofia", speaking: true }]);
        const samples = readActiveSpeakers(doc, selectors, 5000);
        expect(samples).toEqual([{ participantId: "p2", displayName: "Sofia", at: 5000 }]);
    });
});
