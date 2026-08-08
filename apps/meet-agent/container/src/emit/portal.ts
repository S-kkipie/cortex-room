import { Portal } from "@portalsdk/core";
import type { AgentEvent } from "../contract/events";

export interface Publisher {
    publish(ev: AgentEvent): Promise<void>;
}

type Opts = {
    apiKey: string;
    channelId: string;
    token?: string;
    _sendImpl?: (ev: AgentEvent) => Promise<void>;
};

export function createPortalPublisher(opts: Opts): Publisher {
    let send = opts._sendImpl;

    const ensure = (): ((ev: AgentEvent) => Promise<void>) => {
        if (send) return send;
        const portal = new Portal({ apiKey: opts.apiKey, token: opts.token });
        const room = portal.channel<AgentEvent>(opts.channelId);
        room.acquire();
        send = (ev) => room.send({ content: ev });
        return send;
    };

    return {
        async publish(ev) {
            try {
                await ensure()(ev);
            } catch (err) {
                console.error("[portal] publish failed (continuing):", err);
            }
        },
    };
}
