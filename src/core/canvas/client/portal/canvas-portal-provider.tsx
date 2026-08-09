"use client";

import { type Message, Portal } from "@portalsdk/core";
import {
    PortalProvider,
    type UseChannelResult,
    useChannel,
} from "@portalsdk/react";
import {
    createContext,
    type PropsWithChildren,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { ClientConfig } from "@/config/client-config";
import { canvasPortalChannelId } from "@/core/canvas/domain/portal-channel";
import {
    canvasPortalMessageSchema,
    portalTokenEnvelopeSchema,
} from "@/core/canvas/domain/schemas";
import type { CanvasPortalMessage } from "@/core/canvas/domain/types";

const PORTAL_HISTORY_SIZE = 200;
const PORTAL_LIVE_MESSAGE_SIZE = 200;
const portalClient = new Portal({
    apiKey: ClientConfig.portalApiKey ?? "pk_unconfigured",
});

type PortalChannelResult = UseChannelResult<CanvasPortalMessage>;

export type CanvasPortalStatus = PortalChannelResult["status"] | "unavailable";

export type CanvasPortalContextValue = {
    configured: boolean;
    status: CanvasPortalStatus;
    historyReady: boolean;
    messages: readonly CanvasPortalMessage[];
    presence: PortalChannelResult["presence"];
    me: PortalChannelResult["me"];
    sendPersistent(message: CanvasPortalMessage): Promise<void>;
    sendEphemeral(message: CanvasPortalMessage): Promise<void>;
    setMetadata(metadata: Record<string, unknown>): void;
};

const CanvasPortalContext = createContext<CanvasPortalContextValue | null>(
    null,
);

function tokenUrl(projectId: string): string {
    return `${ClientConfig.baseUrl}/api/v1/portal/token?projectId=${encodeURIComponent(projectId)}`;
}

async function fetchPortalToken(projectId: string): Promise<string> {
    const response = await fetch(tokenUrl(projectId), {
        credentials: "include",
    });

    if (!response.ok) {
        throw new Error(`Unable to authenticate Portal (${response.status})`);
    }

    const payload = portalTokenEnvelopeSchema.safeParse(await response.json());
    if (!payload.success) {
        throw new Error("Portal returned an invalid token response");
    }

    return payload.data.response.token;
}

export function normalizePortalMessages(
    messages: PortalChannelResult["messages"],
    projectId: string,
): CanvasPortalMessage[] {
    const normalized: CanvasPortalMessage[] = [];

    for (const message of messages) {
        const parsed = normalizePortalMessage(message, projectId);
        if (parsed) normalized.push(parsed);
    }

    return normalized;
}

export function normalizePortalMessage(
    message: Message<CanvasPortalMessage>,
    projectId: string,
): CanvasPortalMessage | undefined {
    if (message.retracted) return undefined;
    const parsed = canvasPortalMessageSchema.safeParse({
        ...message.content,
        senderId: message.sender.id,
    });
    if (!parsed.success || parsed.data.content.projectId !== projectId) {
        return undefined;
    }
    return parsed.data;
}

function mergePortalMessages(
    history: readonly CanvasPortalMessage[],
    live: readonly CanvasPortalMessage[],
): CanvasPortalMessage[] {
    const merged = new Map<string, CanvasPortalMessage>();
    for (const message of [...history, ...live]) {
        merged.set(message.content.eventId, message);
    }
    return [...merged.values()];
}

function DisabledCanvasPortal({ children }: PropsWithChildren) {
    const value: CanvasPortalContextValue = {
        configured: false,
        status: "unavailable",
        historyReady: true,
        messages: [],
        presence: undefined,
        me: undefined,
        sendPersistent: async () => {
            throw new Error("Portal is not configured");
        },
        sendEphemeral: async () => undefined,
        setMetadata: () => undefined,
    };

    return (
        <CanvasPortalContext.Provider value={value}>
            {children}
        </CanvasPortalContext.Provider>
    );
}

function ConnectedCanvasPortal({
    projectId,
    children,
}: PropsWithChildren<{ projectId: string }>) {
    const channelId = canvasPortalChannelId(projectId);
    const [liveMessages, setLiveMessages] = useState<CanvasPortalMessage[]>([]);
    const handleMessage = useCallback(
        (message: Message<CanvasPortalMessage>) => {
            const normalized = normalizePortalMessage(message, projectId);
            if (!normalized) return;
            setLiveMessages((current) => {
                const next = current.filter(
                    (candidate) =>
                        candidate.content.eventId !==
                        normalized.content.eventId,
                );
                next.push(normalized);
                return next.slice(-PORTAL_LIVE_MESSAGE_SIZE);
            });
        },
        [projectId],
    );
    const channel = useChannel<CanvasPortalMessage>({
        channelId,
        history: PORTAL_HISTORY_SIZE,
        metadata: { selectedElementIds: [] },
        onMessage: handleMessage,
        readOn: "manual",
    });
    const [historyReady, setHistoryReady] = useState(false);

    useEffect(() => {
        if (channel.status === "idle" || channel.status === "connecting") {
            return;
        }
        setHistoryReady(true);
    }, [channel.status]);

    const messages = useMemo(() => {
        const history = normalizePortalMessages(channel.messages, projectId);
        return mergePortalMessages(history, liveMessages);
    }, [channel.messages, liveMessages, projectId]);
    const value: CanvasPortalContextValue = {
        configured: true,
        status: channel.status,
        historyReady,
        messages,
        presence: channel.presence,
        me: channel.me,
        sendPersistent: async (message) => {
            await channel.send({ content: message });
        },
        sendEphemeral: async (message) => {
            // Portal core 0.1.5 drops incoming ephemeral frames. Send the
            // semantic ephemeral event through the reliable channel instead;
            // Portal middleware retracts it immediately after delivery.
            await channel.send({ content: message });
        },
        setMetadata: channel.setMetadata,
    };

    return (
        <CanvasPortalContext.Provider value={value}>
            {children}
        </CanvasPortalContext.Provider>
    );
}

export function CanvasPortalProvider({
    projectId,
    children,
}: PropsWithChildren<{ projectId: string }>) {
    if (!ClientConfig.portalApiKey) {
        return <DisabledCanvasPortal>{children}</DisabledCanvasPortal>;
    }

    return (
        <PortalProvider
            client={portalClient}
            token={() => fetchPortalToken(projectId)}
        >
            <ConnectedCanvasPortal key={projectId} projectId={projectId}>
                {children}
            </ConnectedCanvasPortal>
        </PortalProvider>
    );
}

export function useCanvasPortal(): CanvasPortalContextValue {
    const context = useContext(CanvasPortalContext);
    if (!context) {
        throw new Error(
            "useCanvasPortal must be used inside CanvasPortalProvider",
        );
    }
    return context;
}
