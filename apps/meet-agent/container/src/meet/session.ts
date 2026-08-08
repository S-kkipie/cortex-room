import type { AgentEvent } from "../contract/events";
import type { EventBuffer } from "../emit/buffer";
import type { Publisher } from "../emit/portal";
import type { ActiveSpeakerInterval } from "../identity/correlator";
import type { ActiveSpeakerSample } from "../meet-ui-adapter/observer";
import { SegmentReducer } from "../segments/reducer";
import { parseAssemblyMessage } from "../stt/assemblyai";

export type SessionState = "starting" | "waiting_admission" | "in_meeting" | "ended";

export interface SttBridge {
    start(): Promise<void>;
    onMessage(fn: (raw: string) => void): void;
    sendAudio(chunk: Uint8Array): void;
    stop(): Promise<void>;
}

export interface BrowserLike {
    close(): Promise<void>;
}

export type SessionDeps = {
    launchBrowser(): Promise<BrowserLike>;
    stt: SttBridge;
    buffer: EventBuffer;
    publisher: Publisher;
    now(): number;
};

const ACTIVE_WINDOW_MS = 15000;

export class MeetSession {
    private state: SessionState = "starting";
    private meetingId = "";
    private sessionStart = 0;
    private reducer: SegmentReducer | null = null;
    private activeSamples: ActiveSpeakerSample[] = [];

    constructor(private readonly deps: SessionDeps) {}

    getState(): SessionState {
        return this.state;
    }

    recordActiveSample(s: ActiveSpeakerSample): void {
        this.activeSamples.push(s);
        const cutoff = s.at - ACTIVE_WINDOW_MS;
        this.activeSamples = this.activeSamples.filter((x) => x.at >= cutoff);
    }

    private activeIntervals(): ActiveSpeakerInterval[] {
        // Each sample represents a short period of activity; widen it to cover the utterance window.
        return this.activeSamples.map((s) => ({
            participantId: s.participantId,
            displayName: s.displayName,
            start: s.at - 1000,
            end: s.at + 1000,
        }));
    }

    private emit(ev: AgentEvent): void {
        this.deps.buffer.append(ev);
        void this.deps.publisher.publish(ev);
    }

    ingestUtteranceRaw(raw: string): void {
        if (!this.reducer) this.reducer = new SegmentReducer(this.meetingId || "unknown");
        const u = parseAssemblyMessage(raw, this.sessionStart || this.deps.now());
        if (!u) return;
        const seg = this.reducer.push(u, this.activeIntervals());
        this.emit({ type: "transcript.segment", segment: seg });
    }

    async start(meetingId: string, _meetUrl: string): Promise<void> {
        this.meetingId = meetingId;
        this.sessionStart = this.deps.now();
        this.reducer = new SegmentReducer(meetingId);
        this.state = "starting";
        await this.deps.launchBrowser();
        await this.deps.stt.start();
        this.deps.stt.onMessage((raw) => this.ingestUtteranceRaw(raw));
        // Real Playwright join flow + audio piping + DOM polling wired in Task 10.
        this.state = "in_meeting";
        this.emit({ type: "session.started", meetingId, at: new Date(this.sessionStart).toISOString() });
    }

    async stop(reason: string): Promise<void> {
        await this.deps.stt.stop();
        this.state = "ended";
        this.emit({ type: "session.ended", meetingId: this.meetingId, at: new Date(this.deps.now()).toISOString(), reason });
    }
}
