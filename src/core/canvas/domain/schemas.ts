import { z } from "zod";

export const MAX_ELEMENT_CONTENT_LENGTH = 20_000;
export const ELEMENT_PREVIEW_THROTTLE_MS = 50;
export const CURSOR_THROTTLE_MS = 50;
export const PRESENCE_METADATA_THROTTLE_MS = 50;
export const TEXT_PREVIEW_DEBOUNCE_MS = 100;
export const TEXT_COMMIT_IDLE_MS = 500;

export const wireTimestampSchema = z.iso.datetime({ precision: 3 });

export const workspaceElementTypeSchema = z.enum([
    "STICKY",
    "TEXT",
    "CARD",
    "HEADING",
]);

export const operationVersionSchema = z.strictObject({
    lastOperationAt: wireTimestampSchema,
    lastOperationId: z.uuid(),
});

export const workspaceElementSchema = z.strictObject({
    id: z.uuid(),
    projectId: z.uuid(),
    type: workspaceElementTypeSchema,
    content: z.string().max(MAX_ELEMENT_CONTENT_LENGTH),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    createdBy: z.string().min(1),
    createdAt: wireTimestampSchema,
    updatedAt: wireTimestampSchema,
    lastOperationAt: wireTimestampSchema,
    lastOperationId: z.uuid(),
});

export const elementTombstoneSchema = z.strictObject({
    id: z.uuid(),
    projectId: z.uuid(),
    deletedAt: wireTimestampSchema,
    lastOperationAt: wireTimestampSchema,
    lastOperationId: z.uuid(),
});

export const canvasSnapshotSchema = z
    .strictObject({
        projectId: z.uuid(),
        elements: z.array(workspaceElementSchema),
        tombstones: z.array(elementTombstoneSchema),
    })
    .superRefine((snapshot, context) => {
        const ids = new Set<string>();

        for (const [index, record] of snapshot.elements.entries()) {
            if (record.projectId !== snapshot.projectId) {
                context.addIssue({
                    code: "custom",
                    message: "Element belongs to a different project",
                    path: ["elements", index, "projectId"],
                });
            }
            if (ids.has(record.id)) {
                context.addIssue({
                    code: "custom",
                    message: "Duplicate canvas record id",
                    path: ["elements", index, "id"],
                });
            }
            ids.add(record.id);
        }

        for (const [index, record] of snapshot.tombstones.entries()) {
            if (record.projectId !== snapshot.projectId) {
                context.addIssue({
                    code: "custom",
                    message: "Tombstone belongs to a different project",
                    path: ["tombstones", index, "projectId"],
                });
            }
            if (ids.has(record.id)) {
                context.addIssue({
                    code: "custom",
                    message: "Duplicate canvas record id",
                    path: ["tombstones", index, "id"],
                });
            }
            ids.add(record.id);
        }
    });

const commandMetadataSchema = z.strictObject({
    eventId: z.uuid(),
    projectId: z.uuid(),
    occurredAt: wireTimestampSchema,
});

export const createElementCommandSchema = commandMetadataSchema.extend({
    kind: z.literal("workspace.element.create"),
    element: z.strictObject({
        id: z.uuid(),
        type: workspaceElementTypeSchema,
        content: z.string().max(MAX_ELEMENT_CONTENT_LENGTH),
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().positive(),
        height: z.number().finite().positive(),
    }),
});

export const updateElementCommandSchema = commandMetadataSchema.extend({
    kind: z.literal("workspace.element.update"),
    elementId: z.uuid(),
    content: z.string().max(MAX_ELEMENT_CONTENT_LENGTH),
});

export const moveElementCommandSchema = commandMetadataSchema.extend({
    kind: z.literal("workspace.element.move"),
    elementId: z.uuid(),
    x: z.number().finite(),
    y: z.number().finite(),
});

export const resizeElementCommandSchema = commandMetadataSchema.extend({
    kind: z.literal("workspace.element.resize"),
    elementId: z.uuid(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
});

export const deleteElementCommandSchema = commandMetadataSchema.extend({
    kind: z.literal("workspace.element.delete"),
    elementId: z.uuid(),
});

export const canvasCommandSchema = z.discriminatedUnion("kind", [
    createElementCommandSchema,
    updateElementCommandSchema,
    moveElementCommandSchema,
    resizeElementCommandSchema,
    deleteElementCommandSchema,
]);

const authoritativeCanvasRecordSchema = z.union([
    workspaceElementSchema,
    elementTombstoneSchema,
]);

export const canvasMutationResultSchema = z.discriminatedUnion("applied", [
    z.strictObject({
        applied: z.literal(true),
        record: authoritativeCanvasRecordSchema,
    }),
    z.strictObject({
        applied: z.literal(false),
        record: authoritativeCanvasRecordSchema,
    }),
]);

const portalEventMetadataSchema = z.strictObject({
    eventId: z.uuid(),
    projectId: z.uuid(),
    occurredAt: wireTimestampSchema,
});

export const createdFinalEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.created.final"),
    element: workspaceElementSchema,
});

export const updatedPreviewEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.updated.preview"),
    elementId: z.uuid(),
    content: z.string().max(MAX_ELEMENT_CONTENT_LENGTH),
});

export const updatedFinalEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.updated.final"),
    element: workspaceElementSchema,
});

