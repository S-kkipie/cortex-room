"use client";

import { AlertTriangle, Wifi, WifiOff } from "lucide-react";
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
    unsynced: "Unsynced",
} satisfies Record<CanvasPortalStatus | "unsynced", string>;

function statusTone(status: CanvasPortalStatus | "unsynced"): string {
    if (status === "ready") return "text-emerald-600 dark:text-emerald-400";
    if (status === "unsynced") return "text-amber-600 dark:text-amber-400";
    if (status === "blocked" || status === "unavailable") {
        return "text-destructive";
    }
    return "text-muted-foreground";
}

export function CanvasConnectionStatus() {
    const {
        onlineParticipantCount = 0,
        pendingPublishCount = 0,
        portalStatus,
        retryPendingPublishes,
    } = useCanvasController();
    const displayStatus = pendingPublishCount > 0 ? "unsynced" : portalStatus;
    const Icon =
        displayStatus === "unsynced"
            ? AlertTriangle
            : portalStatus === "blocked" || portalStatus === "unavailable"
              ? WifiOff
              : Wifi;

    return (
        <div
            aria-live="polite"
            className={`absolute right-4 bottom-4 z-10 inline-flex items-center gap-1.5 rounded-full border bg-background/90 px-2.5 py-1 text-xs shadow-sm backdrop-blur ${statusTone(displayStatus)}`}
            data-status={displayStatus}
            data-testid="canvas-connection-status"
            role="status"
        >
            <Icon aria-hidden="true" className="size-3.5" />
            <span>{STATUS_LABELS[displayStatus]}</span>
            {onlineParticipantCount > 0 ? (
                <span title={`${onlineParticipantCount} collaborators online`}>
                    · {onlineParticipantCount}
                </span>
            ) : null}
            {pendingPublishCount > 0 ? (
                <button
                    aria-label="Retry unsynced changes"
                    className="font-medium underline underline-offset-2"
                    onClick={retryPendingPublishes}
                    type="button"
                >
                    Retry
                </button>
            ) : null}
        </div>
    );
}
