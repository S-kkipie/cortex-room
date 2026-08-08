import type { AgentEvent } from "../contract/events";

export class EventBuffer {
    private events: AgentEvent[] = [];
    private subs = new Set<(ev: AgentEvent) => void>();

    append(ev: AgentEvent): number {
        this.events.push(ev);
        for (const fn of this.subs) fn(ev);
        return this.events.length;
    }

    since(cursor: number): { cursor: number; events: AgentEvent[] } {
        const from = Math.max(0, cursor);
        return { cursor: this.events.length, events: this.events.slice(from) };
    }

    subscribe(fn: (ev: AgentEvent) => void): () => void {
        this.subs.add(fn);
        return () => this.subs.delete(fn);
    }
}
