import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../container/src/contract/events";
import { bridgeShouldConsume, isUuid, shouldContinueAlarm } from "../worker";

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

describe("isUuid", () => {
    it("accepts a valid v4 UUID", () => {
        expect(isUuid("99999999-9999-4999-8999-999999999999")).toBe(true);
    });
    it("rejects a non-UUID slug", () => {
        expect(isUuid("abc123")).toBe(false);
    });
    it("rejects an empty string", () => {
        expect(isUuid("")).toBe(false);
    });
});

describe("shouldContinueAlarm", () => {
    it("returns true when meeting is active and bridge exists", () => {
        expect(shouldContinueAlarm("in_meeting", true)).toBe(true);
    });
    it("returns false when meeting is active but bridge is missing", () => {
        expect(shouldContinueAlarm("in_meeting", false)).toBe(false);
    });
    it("returns false when meeting ended even if bridge exists", () => {
        expect(shouldContinueAlarm("ended", true)).toBe(false);
    });
    it("returns false when meeting is idle even if bridge exists", () => {
        expect(shouldContinueAlarm("idle", true)).toBe(false);
    });
});
