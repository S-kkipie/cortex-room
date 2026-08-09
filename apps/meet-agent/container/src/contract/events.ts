import { z } from "zod";

export const participantSchema = z.object({
    participantId: z.string(),
    displayName: z.string().optional(),
});
export type Participant = z.infer<typeof participantSchema>;

export const speakerRefSchema = z.union([
    participantSchema,
    z.object({ kind: z.literal("unresolved"), diarizedLabel: z.string().optional() }),
]);
export type SpeakerRef = z.infer<typeof speakerRefSchema>;

export const identityConfidenceSchema = z.enum(["resolved", "inferred", "unresolved"]);
export type IdentityConfidence = z.infer<typeof identityConfidenceSchema>;

export const transcriptSegmentSchema = z.object({
    segmentId: z.string(),
    meetingId: z.string(),
    speaker: speakerRefSchema,
    text: z.string(),
    startedAt: z.string(),
    endedAt: z.string(),
    isFinal: z.boolean(),
    transcriptionConfidence: z.number().optional(),
    identityConfidence: identityConfidenceSchema,
    gap: z.boolean().optional(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const agentEventSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("session.started"), meetingId: z.string(), at: z.string(), resumed: z.boolean().optional() }),
    z.object({ type: z.literal("session.ended"), meetingId: z.string(), at: z.string(), reason: z.string() }),
    z.object({ type: z.literal("participant.joined"), participant: participantSchema, at: z.string() }),
    z.object({ type: z.literal("participant.left"), participantId: z.string(), at: z.string() }),
    z.object({ type: z.literal("transcript.segment"), segment: transcriptSegmentSchema }),
    z.object({ type: z.literal("speaker.active"), participantId: z.string(), active: z.boolean(), at: z.string() }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
