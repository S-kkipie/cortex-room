import type { CanvasPortalMessage } from "../../../../../src/core/canvas/domain/types";
import type { Participant, TranscriptSegment } from "../contract/events";
import { BridgeBuffer } from "./buffer";
import { toCanvasMessage } from "./canvas-publish";
import { NoteDedup } from "./dedup";
import { type ExtractImpl, extractNotes } from "./extract";
import { LayoutCursor } from "./layout";
import { resolveOwners } from "./owners";

type Opts = {
    projectId: string;
    extractImpl: ExtractImpl;
    publisher: { publish(m: CanvasPortalMessage): Promise<void> };
    participants: () => Iterable<Participant>;
    genId: () => string;
    now: () => number;
    nowIso: () => string;
};

export class Bridge {
    private buffer: BridgeBuffer;
    private dedup = new NoteDedup();
    private layout = new LayoutCursor();
    private emitted: string[] = [];
    private flushing: Promise<void> | null = null;

    constructor(private opts: Opts) {
        this.buffer = new BridgeBuffer(opts.now());
    }

    onSegment(seg: TranscriptSegment): void {
        this.buffer.append(seg);
        if (this.buffer.shouldFlush(this.opts.now())) void this.flush();
    }

    async flush(): Promise<void> {
        if (this.flushing) return this.flushing;

        this.flushing = (async () => {
            try {
                const { text } = this.buffer.drain(this.opts.now());
                if (!text) return;
                const raw = await extractNotes({
                    newText: text,
                    alreadyEmitted: this.emitted,
                    extractImpl: this.opts.extractImpl,
                });
                const owned = resolveOwners(raw, this.opts.participants());
                const fresh = this.dedup.filterNew(owned);
                for (const note of fresh) {
                    this.emitted.push(note.text);
                    const pos = this.layout.place(note.category);
                    const msg = toCanvasMessage({
                        note,
                        projectId: this.opts.projectId,
                        pos,
                        genId: this.opts.genId,
                        nowIso: this.opts.nowIso(),
                    });
                    await this.opts.publisher.publish(msg);
                }
            } catch (err) {
                console.error("[bridge] flush failed (continuing):", err);
            } finally {
                this.flushing = null;
            }
        })();

        return this.flushing;
    }
}
