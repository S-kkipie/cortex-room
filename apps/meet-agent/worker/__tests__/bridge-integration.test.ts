import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../container/src/contract/events";
import { bridgeShouldConsume } from "../worker";

const finalSeg: AgentEvent = {
    type: "transcript.segment",
    segment: {
        segmentId: "s", meetingId: "m", speaker: { kind: "unresolved" },
        text: "hi", startedAt: "2026-08-08T00:00:00.000Z", endedAt: "2026-08-08T00:00:01.000Z",
        isFinal: true, identityConfidence: "unresolved",
    },
};

describe("bridgeShouldConsume", () => {
    it("consumes final transcript segments", () => {
        expect(bridgeShouldConsume(finalSeg)).toBe(true);
    });
    it("skips non-final segments", () => {
        const partial = { ...finalSeg, segment: { ...finalSeg.segment, isFinal: false } } as AgentEvent;
        expect(bridgeShouldConsume(partial)).toBe(false);
    });
    it("skips non-transcript events", () => {
        expect(bridgeShouldConsume({ type: "session.ended", meetingId: "m", at: "t", reason: "x" })).toBe(false);
    });
});
