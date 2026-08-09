import { describe, expect, it, vi } from "vitest";
import { canvasPortalMessageSchema } from "../../../../../../src/core/canvas/domain/schemas";
import { createCanvasPublisher, toCanvasMessage } from "../canvas-publish";
import type { CanvasNote } from "../types";

let n = 0;
const UUIDS = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
];
const genId = () => UUIDS[n++ % UUIDS.length];
const projectId = "99999999-9999-4999-8999-999999999999";
const pos = { x: 0, y: 0, width: 240, height: 120 };
const nowIso = "2026-08-08T00:00:00.000Z";

describe("toCanvasMessage", () => {
    it("produces a message that passes the canvas schema", () => {
        n = 0;
        const note: CanvasNote = { category: "action", text: "ship it", ownerName: "Diego", ownerParticipantId: "p1" };
        const msg = toCanvasMessage({ note, projectId, pos, genId, nowIso });
        expect(() => canvasPortalMessageSchema.parse(msg)).not.toThrow();
        expect(msg.type).toBe("workspace.element.created");
        expect(msg.ephemeral).toBe(false);
        expect(msg.senderId).toBe("meet-agent");
    });

    it("prefixes by category and appends owner", () => {
        n = 0;
        const note: CanvasNote = { category: "risk", text: "leak", ownerName: "Ana" };
        const msg = toCanvasMessage({ note, projectId, pos, genId, nowIso });
        const content = (msg.content as { element: { content: string } }).element.content;
        expect(content).toBe("⚠️ leak — @Ana");
    });

    it("gives each note distinct element ids", () => {
        n = 0;
        const a = toCanvasMessage({ note: { category: "topic", text: "a" }, projectId, pos, genId, nowIso });
        const b = toCanvasMessage({ note: { category: "topic", text: "b" }, projectId, pos, genId, nowIso });
        const idA = (a.content as { element: { id: string } }).element.id;
        const idB = (b.content as { element: { id: string } }).element.id;
        expect(idA).not.toBe(idB);
    });
});

describe("createCanvasPublisher", () => {
    it("swallows send errors", async () => {
        const _sendImpl = vi.fn(async () => {
            throw new Error("down");
        });
        const pub = createCanvasPublisher({ apiKey: "k", projectId, _sendImpl });
        await expect(pub.publish({ any: true })).resolves.toBeUndefined();
    });
});
