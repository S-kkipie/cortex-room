import { nanoid } from "nanoid";
import type { TranscriptSegment } from "../contract/events";
import { type ActiveSpeakerInterval, resolveSpeaker } from "../identity/correlator";
import type { Utterance } from "../stt/assemblyai";

const GAP_MS = 8000;

export class SegmentReducer {
    private currentId: string | null = null;
    private lastEmittedEnd: number | null = null;

    constructor(
        private readonly meetingId: string,
        private readonly idGen: () => string = () => nanoid(),
    ) {}

    push(u: Utterance, active: ActiveSpeakerInterval[]): TranscriptSegment {
        if (this.currentId === null) this.currentId = this.idGen();
        const segmentId = this.currentId;

        const { speaker, identityConfidence } = resolveSpeaker(
            { start: u.start, end: u.end },
            active,
            u.diarizedLabel,
        );

        const gap = this.lastEmittedEnd !== null && u.start - this.lastEmittedEnd > GAP_MS;

        const seg: TranscriptSegment = {
            segmentId,
            meetingId: this.meetingId,
            speaker,
            text: u.text,
            startedAt: new Date(u.start).toISOString(),
            endedAt: new Date(u.end).toISOString(),
            isFinal: u.isFinal,
            transcriptionConfidence: u.confidence,
            identityConfidence,
            ...(gap ? { gap: true } : {}),
        };

        if (u.isFinal) {
            this.currentId = null;
            this.lastEmittedEnd = u.end;
        }
        return seg;
    }
}
