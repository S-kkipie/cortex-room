"use client";

import { Wifi, WifiOff } from "lucide-react";
import { useCanvasController } from "@/core/canvas/client/controller/canvas-controller-context";
import type { CanvasPortalStatus } from "@/core/canvas/client/portal/canvas-portal-provider";

const STATUS_LABELS = {
    idle: "Connecting",
    connecting: "Connecting",
    ready: "Live",
    reconnecting: "Reconnecting",
    degraded: "Degraded",
    "degraded-http": "Degraded",
    blocked: "Blocked",
    unavailable: "Unavailable",
} satisfies Record<CanvasPortalStatus, string>;

function statusTone(status: CanvasPortalStatus): string {
    if (status === "ready") return "text-emerald-600 dark:text-emerald-400";
    if (status === "blocked" || status === "unavailable") {
        return "text-destructive";
    }
    return "text-muted-foreground";
}

export function CanvasConnectionStatus() {
    const { onlineParticipantCount, portalStatus } = useCanvasController();
    const Icon =
        portalStatus === "blocked" || portalStatus === "unavailable"
            ? WifiOff
            : Wifi;

    return (
        <div
            aria-live="polite"
            className={`absolute right-4 bottom-4 z-10 inline-flex items-center gap-1.5 rounded-full border bg-background/90 px-2.5 py-1 text-xs shadow-sm backdrop-blur ${statusTone(portalStatus)}`}
            data-status={portalStatus}
            data-testid="canvas-connection-status"
            role="status"
        >
            <Icon aria-hidden="true" className="size-3.5" />
            <span>{STATUS_LABELS[portalStatus]}</span>
            {onlineParticipantCount > 0 ? (
                <span title={`${onlineParticipantCount} collaborators online`}>
                    · {onlineParticipantCount}
                </span>
            ) : null}
        </div>
    );
}
