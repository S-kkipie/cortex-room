import { chromium } from "playwright";
import type { AgentEvent } from "../contract/events";
import type { EventBuffer } from "../emit/buffer";
import type { Publisher } from "../emit/portal";
import type { ActiveSpeakerInterval } from "../identity/correlator";
import { readActiveSpeakers, readRoster } from "../meet-ui-adapter/observer";
import { selectors } from "../meet-ui-adapter/selectors";
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
    launchBrowser(meetUrl: string, onSample: (sample: ActiveSpeakerSample) => void): Promise<BrowserLike>;
    stt: SttBridge;
    buffer: EventBuffer;
    publisher: Publisher;
    now(): number;
};

const ACTIVE_WINDOW_MS = 15000;

/** Launch the Meet guest and keep active-speaker observation independent from STT. */
export async function createPlaywrightBrowser(
    meetUrl: string,
    onSample: (sample: ActiveSpeakerSample) => void,
    onAudio?: (chunk: Uint8Array) => void,
): Promise<BrowserLike> {
    const browser = await chromium.launch({
        headless: true,
        args: ["--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    });
    const ctx = await browser.newContext({ permissions: ["microphone", "camera"] });
    const page = await ctx.newPage();
    if (onAudio) await page.exposeFunction("__audioChunk", (chunk: number[]) => onAudio(new Uint8Array(chunk)));
    await page.goto(meetUrl);
    await page.fill(selectors.nameInput, "Cortex Notetaker").catch(() => {});
    await page.click(selectors.askToJoinButton).catch(() => {});

    // Make the pure reader available in the page context; the poll itself is guarded so
    // selector/page failures can never stop the transcription bridge.
    await page.evaluate((source) => {
        (window as unknown as { __readActiveSpeakers: typeof readActiveSpeakers }).__readActiveSpeakers =
            (0, eval)(`(${source})`) as typeof readActiveSpeakers;
    }, readActiveSpeakers.toString());
    await page.evaluate((source) => {
        (window as unknown as { __readRoster: typeof readRoster }).__readRoster =
            (0, eval)(`(${source})`) as typeof readRoster;
    }, readRoster.toString());

    if (onAudio) {
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll("audio,video"));
            for (const element of elements) {
                const stream = (element as HTMLMediaElement & { captureStream: () => MediaStream }).captureStream();
                const recorder = new MediaRecorder(stream);
                recorder.ondataavailable = async (event) => {
                    if (event.data.size === 0) return;
                    const bytes = Array.from(new Uint8Array(await event.data.arrayBuffer()));
                    await (window as unknown as { __audioChunk: (chunk: number[]) => Promise<void> }).__audioChunk(bytes);
                };
                recorder.start(250);
            }
        }).catch(() => {});
    }

    const poll = setInterval(async () => {
        try {
            const samples = await page.evaluate(
                ([sel, now]) =>
                    (window as unknown as { __readActiveSpeakers: typeof readActiveSpeakers }).__readActiveSpeakers(
                        document,
                        sel,
                        now,
                    ),
                [selectors, Date.now()] as const,
            );
            for (const sample of samples) onSample(sample);
        } catch {
            // DOM scrape failed — transcription continues with unresolved identity.
        }
    }, 250);

    return {
        close: async () => {
            clearInterval(poll);
            await browser.close();
        },
    };
}

export function createAssemblyAiBridge(apiKey: string): SttBridge {
    let ws: WebSocket | null = null;
    let onMsg: (raw: string) => void = () => {};
    return {
        async start() {
            ws = new WebSocket(
                "wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&format_turns=true",
                { headers: { authorization: apiKey } } as unknown as string[],
            );
            ws.onmessage = (event) => onMsg(typeof event.data === "string" ? event.data : "");
        },
        onMessage(fn) {
            onMsg = fn;
        },
        sendAudio(chunk) {
            if (ws?.readyState === WebSocket.OPEN) ws.send(chunk);
        },
        async stop() {
            ws?.close();
            ws = null;
        },
    };
}

export class MeetSession {
    private state: SessionState = "starting";
    private meetingId = "";
    private sessionStart = 0;
    private reducer: SegmentReducer | null = null;
    private activeSamples: ActiveSpeakerSample[] = [];
    private browser: BrowserLike | null = null;

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

    async start(meetingId: string, meetUrl: string): Promise<void> {
        this.meetingId = meetingId;
        this.sessionStart = this.deps.now();
        this.reducer = new SegmentReducer(meetingId);
        this.state = "starting";
        this.browser = await this.deps.launchBrowser(meetUrl, (sample) => this.recordActiveSample(sample));
        await this.deps.stt.start();
        this.deps.stt.onMessage((raw) => this.ingestUtteranceRaw(raw));
        this.state = "in_meeting";
        this.emit({ type: "session.started", meetingId, at: new Date(this.sessionStart).toISOString() });
    }

    async stop(reason: string): Promise<void> {
        await this.deps.stt.stop();
        await this.browser?.close();
        this.browser = null;
        this.state = "ended";
        this.emit({ type: "session.ended", meetingId: this.meetingId, at: new Date(this.deps.now()).toISOString(), reason });
    }
}
