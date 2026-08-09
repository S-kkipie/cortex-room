import type { AggregatePresence, DetailedPresence } from "@portalsdk/react";
import { participantPresenceMetadataSchema } from "@/core/canvas/domain/schemas";
import type {
    CanvasPortalMessage,
    CursorPosition,
} from "@/core/canvas/domain/types";

export type CanvasRemoteParticipant = {
    id: string;
    label: string;
    cursor?: CursorPosition;
    selectedElementIds: readonly string[];
};

export type CanvasAwarenessSnapshot = {
    onlineCount: number;
    participants: readonly CanvasRemoteParticipant[];
    cursors: ReadonlyMap<string, CursorPosition>;
    selections: ReadonlyMap<string, readonly string[]>;
};

type DetailedCanvasPresence = DetailedPresence;
type AggregateCanvasPresence = AggregatePresence;

function participantLabel(
    participant: DetailedCanvasPresence["participants"][number],
) {
    const username = participant.username?.trim();
    if (username) return username;
    if (participant.anon) return "Guest";
    return `Collaborator ${participant.id.slice(0, 6)}`;
}

function detailedAwareness(
    presence: DetailedCanvasPresence,
    messages: readonly CanvasPortalMessage[],
    projectId: string,
    selfId: string | undefined,
): CanvasAwarenessSnapshot {
    const participants = new Map<string, CanvasRemoteParticipant>();
    const cursors = new Map<string, CursorPosition>();
    const selections = new Map<string, readonly string[]>();

    for (const participant of presence.participants) {
        if (participant.id === selfId) continue;

        const metadata = participantPresenceMetadataSchema.safeParse(
            participant.metadata ?? {},
        );
        const participantState: CanvasRemoteParticipant = {
            id: participant.id,
            label: participantLabel(participant),
            selectedElementIds: metadata.success
                ? metadata.data.selectedElementIds
                : [],
        };
        participants.set(participant.id, participantState);

        if (metadata.success && metadata.data.cursor) {
            cursors.set(participant.id, metadata.data.cursor);
        }
        if (metadata.success) {
            selections.set(participant.id, metadata.data.selectedElementIds);
        }
    }

    for (const message of messages) {
        if (
            message.content.projectId !== projectId ||
            message.senderId === selfId ||
            !participants.has(message.senderId)
        ) {
            continue;
        }

        if (message.content.kind === "participant.cursor.moved") {
            cursors.set(message.senderId, message.content.cursor);
        }
        if (message.content.kind === "participant.selection.changed") {
            selections.set(message.senderId, message.content.elementIds);
        }
    }

    const remoteParticipants = [...participants.values()].map(
        (participant) => ({
            ...participant,
            cursor: cursors.get(participant.id),
            selectedElementIds: selections.get(participant.id) ?? [],
        }),
    );

    return {
        onlineCount: remoteParticipants.length,
        participants: remoteParticipants,
        cursors,
        selections,
    };
}

export function normalizeCanvasAwareness(
    presence: DetailedCanvasPresence | AggregateCanvasPresence | undefined,
    messages: readonly CanvasPortalMessage[],
    projectId: string,
    selfId?: string,
): CanvasAwarenessSnapshot {
    if (!presence || presence.kind === "aggregate") {
        return {
            onlineCount: presence
                ? Math.max(0, presence.count - (selfId ? 1 : 0))
                : 0,
            participants: [],
            cursors: new Map(),
            selections: new Map(),
        };
    }

    return detailedAwareness(presence, messages, projectId, selfId);
}
