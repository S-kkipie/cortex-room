import { canvasPortalMessageSchema } from "@/core/canvas/domain/schemas";
import type {
    CanvasCommand,
    CanvasMutationResult,
    CanvasPortalEvent,
    CanvasPortalMessage,
    ElementTombstone,
    WorkspaceElement,
} from "@/core/canvas/domain/types";

export type CanvasRealtimePort = {
    publishPersistent(message: CanvasPortalMessage): Promise<void>;
    publishEphemeral(message: CanvasPortalMessage): Promise<void>;
};

type EventMetadata = Pick<
    CanvasPortalEvent,
    "eventId" | "projectId" | "occurredAt"
>;

type PreviewMetadata = EventMetadata & {
    senderId: string;
};

function finalMessage(
    type: CanvasPortalMessage["type"],
    senderId: string,
    content: Record<string, unknown>,
): CanvasPortalMessage {
    return canvasPortalMessageSchema.parse({
        type,
        ephemeral: false,
        senderId,
        content,
    });
}

function previewMessage(
    type: CanvasPortalMessage["type"],
    metadata: PreviewMetadata,
    content: Record<string, unknown>,
): CanvasPortalMessage {
    const { senderId, ...eventMetadata } = metadata;
    return canvasPortalMessageSchema.parse({
        type,
        ephemeral: true,
        senderId,
        content: {
            ...eventMetadata,
            ...content,
        },
    });
}

function activeRecord(
    record: CanvasMutationResult["record"],
): WorkspaceElement | undefined {
    return "deletedAt" in record ? undefined : record;
}

function deletedRecord(
    record: CanvasMutationResult["record"],
): ElementTombstone | undefined {
    return "deletedAt" in record ? record : undefined;
}

export function buildFinalCanvasMessage(
    command: CanvasCommand,
    result: CanvasMutationResult,
    senderId: string,
): CanvasPortalMessage | undefined {
    if (!result.applied) return undefined;

    const record = result.record;
    const metadata: EventMetadata = {
        eventId: record.lastOperationId,
        projectId: record.projectId,
        occurredAt: record.lastOperationAt,
    };

    switch (command.kind) {
        case "workspace.element.create": {
            const element = activeRecord(record);
            return element
                ? finalMessage("workspace.element.created", senderId, {
                      ...metadata,
                      kind: "workspace.element.created.final",
                      element,
                  })
                : undefined;
        }
        case "workspace.element.update": {
            const element = activeRecord(record);
            return element
                ? finalMessage("workspace.element.updated", senderId, {
                      ...metadata,
                      kind: "workspace.element.updated.final",
                      element,
                  })
                : undefined;
        }
        case "workspace.element.move": {
            const element = activeRecord(record);
            return element
                ? finalMessage("workspace.element.moved", senderId, {
                      ...metadata,
                      kind: "workspace.element.moved.final",
                      element,
                  })
                : undefined;
        }
        case "workspace.element.resize": {
            const element = activeRecord(record);
            return element
                ? finalMessage("workspace.element.resized", senderId, {
                      ...metadata,
                      kind: "workspace.element.resized.final",
                      element,
                  })
                : undefined;
        }
        case "workspace.element.delete": {
            const tombstone = deletedRecord(record);
            return tombstone
                ? finalMessage("workspace.element.deleted", senderId, {
                      ...metadata,
                      kind: "workspace.element.deleted.final",
                      tombstone,
                  })
                : undefined;
        }
    }
}

export function buildMovePreviewMessage(
    metadata: PreviewMetadata,
    position: { x: number; y: number },
    elementId: string,
): CanvasPortalMessage {
    return previewMessage("workspace.element.moved", metadata, {
        kind: "workspace.element.moved.preview",
        elementId,
        ...position,
    });
}

export function buildResizePreviewMessage(
    metadata: PreviewMetadata,
    dimensions: { width: number; height: number },
    elementId: string,
): CanvasPortalMessage {
    return previewMessage("workspace.element.resized", metadata, {
        kind: "workspace.element.resized.preview",
        elementId,
        ...dimensions,
    });
}

export function buildTextPreviewMessage(
    metadata: PreviewMetadata,
    elementId: string,
    content: string,
): CanvasPortalMessage {
    return previewMessage("workspace.element.updated", metadata, {
        kind: "workspace.element.updated.preview",
        elementId,
        content,
    });
}
