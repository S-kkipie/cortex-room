import { describe, expect, it } from "vitest";
import { agentEventSchema, transcriptSegmentSchema } from "../events";

describe("contract", () => {
    it("accepts a resolved-speaker segment", () => {
        const seg = {
            segmentId: "s1",
            meetingId: "m1",
            speaker: { participantId: "p1", displayName: "Diego" },
            text: "hola",
            startedAt: "2026-08-08T00:00:00.000Z",
            endedAt: "2026-08-08T00:00:02.000Z",
            isFinal: true,
            identityConfidence: "inferred",
        };
        expect(transcriptSegmentSchema.parse(seg).segmentId).toBe("s1");
    });

    it("accepts an unresolved speaker", () => {
        const seg = {
            segmentId: "s2",
            meetingId: "m1",
            speaker: { kind: "unresolved", diarizedLabel: "A" },
            text: "eh",
            startedAt: "2026-08-08T00:00:00.000Z",
            endedAt: "2026-08-08T00:00:01.000Z",
            isFinal: false,
            identityConfidence: "unresolved",
        };
        expect(transcriptSegmentSchema.parse(seg).speaker).toMatchObject({ kind: "unresolved" });
    });

    it("rejects an unknown identityConfidence", () => {
        expect(() =>
            transcriptSegmentSchema.parse({
                segmentId: "s3",
                meetingId: "m1",
                speaker: { participantId: "p1" },
                text: "x",
                startedAt: "2026-08-08T00:00:00.000Z",
                endedAt: "2026-08-08T00:00:01.000Z",
                isFinal: true,
                identityConfidence: "certain",
            }),
        ).toThrow();
    });

    it("discriminates AgentEvent by type", () => {
        const ev = { type: "participant.joined", participant: { participantId: "p1" }, at: "2026-08-08T00:00:00.000Z" };
        expect(agentEventSchema.parse(ev).type).toBe("participant.joined");
    });

    it("discriminates a speaker.active event", () => {
        const ev = {
            type: "speaker.active",
            participantId: "42",
            active: true,
            at: "2026-08-09T00:00:00.000Z",
        };
        const parsed = agentEventSchema.parse(ev);
        expect(parsed.type).toBe("speaker.active");
        if (parsed.type === "speaker.active") expect(parsed.active).toBe(true);
    });
});
