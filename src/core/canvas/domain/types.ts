import type { z } from "zod";
import type {
    canvasCommandSchema,
    canvasMutationResultSchema,
    canvasPortalEventSchema,
    canvasPortalMessageSchema,
    canvasSnapshotSchema,
    createElementCommandSchema,
    cursorPositionSchema,
    deleteElementCommandSchema,
    elementTombstoneSchema,
    moveElementCommandSchema,
    operationVersionSchema,
    participantElementPreviewSchema,
    participantPresenceMetadataSchema,
    portalMessageTypeSchema,
    portalTokenEnvelopeSchema,
    portalTokenResponseSchema,
    resizeElementCommandSchema,
    updateElementCommandSchema,
    wireTimestampSchema,
    workspaceElementSchema,
    workspaceElementTypeSchema,
} from "./schemas";

export type WorkspaceElementType = z.infer<typeof workspaceElementTypeSchema>;
export type WireTimestamp = z.infer<typeof wireTimestampSchema>;
export type OperationVersion = z.infer<typeof operationVersionSchema>;
export type WorkspaceElement = z.infer<typeof workspaceElementSchema>;
export type ElementTombstone = z.infer<typeof elementTombstoneSchema>;
export type CanvasSnapshot = z.infer<typeof canvasSnapshotSchema>;
export type CreateElementCommand = z.infer<typeof createElementCommandSchema>;
export type UpdateElementCommand = z.infer<typeof updateElementCommandSchema>;
export type MoveElementCommand = z.infer<typeof moveElementCommandSchema>;
export type ResizeElementCommand = z.infer<typeof resizeElementCommandSchema>;
export type DeleteElementCommand = z.infer<typeof deleteElementCommandSchema>;
export type CanvasCommand = z.infer<typeof canvasCommandSchema>;
export type CanvasMutationResult = z.infer<typeof canvasMutationResultSchema>;
export type CursorPosition = z.infer<typeof cursorPositionSchema>;
export type ParticipantPresenceMetadata = z.infer<
    typeof participantPresenceMetadataSchema
>;
export type ParticipantElementPreview = z.infer<
    typeof participantElementPreviewSchema
>;
export type PortalTokenResponse = z.infer<typeof portalTokenResponseSchema>;
export type PortalTokenEnvelope = z.infer<typeof portalTokenEnvelopeSchema>;
export type CanvasPortalEvent = z.infer<typeof canvasPortalEventSchema>;
export type PortalMessageType = z.infer<typeof portalMessageTypeSchema>;
export type CanvasPortalMessage = z.infer<typeof canvasPortalMessageSchema>;
