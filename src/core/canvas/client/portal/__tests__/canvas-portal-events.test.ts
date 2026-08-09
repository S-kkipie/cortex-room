import { describe, expect, it } from "vitest";
import type {
    CanvasCommand,
    CanvasMutationResult,
    ElementTombstone,
    WorkspaceElement,
} from "@/core/canvas/domain/types";
import {
    buildFinalCanvasMessage,
    buildMovePreviewMessage,
    buildResizePreviewMessage,
    buildTextPreviewMessage,
} from "../canvas-portal-events";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const ELEMENT_ID = "00000000-0000-4000-8000-000000000002";
const EVENT_ID = "00000000-0000-4000-8000-000000000003";
const OCCURRED_AT = "2026-08-09T12:00:00.000Z";

const element: WorkspaceElement = {
    id: ELEMENT_ID,
    projectId: PROJECT_ID,
    type: "STICKY",
    content: "Hello",
    x: 10,
    y: 20,
    width: 240,
    height: 180,
    createdBy: "user-1",
    createdAt: OCCURRED_AT,
    updatedAt: OCCURRED_AT,
    lastOperationAt: OCCURRED_AT,
    lastOperationId: EVENT_ID,
};

const tombstone: ElementTombstone = {
    id: ELEMENT_ID,
    projectId: PROJECT_ID,
    deletedAt: OCCURRED_AT,
    lastOperationAt: OCCURRED_AT,
    lastOperationId: EVENT_ID,
};

const metadata = {
    eventId: EVENT_ID,
    projectId: PROJECT_ID,
    occurredAt: OCCURRED_AT,
};

function command(kind: CanvasCommand["kind"]): CanvasCommand {
    switch (kind) {
        case "workspace.element.create":
            return {
                ...metadata,
                kind,
                element: {
                    id: ELEMENT_ID,
                    type: element.type,
                    content: element.content,
                    x: element.x,
                    y: element.y,
                    width: element.width,
                    height: element.height,
                },
            };
        case "workspace.element.update":
            return {
                ...metadata,
                kind,
                elementId: ELEMENT_ID,
                content: "Updated",
            };
        case "workspace.element.move":
            return { ...metadata, kind, elementId: ELEMENT_ID, x: 40, y: 50 };
        case "workspace.element.resize":
            return {
                ...metadata,
                kind,
                elementId: ELEMENT_ID,
                width: 300,
                height: 220,
            };
        case "workspace.element.delete":
            return { ...metadata, kind, elementId: ELEMENT_ID };
    }
}

function applied(record: CanvasMutationResult["record"]): CanvasMutationResult {
    return { applied: true, record };
}

describe("canvas Portal event builders", () => {
    it.each([
        ["workspace.element.create", "workspace.element.created.final"],
        ["workspace.element.update", "workspace.element.updated.final"],
        ["workspace.element.move", "workspace.element.moved.final"],
        ["workspace.element.resize", "workspace.element.resized.final"],
    ] as const)("builds the %s final event", (commandKind, eventKind) => {
        const message = buildFinalCanvasMessage(
            command(commandKind),
            applied(element),
            "user-1",
        );

        expect(message).toMatchObject({
            ephemeral: false,
            senderId: "user-1",
            content: {
                kind: eventKind,
                eventId: EVENT_ID,
                projectId: PROJECT_ID,
                occurredAt: OCCURRED_AT,
                element,
            },
        });
    });

    it("builds the delete final event with a tombstone", () => {
        const message = buildFinalCanvasMessage(
            command("workspace.element.delete"),
            applied(tombstone),
            "user-1",
        );

        expect(message).toMatchObject({
            type: "workspace.element.deleted",
            ephemeral: false,
            content: { kind: "workspace.element.deleted.final", tombstone },
        });
    });

    it("does not build a final event for an unapplied response", () => {
        expect(
            buildFinalCanvasMessage(
                command("workspace.element.move"),
                { applied: false, record: element },
                "user-1",
            ),
        ).toBeUndefined();
    });

    it("builds throttled-preview payload shapes without persistence fields", () => {
        const previewMetadata = { ...metadata, senderId: "user-1" };

        expect(
            buildMovePreviewMessage(
                previewMetadata,
                { x: 40, y: 50 },
                ELEMENT_ID,
            ),
        ).toMatchObject({
            type: "workspace.element.moved",
            ephemeral: true,
            content: {
                kind: "workspace.element.moved.preview",
                elementId: ELEMENT_ID,
                x: 40,
                y: 50,
            },
        });
        expect(
            buildResizePreviewMessage(
                previewMetadata,
                { width: 300, height: 220 },
                ELEMENT_ID,
            ),
        ).toMatchObject({
            type: "workspace.element.resized",
            ephemeral: true,
            content: { kind: "workspace.element.resized.preview" },
        });
        expect(
            buildTextPreviewMessage(previewMetadata, ELEMENT_ID, "Draft"),
        ).toMatchObject({
            type: "workspace.element.updated",
            ephemeral: true,
            content: {
                kind: "workspace.element.updated.preview",
                elementId: ELEMENT_ID,
                content: "Draft",
            },
        });
    });
});
