import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "../../contract/events";
import { BridgeBuffer } from "../buffer";

function seg(text: string, isFinal = true, speakerName = "Diego"): TranscriptSegment {
    return {
        segmentId: text,
        meetingId: "m1",
        speaker: { participantId: "p1", displayName: speakerName },
        text,
        startedAt: "2026-08-08T00:00:00.000Z",
        endedAt: "2026-08-08T00:00:01.000Z",
        isFinal,
        identityConfidence: "resolved",
    };
}

describe("BridgeBuffer", () => {
    it("ignores non-final segments", () => {
        const b = new BridgeBuffer(0);
        b.append(seg("partial", false));
        expect(b.shouldFlush(0)).toBe(false);
    });

    it("flushes at 8 final utterances", () => {
        const b = new BridgeBuffer(0);
        for (let i = 0; i < 7; i++) b.append(seg(`u${i}`));
        expect(b.shouldFlush(100)).toBe(false);
        b.append(seg("u7"));
        expect(b.shouldFlush(100)).toBe(true);
    });

    it("flushes after 30s when non-empty", () => {
        const b = new BridgeBuffer(0);
        b.append(seg("hi"));
        expect(b.shouldFlush(29_999)).toBe(false);
        expect(b.shouldFlush(30_000)).toBe(true);
    });

    it("does not flush on timeout when empty", () => {
        const b = new BridgeBuffer(0);
        expect(b.shouldFlush(60_000)).toBe(false);
    });

    it("drain concatenates speaker-labelled lines and resets", () => {
        const b = new BridgeBuffer(0);
        b.append(seg("hello", true, "Diego"));
        b.append(seg("world", true, "Ana"));
        const { text } = b.drain(1000);
        expect(text).toBe("Diego: hello\nAna: world");
        expect(b.shouldFlush(40_000)).toBe(false); // emptied + lastFlush reset
    });
});
