import { describe, expect, it, vi } from "vitest";
import type { Participant, TranscriptSegment } from "../../contract/events";
import { Bridge } from "../bridge";

function seg(text: string): TranscriptSegment {
    return {
        segmentId: text,
        meetingId: "m",
        speaker: { participantId: "p1", displayName: "Diego" },
        text,
        startedAt: "2026-08-08T00:00:00.000Z",
        endedAt: "2026-08-08T00:00:01.000Z",
        isFinal: true,
        identityConfidence: "resolved",
    };
}

let uuidN = 0;
const genId = () => `0000000${uuidN++}`.slice(-8).replace(/(.{8})/, "$1-0000-4000-8000-000000000000");

function makeBridge(extractImpl: (p: string) => Promise<string>, publish = vi.fn(async () => {})) {
    const participants: Participant[] = [{ participantId: "p1", displayName: "Diego" }];
    let clock = 0;
    const bridge = new Bridge({
        projectId: "99999999-9999-4999-8999-999999999999",
        extractImpl,
        publisher: { publish },
        participants: () => participants,
        genId,
        now: () => clock,
        nowIso: () => "2026-08-08T00:00:00.000Z",
    });
    return { bridge, publish, advance: (ms: number) => { clock = ms; } };
}

describe("Bridge", () => {
    it("publishes a canvas message per fresh note after flush", async () => {
        const extractImpl = async () => JSON.stringify({ actionItems: [{ text: "ship", owner: "Diego" }] });
        const { bridge, publish } = makeBridge(extractImpl);
        for (let i = 0; i < 8; i++) bridge.onSegment(seg(`u${i}`));
        await bridge.flush();
        expect(publish).toHaveBeenCalledTimes(1);
    });

    it("does not re-publish a note already emitted", async () => {
        const extractImpl = async () => JSON.stringify({ decisions: [{ text: "use Recall" }] });
        const { bridge, publish } = makeBridge(extractImpl);
        bridge.onSegment(seg("a"));
        await bridge.flush();
        bridge.onSegment(seg("b"));
        await bridge.flush();
        expect(publish).toHaveBeenCalledTimes(1);
    });

    it("processes a window buffered while a prior flush is in flight (no dropped flush)", async () => {
        let gateResolve!: () => void;
        const gate = new Promise<void>((r) => {
            gateResolve = r;
        });
        let calls = 0;
        const extractImpl = async () => {
            calls += 1;
            const c = calls;
            if (c === 1) await gate;
            return JSON.stringify({ topics: [{ text: `topic-${c}` }] });
        };
        const { bridge, publish } = makeBridge(extractImpl);

        bridge.onSegment(seg("first window"));
        const pA = bridge.flush(); // drains window 1, blocks on gate
        await new Promise((r) => setTimeout(r, 0)); // let A drain + park at gate
        bridge.onSegment(seg("second window"));
        const pB = bridge.flush(); // must run AFTER A, not be dropped
        gateResolve();
        await Promise.all([pA, pB]);

        expect(publish).toHaveBeenCalledTimes(2);
    });

    it("never throws when extract fails", async () => {
        const extractImpl = async () => {
            throw new Error("boom");
        };
        const { bridge, publish } = makeBridge(extractImpl);
        bridge.onSegment(seg("a"));
        await expect(bridge.flush()).resolves.toBeUndefined();
        expect(publish).not.toHaveBeenCalled();
    });
});
