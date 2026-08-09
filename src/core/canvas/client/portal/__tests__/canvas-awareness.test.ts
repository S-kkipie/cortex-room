import type { DetailedPresence } from "@portalsdk/react";
import { describe, expect, it } from "vitest";
import type { CanvasPortalMessage } from "@/core/canvas/domain/types";
import { normalizeCanvasAwareness } from "../canvas-awareness";
import {
    buildCursorMessage,
    buildSelectionMessage,
} from "../canvas-portal-events";

const projectId = "00000000-0000-4000-8000-000000000001";
const elementId = "00000000-0000-4000-8000-000000000002";
const metadata = {
    eventId: "00000000-0000-4000-8000-000000000003",
    projectId,
    occurredAt: "2026-08-09T12:00:00.000Z",
    senderId: "remote-user",
};

function presence(
    participants: DetailedPresence["participants"],
): DetailedPresence {
    return { kind: "detailed", participants, count: participants.length };
}

describe("canvas awareness", () => {
    it("builds cursor and selection as validated ephemeral messages", () => {
        expect(buildCursorMessage(metadata, { x: 12, y: 30 })).toMatchObject({
            type: "participant.cursor.moved",
            ephemeral: true,
            senderId: "remote-user",
            content: {
                kind: "participant.cursor.moved",
                cursor: { x: 12, y: 30 },
            },
        });
        expect(buildSelectionMessage(metadata, [elementId])).toMatchObject({
            type: "participant.selection.changed",
            ephemeral: true,
            content: {
                kind: "participant.selection.changed",
                elementIds: [elementId],
            },
        });
    });

    it("uses presence metadata as the initial fallback and live messages last", () => {
        const messages = [
            buildCursorMessage(metadata, { x: 80, y: 90 }),
            buildSelectionMessage(metadata, [elementId]),
        ] satisfies CanvasPortalMessage[];
        const result = normalizeCanvasAwareness(
            presence([
                {
                    id: "remote-user",
                    anon: false,
                    username: "Ada",
                    metadata: {
                        cursor: { x: 10, y: 20 },
                        selectedElementIds: [],
                        preview: {
                            kind: "move",
                            elementId,
                            x: 40,
                            y: 50,
                        },
                    },
                },
                { id: "local-user", anon: false },
            ]),
            messages,
            projectId,
            "local-user",
        );

        expect(result.onlineCount).toBe(1);
        expect(result.participants).toEqual([
            {
                id: "remote-user",
                label: "Ada",
                cursor: { x: 80, y: 90 },
                selectedElementIds: [elementId],
                preview: {
                    kind: "move",
                    elementId,
                    x: 40,
                    y: 50,
                },
            },
        ]);
    });

    it("rejects invalid metadata and ignores absent, own, or unknown senders", () => {
        const result = normalizeCanvasAwareness(
            presence([
                {
                    id: "remote-user",
                    anon: false,
                    metadata: { selectedElementIds: ["not-a-uuid"] },
                },
                { id: "local-user", anon: false },
            ]),
            [
                buildCursorMessage(
                    { ...metadata, senderId: "local-user" },
                    { x: 1, y: 2 },
                ),
                buildCursorMessage(
                    { ...metadata, senderId: "unknown-user" },
                    { x: 3, y: 4 },
                ),
            ],
            projectId,
            "local-user",
        );

        expect(result.participants).toEqual([
            {
                id: "remote-user",
                label: "Collaborator remote",
                selectedElementIds: [],
            },
        ]);
        expect(result.cursors.size).toBe(0);
    });

    it("reports only the remote count when Portal exposes aggregate presence", () => {
        const result = normalizeCanvasAwareness(
            {
                kind: "aggregate",
                count: 3,
                recent: [],
            },
            [],
            projectId,
            "local-user",
        );

        expect(result.onlineCount).toBe(2);
        expect(result.participants).toEqual([]);
    });
});
