import type { IdentityConfidence } from "../contract/events";

export type Interval = { start: number; end: number };
export type ActiveSpeakerInterval = Interval & { participantId: string; displayName?: string };

type Resolved = {
    speaker: { participantId: string; displayName?: string } | { kind: "unresolved"; diarizedLabel?: string };
    identityConfidence: IdentityConfidence;
};

const overlapMs = (a: Interval, b: Interval): number =>
    Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

export function resolveSpeaker(
    utterance: Interval,
    active: ActiveSpeakerInterval[],
    diarizedLabel?: string,
): Resolved {
    const dur = Math.max(1, utterance.end - utterance.start);

    const perSpeaker = new Map<string, { ms: number; displayName?: string }>();
    for (const a of active) {
        const ms = overlapMs(utterance, a);
        if (ms <= 0) continue;

        const cur = perSpeaker.get(a.participantId) ?? { ms: 0, displayName: a.displayName };
        cur.ms += ms;
        perSpeaker.set(a.participantId, cur);
    }

    let best: { participantId: string; ms: number; displayName?: string } | undefined;
    for (const [participantId, v] of perSpeaker) {
        if (!best || v.ms > best.ms) {
            best = { participantId, ms: v.ms, displayName: v.displayName };
        }
    }

    if (best && best.ms / dur >= 0.6) {
        return {
            speaker: { participantId: best.participantId, displayName: best.displayName },
            identityConfidence: "inferred",
        };
    }

    return { speaker: { kind: "unresolved", diarizedLabel }, identityConfidence: "unresolved" };
}