export const movedPreviewEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.moved.preview"),
    elementId: z.uuid(),
    x: z.number().finite(),
    y: z.number().finite(),
});

export const movedFinalEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.moved.final"),
    element: workspaceElementSchema,
});

export const resizedPreviewEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.resized.preview"),
    elementId: z.uuid(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
});

export const resizedFinalEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.resized.final"),
    element: workspaceElementSchema,
});

export const deletedFinalEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.deleted.final"),
    tombstone: elementTombstoneSchema,
});

export const cursorPositionSchema = z.strictObject({
    x: z.number().finite(),
    y: z.number().finite(),
});

export const participantElementPreviewSchema = z.discriminatedUnion("kind", [
    z.strictObject({
        kind: z.literal("move"),
        elementId: z.uuid(),
        x: z.number().finite(),
        y: z.number().finite(),
    }),
    z.strictObject({
        kind: z.literal("resize"),
        elementId: z.uuid(),
        width: z.number().finite().positive(),
        height: z.number().finite().positive(),
    }),
    z.strictObject({
        kind: z.literal("text"),
        elementId: z.uuid(),
        content: z.string().max(MAX_ELEMENT_CONTENT_LENGTH),
    }),
]);

export const cursorMovedEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("participant.cursor.moved"),
    cursor: cursorPositionSchema,
});

export const selectionChangedEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("participant.selection.changed"),
    elementIds: z.array(z.uuid()),
});

export const participantPresenceMetadataSchema = z.strictObject({
    cursor: cursorPositionSchema.optional(),
    selectedElementIds: z.array(z.uuid()).default([]),
    preview: participantElementPreviewSchema.optional(),
});

export const portalTokenResponseSchema = z.strictObject({
    token: z.string().min(1),
    channelId: z.string().min(1),
    expiresAt: z.iso.datetime(),
});

export const portalTokenEnvelopeSchema = z.strictObject({
    response: portalTokenResponseSchema,
    code: z.literal("OK"),
    status: z.literal(200),
});

export const canvasPortalEventSchema = z
    .discriminatedUnion("kind", [
        createdFinalEventSchema,
        updatedPreviewEventSchema,
        updatedFinalEventSchema,
        movedPreviewEventSchema,
        movedFinalEventSchema,
        resizedPreviewEventSchema,
        resizedFinalEventSchema,
        deletedFinalEventSchema,
        cursorMovedEventSchema,
        selectionChangedEventSchema,
    ])
    .superRefine((event, context) => {
        const record =
            "element" in event
                ? event.element
                : "tombstone" in event
                  ? event.tombstone
                  : undefined;

        if (!record) return;

        if (event.eventId !== record.lastOperationId) {
            context.addIssue({
                code: "custom",
                message: "Event id does not match the record operation id",
                path: ["eventId"],
            });
        }
        if (event.occurredAt !== record.lastOperationAt) {
            context.addIssue({
                code: "custom",
                message:
                    "Event timestamp does not match the record operation timestamp",
                path: ["occurredAt"],
            });
        }
        if (event.projectId !== record.projectId) {
            context.addIssue({
                code: "custom",
                message: "Event and record belong to different projects",
                path: ["projectId"],
            });
        }
    });

export const PORTAL_EVENT_RULES = {
    "workspace.element.created.final": {
        type: "workspace.element.created",
        ephemeral: false,
    },
    "workspace.element.updated.preview": {
        type: "workspace.element.updated",
        ephemeral: true,
    },
    "workspace.element.updated.final": {
        type: "workspace.element.updated",
        ephemeral: false,
    },
    "workspace.element.moved.preview": {
        type: "workspace.element.moved",
        ephemeral: true,
    },
    "workspace.element.moved.final": {
        type: "workspace.element.moved",
        ephemeral: false,
    },
    "workspace.element.resized.preview": {
        type: "workspace.element.resized",
        ephemeral: true,
    },
    "workspace.element.resized.final": {
        type: "workspace.element.resized",
        ephemeral: false,
    },
    "workspace.element.deleted.final": {
        type: "workspace.element.deleted",
        ephemeral: false,
    },
    "participant.cursor.moved": {
        type: "participant.cursor.moved",
        ephemeral: true,
    },
    "participant.selection.changed": {
        type: "participant.selection.changed",
        ephemeral: true,
    },
} as const;

export const portalMessageTypeSchema = z.enum([
    "workspace.element.created",
    "workspace.element.updated",
    "workspace.element.moved",
    "workspace.element.resized",
    "workspace.element.deleted",
    "participant.cursor.moved",
    "participant.selection.changed",
]);

export const canvasPortalMessageSchema = z
    .strictObject({
        type: portalMessageTypeSchema,
        ephemeral: z.boolean(),
        senderId: z.string().min(1),
        content: canvasPortalEventSchema,
    })
    .superRefine((message, context) => {
        const rule = PORTAL_EVENT_RULES[message.content.kind];

        if (message.type !== rule.type) {
            context.addIssue({
                code: "custom",
                message: "Portal message type does not match its content kind",
                path: ["type"],
            });
        }
        if (message.ephemeral !== rule.ephemeral) {
            context.addIssue({
                code: "custom",
                message: "Portal message mode does not match its content kind",
                path: ["ephemeral"],
            });
        }
    });
