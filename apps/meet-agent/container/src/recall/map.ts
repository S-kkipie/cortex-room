import type { AgentEvent, Participant, SpeakerRef } from "../contract/events";

type RecallParticipant = { id: number | string; name?: string | null; email?: string | null } | null | undefined;

export type MapCtx = { meetingId: string; t0Ms: number; genId: () => string };

function toParticipant(p: RecallParticipant): Participant | null {
    if (!p || p.id === undefined || p.id === null) return null;
    const participantId = String(p.id);
    return p.name != null ? { participantId, displayName: p.name } : { participantId };
}

function iso(t0Ms: number, relativeSeconds: number): string {
    return new Date(t0Ms + relativeSeconds * 1000).toISOString();
}

export function mapRecallEvent(payload: unknown, ctx: MapCtx): AgentEvent[] {
    const p = payload as { event?: string; data?: { data?: Record<string, unknown> } };
    const event = p?.event;
    const inner = p?.data?.data ?? {};

    switch (event) {
        case "transcript.data": {
            const words = Array.isArray(inner.words) ? (inner.words as Array<Record<string, unknown>>) : [];
            const text = words
                .map((w) => (typeof w.text === "string" ? w.text : ""))
                .join(" ")
                .trim();
            if (!text) return [];
            const participant = toParticipant(inner.participant as RecallParticipant);
            const speaker: SpeakerRef = participant ?? { kind: "unresolved" };
            const rel = (w: Record<string, unknown> | undefined, key: string): number => {
                const stamp = w?.[key] as { relative?: number } | undefined;
                return typeof stamp?.relative === "number" ? stamp.relative : 0;
            };
            const start = rel(words[0], "start_timestamp");
            const end = rel(words[words.length - 1], "end_timestamp") || start;
            return [
                {
                    type: "transcript.segment",
                    segment: {
                        segmentId: ctx.genId(),
                        meetingId: ctx.meetingId,
                        speaker,
                        text,
                        startedAt: iso(ctx.t0Ms, start),
                        endedAt: iso(ctx.t0Ms, end),
                        isFinal: true,
                        identityConfidence: participant ? "resolved" : "unresolved",
                    },
                },
            ];
        }
        case "participant_events.join":
        case "participant_events.update": {
            const participant = toParticipant(inner.participant as RecallParticipant);
            if (!participant) return [];
            const at = (inner.timestamp as { absolute?: string })?.absolute ?? new Date(ctx.t0Ms).toISOString();
            return [{ type: "participant.joined", participant, at }];
        }
        case "participant_events.leave": {
            const participant = toParticipant(inner.participant as RecallParticipant);
            if (!participant) return [];
            const at = (inner.timestamp as { absolute?: string })?.absolute ?? new Date(ctx.t0Ms).toISOString();
            return [{ type: "participant.left", participantId: participant.participantId, at }];
        }
        case "participant_events.speech_on":
        case "participant_events.speech_off": {
            const participant = toParticipant(inner.participant as RecallParticipant);
            if (!participant) return [];
            const at = (inner.timestamp as { absolute?: string })?.absolute ?? new Date(ctx.t0Ms).toISOString();
            return [{ type: "speaker.active", participantId: participant.participantId, active: event === "participant_events.speech_on", at }];
        }
        default:
            return [];
    }
}
