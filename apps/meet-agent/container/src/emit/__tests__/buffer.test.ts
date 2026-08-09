import { describe, expect, it, vi } from "vitest";
import { EventBuffer } from "../buffer";

const ev = (at: string) => ({ type: "session.started", meetingId: "m1", at }) as const;

describe("EventBuffer", () => {
    it("returns events after a cursor", () => {
        const b = new EventBuffer();
        const c1 = b.append(ev("t1"));
        b.append(ev("t2"));
        const res = b.since(c1);
        expect(res.events).toHaveLength(1);
        expect((res.events[0] as { at: string }).at).toBe("t2");
    });

    it("notifies subscribers and can unsubscribe", () => {
        const b = new EventBuffer();
        const seen = vi.fn();
        const off = b.subscribe(seen);
        b.append(ev("t1"));
        off();
        b.append(ev("t2"));
        expect(seen).toHaveBeenCalledTimes(1);
    });
});
