"use client";

import { ViewportPortal } from "@xyflow/react";
import type { CanvasRemoteParticipant } from "@/core/canvas/client/portal/canvas-awareness";

export function CanvasRemoteCursors({
    participants = [],
}: {
    participants?: readonly CanvasRemoteParticipant[];
}) {
    const visibleParticipants = participants.filter(
        (participant) => participant.cursor,
    );
    if (visibleParticipants.length === 0) return null;

    return (
        <ViewportPortal>
            {visibleParticipants.map((participant) => {
                const cursor = participant.cursor;
                if (!cursor) return null;

                return (
                    <div
                        aria-label={`${participant.label} cursor`}
                        className="pointer-events-none absolute z-30 flex items-start"
                        data-participant-id={participant.id}
                        key={participant.id}
                        role="img"
                        style={{
                            left: 0,
                            top: 0,
                            transform: `translate(${cursor.x}px, ${cursor.y}px)`,
                        }}
                    >
                        <span className="rounded-full bg-sky-500 px-2 py-0.5 font-medium text-[10px] text-white shadow-sm">
                            {participant.label}
                        </span>
                    </div>
                );
            })}
        </ViewportPortal>
    );
}
