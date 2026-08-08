import { describe, expect, it, vi } from "vitest";
import { createPortalPublisher } from "../portal";

describe("createPortalPublisher", () => {
    it("does not throw when the underlying send fails", async () => {
        const send = vi.fn().mockRejectedValue(new Error("network"));
        const pub = createPortalPublisher({ apiKey: "pk", channelId: "meeting-1", _sendImpl: send });
        await expect(pub.publish({ type: "session.ended", meetingId: "m1", at: "t", reason: "done" })).resolves.toBeUndefined();
        expect(send).toHaveBeenCalledOnce();
    });
});
