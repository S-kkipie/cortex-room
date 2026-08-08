import { describe, expect, it } from "vitest";
import {
    canvasCommandSchema,
    canvasMutationResultSchema,
    canvasPortalEventSchema,
    canvasPortalMessageSchema,
    canvasSnapshotSchema,
    createElementCommandSchema,
    cursorPositionSchema,
    deleteElementCommandSchema,
    elementTombstoneSchema,
    MAX_ELEMENT_CONTENT_LENGTH,
    moveElementCommandSchema,
    operationVersionSchema,
    PORTAL_EVENT_RULES,
    participantPresenceMetadataSchema,
    resizeElementCommandSchema,
    updateElementCommandSchema,
    wireTimestampSchema,
    workspaceElementSchema,
    workspaceElementTypeSchema,
} from "../schemas";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const ELEMENT_ID = "00000000-0000-4000-8000-000000000003";
const OTHER_ELEMENT_ID = "00000000-0000-4000-8000-000000000004";
const EVENT_ID = "00000000-0000-4000-8000-000000000005";
const OTHER_EVENT_ID = "00000000-0000-4000-8000-000000000006";
const OCCURRED_AT = "2026-08-08T12:00:00.000Z";
const LATER_AT = "2026-08-08T12:00:01.000Z";

const element = {
    id: ELEMENT_ID,
    projectId: PROJECT_ID,
    type: "STICKY" as const,
    content: "Reduce onboarding to 3 steps",
    x: 500,
    y: 300,
    width: 240,
    height: 160,
    createdBy: "user-1",
    createdAt: OCCURRED_AT,
    updatedAt: OCCURRED_AT,
    lastOperationAt: OCCURRED_AT,
    lastOperationId: EVENT_ID,
};

const tombstone = {
    id: ELEMENT_ID,
    projectId: PROJECT_ID,
    deletedAt: OCCURRED_AT,
    lastOperationAt: OCCURRED_AT,
    lastOperationId: EVENT_ID,
};

const commandMetadata = {
    eventId: EVENT_ID,
    projectId: PROJECT_ID,
    occurredAt: OCCURRED_AT,
};

describe("workspace element contracts", () => {
    it.each([
        "STICKY",
        "TEXT",
        "CARD",
        "HEADING",
    ])("accepts the %s element type", (type) => {
        expect(workspaceElementTypeSchema.parse(type)).toBe(type);
    });

    it("rejects an unknown element type", () => {
        expect(workspaceElementTypeSchema.safeParse("SHAPE").success).toBe(
            false,
        );
    });

    it("accepts a complete persisted element", () => {
        expect(workspaceElementSchema.parse(element)).toEqual(element);
    });

    it.each([
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
    ])("rejects the non-finite coordinate %s", (x) => {
        expect(
            workspaceElementSchema.safeParse({ ...element, x }).success,
        ).toBe(false);
    });

    it.each([
        0,
        -1,
        Number.POSITIVE_INFINITY,
    ])("rejects the invalid dimension %s", (width) => {
        expect(
            workspaceElementSchema.safeParse({ ...element, width }).success,
        ).toBe(false);
    });

    it("rejects content over the wire limit", () => {
        expect(
            workspaceElementSchema.safeParse({
                ...element,
                content: "x".repeat(MAX_ELEMENT_CONTENT_LENGTH + 1),
            }).success,
        ).toBe(false);
    });

    it("rejects unknown fields", () => {
        expect(
            workspaceElementSchema.safeParse({ ...element, unexpected: true })
                .success,
        ).toBe(false);
    });
});

describe("wire timestamps", () => {
    it("accepts UTC timestamps with millisecond precision", () => {
        expect(wireTimestampSchema.parse(OCCURRED_AT)).toBe(OCCURRED_AT);
    });

    it.each([
        "2026-08-08T12:00:00",
        "2026-08-08T12:00:00.000+00:00",
        "2026-08-08T12:00:00.00Z",
        "2026-08-08T12:00:00.0000Z",
    ])("rejects the non-canonical timestamp %s", (timestamp) => {
        expect(wireTimestampSchema.safeParse(timestamp).success).toBe(false);
    });
});

