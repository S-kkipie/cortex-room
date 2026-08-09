import type { TranscriptSegment } from "../contract/events";

export const FLUSH_COUNT = 8;
export const FLUSH_MS = 30_000;

function speakerName(seg: TranscriptSegment): string {
    if ("displayName" in seg.speaker && seg.speaker.displayName) {
        return seg.speaker.displayName;
    }

    if ("kind" in seg.speaker && seg.speaker.kind === "unresolved" && seg.speaker.diarizedLabel) {
        return seg.speaker.diarizedLabel;
    }

    return "Unknown";
}

export class BridgeBuffer {
    private lines: string[] = [];
    private lastFlushMs: number;

    constructor(startMs: number) {
        this.lastFlushMs = startMs;
    }

    append(seg: TranscriptSegment): void {
        if (!seg.isFinal) return;
        this.lines.push(`${speakerName(seg)}: ${seg.text}`);
    }

    shouldFlush(nowMs: number): boolean {
        if (this.lines.length === 0) return false;
        return this.lines.length >= FLUSH_COUNT || nowMs - this.lastFlushMs >= FLUSH_MS;
    }

    drain(nowMs: number): { text: string } {
        const text = this.lines.join("\n");
        this.lines = [];
        this.lastFlushMs = nowMs;
        return { text };
    }
}
