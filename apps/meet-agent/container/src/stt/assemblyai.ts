export type Utterance = {
    diarizedLabel?: string;
    text: string;
    start: number;
    end: number;
    isFinal: boolean;
    confidence?: number;
};

export function parseAssemblyMessage(raw: string, sessionStartEpochMs: number): Utterance | null {
    let msg: Record<string, unknown>;
    try {
        msg = JSON.parse(raw);
    } catch {
        return null;
    }
    if (msg.type !== "Turn") return null;
    const text = typeof msg.transcript === "string" ? msg.transcript : "";
    if (text.length === 0) return null;
    const words = Array.isArray(msg.words) ? (msg.words as Array<{ speaker?: string }>) : [];
    const diarizedLabel = words.find((w) => typeof w.speaker === "string")?.speaker;
    const audioStart = typeof msg.audio_start === "number" ? msg.audio_start : 0;
    const audioEnd = typeof msg.audio_end === "number" ? msg.audio_end : audioStart;
    return {
        diarizedLabel,
        text,
        start: sessionStartEpochMs + audioStart,
        end: sessionStartEpochMs + audioEnd,
        isFinal: msg.end_of_turn === true,
        confidence: typeof msg.end_of_turn_confidence === "number" ? msg.end_of_turn_confidence : undefined,
    };
}
