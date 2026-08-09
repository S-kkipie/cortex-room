import { describe, expect, it } from "vitest";
import type { Participant } from "../../contract/events";
import { resolveOwners } from "../owners";
import type { CanvasNote } from "../types";

const participants: Participant[] = [
    { participantId: "p1", displayName: "Diego" },
    { participantId: "p2", displayName: "Ana García" },
];

describe("resolveOwners", () => {
    it("resolves a case-insensitive name match", () => {
        const notes: CanvasNote[] = [{ category: "action", text: "x", ownerName: "diego" }];
        expect(resolveOwners(notes, participants)[0].ownerParticipantId).toBe("p1");
    });

    it("leaves id undefined when no match", () => {
        const notes: CanvasNote[] = [{ category: "action", text: "x", ownerName: "Bob" }];
        expect(resolveOwners(notes, participants)[0].ownerParticipantId).toBeUndefined();
    });

    it("ignores notes without ownerName", () => {
        const notes: CanvasNote[] = [{ category: "topic", text: "x" }];
        expect(resolveOwners(notes, participants)[0].ownerParticipantId).toBeUndefined();
    });
});
