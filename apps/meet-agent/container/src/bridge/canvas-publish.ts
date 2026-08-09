import { Portal } from "@portalsdk/core";
import { canvasPortalChannelId } from "../../../../../src/core/canvas/domain/portal-channel";
import { canvasPortalMessageSchema } from "../../../../../src/core/canvas/domain/schemas";
import type { CanvasPortalMessage } from "../../../../../src/core/canvas/domain/types";
import { mintPortalToken } from "./portal-token";
import type { CanvasNote, NoteCategory } from "./types";

const PREFIX: Record<NoteCategory, string> = {
    action: "✅ ",
    decision: "🔷 ",
    topic: "💬 ",
    question: "❓ ",
    risk: "⚠️ ",
};

function renderContent(note: CanvasNote): string {
    const owner = note.ownerName ? ` — @${note.ownerName}` : "";
    return `${PREFIX[note.category]}${note.text}${owner}`;
}

export function toCanvasMessage(args: {
    note: CanvasNote;
    projectId: string;
    pos: { x: number; y: number; width: number; height: number };
    genId: () => string;
    nowIso: string;
}): CanvasPortalMessage {
    const { note, projectId, pos, genId, nowIso } = args;
    const elementId = genId();
    const opId = genId();
    const element = {
        id: elementId,
        projectId,
        type: "STICKY" as const,
        content: renderContent(note),
        x: pos.x,
        y: pos.y,
        width: pos.width,
        height: pos.height,
        createdBy: "meet-agent",
        createdAt: nowIso,
        updatedAt: nowIso,
        lastOperationAt: nowIso,
        lastOperationId: opId,
    };
    const message: CanvasPortalMessage = {
        type: "workspace.element.created",
        ephemeral: false,
        senderId: "meet-agent",
        content: {
            kind: "workspace.element.created.final",
            eventId: opId,
            projectId,
            occurredAt: nowIso,
            element,
        },
    };

    return canvasPortalMessageSchema.parse(message);
}

export function createCanvasPublisher(opts: {
    apiKey: string;
    projectId: string;
    secretKey?: string;
    token?: string | (() => Promise<string>);
    _sendImpl?: (msg: unknown) => Promise<void>;
}): { publish(msg: unknown): Promise<void> } {
    let send = opts._sendImpl;

    const ensure = (): ((msg: unknown) => Promise<void>) => {
        if (send) return send;
        // The canvas channel is token-gated; mint a bot token (connect+publish)
        // on connect/expiry via the secret key. A callback lets the SDK
        // re-resolve it when it expires.
        const token =
            opts.token ??
            (opts.secretKey
                ? () =>
                      mintPortalToken({
                          secretKey: opts.secretKey as string,
                          projectId: opts.projectId,
                      })
                : undefined);
        const portal = new Portal({ apiKey: opts.apiKey, token });
        const room = portal.channel<CanvasPortalMessage>(
            canvasPortalChannelId(opts.projectId),
        );
        room.acquire();
        send = async (msg) => {
            await room.send({ content: msg as CanvasPortalMessage });
        };
        return send;
    };

    return {
        async publish(msg) {
            try {
                await ensure()(msg);
            } catch (err) {
                console.error("[canvas] publish failed (continuing):", err);
            }
        },
    };
}
