import { describe, expect, it } from "vitest";
import { resolveSpeaker } from "../correlator";

const P = (participantId: string, displayName: string, start: number, end: number) => ({ participantId, displayName, start, end });

describe("resolveSpeaker", () => {
    it("infers the dominant overlapping speaker", () => {
        const r = resolveSpeaker({ start: 1000, end: 3000 }, [P("p1", "Diego", 900, 3200)]);
        expect(r.identityConfidence).toBe("inferred");
        expect(r.speaker).toMatchObject({ participantId: "p1", displayName: "Diego" });
    });

    it("is unresolved when overlap is below 60%", () => {
        const r = resolveSpeaker({ start: 1000, end: 3000 }, [P("p1", "Diego", 2500, 3000)]);
        expect(r.identityConfidence).toBe("unresolved");
    });

    it("is unresolved with no active-speaker data", () => {
        const r = resolveSpeaker({ start: 1000, end: 3000 }, []);
        expect(r.identityConfidence).toBe("unresolved");
        expect(r.speaker).toMatchObject({ kind: "unresolved" });
    });

    it("picks the greater-overlap speaker when two overlap", () => {
        const r = resolveSpeaker({ start: 1000, end: 3000 }, [
            P("p1", "Diego", 1000, 1400),
            P("p2", "Sofia", 1400, 3000),
        ]);
        expect(r.speaker).toMatchObject({ participantId: "p2" });
        expect(r.identityConfidence).toBe("inferred");
    });
});
