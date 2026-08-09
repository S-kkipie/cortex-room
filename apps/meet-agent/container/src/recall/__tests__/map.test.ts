import { describe, expect, it } from "vitest";
import { mapRecallEvent } from "../map";

const ctx = { meetingId: "m1", t0Ms: 1_000_000, genId: () => "seg1" };

describe("mapRecallEvent", () => {
    it("maps transcript.data to a resolved transcript.segment", () => {
        const payload = {
            event: "transcript.data",
            data: {
                data: {
                    words: [
                        { text: "hola", start_timestamp: { relative: 1.0 }, end_timestamp: { relative: 1.5 } },
                        { text: "equipo", start_timestamp: { relative: 1.5 }, end_timestamp: { relative: 2.0 } },
                    ],
                    language_code: "es",
                    participant: { id: 42, name: "Diego", is_host: true, email: "d@x.com" },
                },
            },
        };
        const evs = mapRecallEvent(payload, ctx);
        expect(evs).toHaveLength(1);
        const ev = evs[0];
        expect(ev.type).toBe("transcript.segment");
        if (ev.type === "transcript.segment") {
            expect(ev.segment.text).toBe("hola equipo");
            expect(ev.segment.speaker).toMatchObject({ participantId: "42", displayName: "Diego" });
            expect(ev.segment.identityConfidence).toBe("resolved");
            expect(ev.segment.startedAt).toBe(new Date(1_000_000 + 1000).toISOString());
            expect(ev.segment.endedAt).toBe(new Date(1_000_000 + 2000).toISOString());
            expect(ev.segment.isFinal).toBe(true);
        }
    });

    it("maps a null participant to unresolved", () => {
        const payload = {
            event: "transcript.data",
            data: { data: { words: [{ text: "eh", start_timestamp: { relative: 0 }, end_timestamp: { relative: 0.4 } }], participant: null } },
        };
        const ev = mapRecallEvent(payload, ctx)[0];
        expect(ev.type === "transcript.segment" && ev.segment.identityConfidence).toBe("unresolved");
        if (ev.type === "transcript.segment") expect(ev.segment.speaker).toMatchObject({ kind: "unresolved" });
    });

    it("drops an empty-word transcript", () => {
        const payload = { event: "transcript.data", data: { data: { words: [], participant: { id: 1, name: "A" } } } };
        expect(mapRecallEvent(payload, ctx)).toEqual([]);
    });

    it("maps participant_events.join", () => {
        const payload = {
            event: "participant_events.join",
            data: { data: { participant: { id: 7, name: "Sofia" }, timestamp: { absolute: "2026-08-09T00:00:05.000Z", relative: 5 } } },
        };
        const ev = mapRecallEvent(payload, ctx)[0];
        expect(ev).toMatchObject({ type: "participant.joined", at: "2026-08-09T00:00:05.000Z" });
        if (ev.type === "participant.joined") expect(ev.participant).toMatchObject({ participantId: "7", displayName: "Sofia" });
    });

    it("maps participant_events.update to an upsert participant.joined", () => {
        const payload = {
            event: "participant_events.update",
            data: { data: { participant: { id: 7, name: "Sofia", email: "s@x.com" }, timestamp: { absolute: "2026-08-09T00:00:06.000Z", relative: 6 } } },
        };
        const ev = mapRecallEvent(payload, ctx)[0];
        expect(ev.type).toBe("participant.joined");
    });

    it("maps participant_events.leave", () => {
        const payload = {
            event: "participant_events.leave",
            data: { data: { participant: { id: 7 }, timestamp: { absolute: "2026-08-09T00:01:00.000Z", relative: 60 } } },
        };
        expect(mapRecallEvent(payload, ctx)[0]).toMatchObject({ type: "participant.left", participantId: "7", at: "2026-08-09T00:01:00.000Z" });
    });

    it("maps speech_on / speech_off to speaker.active", () => {
        const on = {
            event: "participant_events.speech_on",
            data: { data: { participant: { id: 7 }, timestamp: { absolute: "2026-08-09T00:00:10.000Z", relative: 10 } } },
        };
        const off = {
            event: "participant_events.speech_off",
            data: { data: { participant: { id: 7 }, timestamp: { absolute: "2026-08-09T00:00:12.000Z", relative: 12 } } },
        };
        expect(mapRecallEvent(on, ctx)[0]).toMatchObject({ type: "speaker.active", participantId: "7", active: true });
        expect(mapRecallEvent(off, ctx)[0]).toMatchObject({ type: "speaker.active", participantId: "7", active: false });
    });

    it("returns [] for an unknown event", () => {
        expect(mapRecallEvent({ event: "video_separate_png.data", data: {} }, ctx)).toEqual([]);
    });
});