describe("operation versions", () => {
    it("accepts a strict LWW tuple", () => {
        const version = {
            lastOperationAt: OCCURRED_AT,
            lastOperationId: EVENT_ID,
        };

        expect(operationVersionSchema.parse(version)).toEqual(version);
    });

    it("rejects invalid or extended LWW tuples", () => {
        expect(
            operationVersionSchema.safeParse({
                lastOperationAt: "not-a-timestamp",
                lastOperationId: EVENT_ID,
            }).success,
        ).toBe(false);
        expect(
            operationVersionSchema.safeParse({
                lastOperationAt: OCCURRED_AT,
                lastOperationId: EVENT_ID,
                actorId: "spoofed-user",
            }).success,
        ).toBe(false);
    });
});

describe("snapshot contracts", () => {
    it("accepts a tombstone", () => {
        expect(elementTombstoneSchema.parse(tombstone)).toEqual(tombstone);
    });

    it("accepts active elements and tombstones from one project", () => {
        const otherTombstone = {
            ...tombstone,
            id: OTHER_ELEMENT_ID,
        };
        const snapshot = {
            projectId: PROJECT_ID,
            elements: [element],
            tombstones: [otherTombstone],
        };

        expect(canvasSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    });

    it("rejects a record from another project", () => {
        expect(
            canvasSnapshotSchema.safeParse({
                projectId: PROJECT_ID,
                elements: [{ ...element, projectId: OTHER_PROJECT_ID }],
                tombstones: [],
            }).success,
        ).toBe(false);
    });

    it("rejects duplicate active element ids", () => {
        expect(
            canvasSnapshotSchema.safeParse({
                projectId: PROJECT_ID,
                elements: [element, { ...element }],
                tombstones: [],
            }).success,
        ).toBe(false);
    });

    it("rejects an id that is both active and deleted", () => {
        expect(
            canvasSnapshotSchema.safeParse({
                projectId: PROJECT_ID,
                elements: [element],
                tombstones: [tombstone],
            }).success,
        ).toBe(false);
    });

    it("rejects a tombstone from another project", () => {
        expect(
            canvasSnapshotSchema.safeParse({
                projectId: PROJECT_ID,
                elements: [],
                tombstones: [{ ...tombstone, projectId: OTHER_PROJECT_ID }],
            }).success,
        ).toBe(false);
    });

    it("rejects duplicate tombstone ids", () => {
        expect(
            canvasSnapshotSchema.safeParse({
                projectId: PROJECT_ID,
                elements: [],
                tombstones: [tombstone, { ...tombstone }],
            }).success,
        ).toBe(false);
    });
});

describe("canvas commands", () => {
    const commands = [
        {
            ...commandMetadata,
            kind: "workspace.element.create",
            element: {
                id: ELEMENT_ID,
                type: "STICKY",
                content: "New sticky",
                x: 10,
                y: 20,
                width: 240,
                height: 160,
            },
            schema: createElementCommandSchema,
        },
        {
            ...commandMetadata,
            kind: "workspace.element.update",
            elementId: ELEMENT_ID,
            content: "Updated sticky",
            schema: updateElementCommandSchema,
        },
        {
            ...commandMetadata,
            kind: "workspace.element.move",
            elementId: ELEMENT_ID,
            x: 40,
            y: 50,
            schema: moveElementCommandSchema,
        },
        {
            ...commandMetadata,
            kind: "workspace.element.resize",
            elementId: ELEMENT_ID,
            width: 300,
            height: 200,
            schema: resizeElementCommandSchema,
        },
        {
            ...commandMetadata,
            kind: "workspace.element.delete",
            elementId: ELEMENT_ID,
            schema: deleteElementCommandSchema,
        },
    ];

    it.each(commands)("accepts the $kind command", ({ schema, ...command }) => {
        expect(schema.parse(command)).toEqual(command);
        expect(canvasCommandSchema.parse(command)).toEqual(command);
    });

    it("rejects server-controlled and actor fields", () => {
        expect(
            createElementCommandSchema.safeParse({
                ...commandMetadata,
                kind: "workspace.element.create",
                actorId: "spoofed-user",
                createdBy: "spoofed-user",
                createdAt: OCCURRED_AT,
                updatedAt: OCCURRED_AT,
                element: {
                    id: ELEMENT_ID,
                    type: "STICKY",
                    content: "New sticky",
                    x: 10,
                    y: 20,
                    width: 240,
                    height: 160,
                },
            }).success,
        ).toBe(false);
    });

    it("rejects an unknown command kind", () => {
        expect(
            canvasCommandSchema.safeParse({
                ...commandMetadata,
                kind: "workspace.element.rotate",
                elementId: ELEMENT_ID,
            }).success,
        ).toBe(false);
    });
});

describe("mutation results", () => {
    it.each([
        true,
        false,
    ] as const)("accepts applied=%s with an authoritative record", (applied) => {
        expect(
            canvasMutationResultSchema.parse({ applied, record: element }),
        ).toEqual({ applied, record: element });
        expect(
            canvasMutationResultSchema.parse({
                applied,
                record: tombstone,
            }),
        ).toEqual({ applied, record: tombstone });
    });

    it("rejects an invalid authoritative record", () => {
        expect(
            canvasMutationResultSchema.safeParse({
                applied: true,
                record: { id: ELEMENT_ID },
            }).success,
        ).toBe(false);
    });
});

describe("Portal event contracts", () => {
    const events = [
        {
            ...commandMetadata,
            kind: "workspace.element.created.final",
            element,
        },
        {
            ...commandMetadata,
            kind: "workspace.element.updated.preview",
            elementId: ELEMENT_ID,
            content: "Editing",
        },
        {
            ...commandMetadata,
            kind: "workspace.element.updated.final",
            element,
        },
        {
            ...commandMetadata,
            kind: "workspace.element.moved.preview",
            elementId: ELEMENT_ID,
            x: 20,
            y: 30,
        },
        {
            ...commandMetadata,
            kind: "workspace.element.moved.final",
            element,
        },
        {
            ...commandMetadata,
            kind: "workspace.element.resized.preview",
            elementId: ELEMENT_ID,
            width: 280,
            height: 180,
        },
        {
            ...commandMetadata,
            kind: "workspace.element.resized.final",
            element,
        },
        {
            ...commandMetadata,
            kind: "workspace.element.deleted.final",
            tombstone,
        },
        {
            ...commandMetadata,
            kind: "participant.cursor.moved",
            cursor: { x: 20, y: 30 },
        },
        {
            ...commandMetadata,
            kind: "participant.selection.changed",
            elementIds: [ELEMENT_ID],
        },
    ];

    it.each(events)("accepts the $kind event", (event) => {
        expect(canvasPortalEventSchema.parse(event)).toEqual(event);
    });

    it("rejects an unknown event kind", () => {
        expect(
            canvasPortalEventSchema.safeParse({
                ...commandMetadata,
                kind: "workspace.element.rotated.final",
                element,
            }).success,
        ).toBe(false);
    });

    it.each([
        {
            ...commandMetadata,
            eventId: OTHER_EVENT_ID,
            kind: "workspace.element.created.final",
            element,
        },
        {
            ...commandMetadata,
            occurredAt: LATER_AT,
            kind: "workspace.element.updated.final",
            element,
        },
        {
            ...commandMetadata,
            projectId: OTHER_PROJECT_ID,
            kind: "workspace.element.moved.final",
            element,
        },
        {
            ...commandMetadata,
            eventId: OTHER_EVENT_ID,
            kind: "workspace.element.deleted.final",
            tombstone,
        },
    ])("rejects final event metadata that contradicts its record", (event) => {
        expect(canvasPortalEventSchema.safeParse(event).success).toBe(false);
    });

    it("rejects a spoofed actor id", () => {
        expect(
            canvasPortalEventSchema.safeParse({
                ...commandMetadata,
                kind: "participant.cursor.moved",
                actorId: "spoofed-user",
                cursor: { x: 20, y: 30 },
            }).success,
        ).toBe(false);
    });

    it.each([
        {
            ...commandMetadata,
            kind: "workspace.element.updated.preview",
            elementId: ELEMENT_ID,
            content: "x".repeat(MAX_ELEMENT_CONTENT_LENGTH + 1),
        },
        {
            ...commandMetadata,
            kind: "workspace.element.moved.preview",
            elementId: ELEMENT_ID,
            x: Number.POSITIVE_INFINITY,
            y: 30,
        },
        {
            ...commandMetadata,
            kind: "workspace.element.resized.preview",
            elementId: ELEMENT_ID,
            width: 0,
            height: 180,
        },
        {
            ...commandMetadata,
            kind: "participant.cursor.moved",
            cursor: { x: 20, y: Number.NaN },
        },
    ])("rejects the invalid $kind payload", (event) => {
        expect(canvasPortalEventSchema.safeParse(event).success).toBe(false);
    });
});

describe("Portal message envelopes", () => {
    it.each(
        Object.entries(PORTAL_EVENT_RULES),
    )("accepts the coherent %s envelope", (kind, rule) => {
        const content =
            kind === "workspace.element.deleted.final"
                ? { ...commandMetadata, kind, tombstone }
                : kind.endsWith(".final")
                  ? { ...commandMetadata, kind, element }
                  : kind === "workspace.element.updated.preview"
                    ? {
                          ...commandMetadata,
                          kind,
                          elementId: ELEMENT_ID,
                          content: "Editing",
                      }
                    : kind === "workspace.element.moved.preview"
                      ? {
                            ...commandMetadata,
                            kind,
                            elementId: ELEMENT_ID,
                            x: 20,
                            y: 30,
                        }
                      : kind === "workspace.element.resized.preview"
                        ? {
                              ...commandMetadata,
                              kind,
                              elementId: ELEMENT_ID,
                              width: 280,
                              height: 180,
                          }
                        : kind === "participant.cursor.moved"
                          ? {
                                ...commandMetadata,
                                kind,
                                cursor: { x: 20, y: 30 },
                            }
                          : {
                                ...commandMetadata,
                                kind,
                                elementIds: [ELEMENT_ID],
                            };

        expect(
            canvasPortalMessageSchema.safeParse({
                type: rule.type,
                ephemeral: rule.ephemeral,
                senderId: "user-1",
                content,
            }).success,
        ).toBe(true);
    });

    it("rejects a mismatched Portal message type", () => {
        const content = {
            ...commandMetadata,
            kind: "workspace.element.moved.preview",
            elementId: ELEMENT_ID,
            x: 20,
            y: 30,
        };

        expect(
            canvasPortalMessageSchema.safeParse({
                type: "workspace.element.updated",
                ephemeral: true,
                senderId: "user-1",
                content,
            }).success,
        ).toBe(false);
    });

    it("rejects a mismatched Portal message mode", () => {
        const content = {
            ...commandMetadata,
            kind: "workspace.element.moved.preview",
            elementId: ELEMENT_ID,
            x: 20,
            y: 30,
        };

        expect(
            canvasPortalMessageSchema.safeParse({
                type: "workspace.element.moved",
                ephemeral: false,
                senderId: "user-1",
                content,
            }).success,
        ).toBe(false);
    });
});

describe("awareness contracts", () => {
    it("accepts finite cursor coordinates", () => {
        expect(cursorPositionSchema.parse({ x: -10, y: 25 })).toEqual({
            x: -10,
            y: 25,
        });
    });

    it("defaults presence selection to an empty array", () => {
        expect(participantPresenceMetadataSchema.parse({})).toEqual({
            selectedElementIds: [],
        });
    });

    it("rejects unknown presence metadata", () => {
        expect(
            participantPresenceMetadataSchema.safeParse({ actorId: "user-1" })
                .success,
        ).toBe(false);
    });
});
