import type { Message } from "@portalsdk/core";
import { describe, expect, it } from "vitest";
import type { CanvasPortalMessage } from "@/core/canvas/domain/types";
import { normalizePortalMessages } from "../canvas-portal-provider";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const ELEMENT_ID = "00000000-0000-4000-8000-000000000002";
const OPERATION_ID = "00000000-0000-4000-8000-000000000003";
const OCCURRED_AT = "2026-08-09T12:00:00.000Z";

function message(
    content: CanvasPortalMessage,
    senderId = "verified-user",
): Message<CanvasPortalMessage> {
    return {
        id: OPERATION_ID,
        channelId: `room-${PROJECT_ID}`,
        sender: { id: senderId, anon: false },
        timestamp: Date.parse(OCCURRED_AT),
        retracted: false,
        ephemeral: content.ephemeral,
        kind: "text",
        type: "message",
        content,
        unread: false,
        status: "sent",
    };
}

const validMessage: CanvasPortalMessage = {
    type: "workspace.element.created",
    ephemeral: false,
    senderId: "spoofed-content-user",
    content: {
        eventId: OPERATION_ID,
        projectId: PROJECT_ID,
        occurredAt: OCCURRED_AT,
        kind: "workspace.element.created.final",
        element: {
            id: ELEMENT_ID,
            projectId: PROJECT_ID,
            type: "STICKY",
            content: "Hello",
            x: 10,
            y: 20,
            width: 240,
            height: 180,
            createdBy: "verified-user",
            createdAt: OCCURRED_AT,
            updatedAt: OCCURRED_AT,
            lastOperationAt: OCCURRED_AT,
            lastOperationId: OPERATION_ID,
        },
    },
};

describe("normalizePortalMessages", () => {
    it("uses the verified Portal sender instead of content senderId", () => {
        const [normalized] = normalizePortalMessages(
            [message(validMessage)],
            PROJECT_ID,
        );

        expect(normalized).toMatchObject({
            senderId: "verified-user",
            content: { projectId: PROJECT_ID },
        });
    });

    it("ignores invalid events and messages from another project", () => {
        const otherProjectMessage = message({
            ...validMessage,
            content: {
                ...validMessage.content,
                projectId: "00000000-0000-4000-8000-000000000004",
            },
        });
        const invalidMessage = message({
            ...validMessage,
            content: {
                ...validMessage.content,
                eventId: "not-a-uuid",
            } as unknown as CanvasPortalMessage["content"],
        });

        expect(
            normalizePortalMessages(
                [otherProjectMessage, invalidMessage],
                PROJECT_ID,
            ),
        ).toEqual([]);
    });
});
