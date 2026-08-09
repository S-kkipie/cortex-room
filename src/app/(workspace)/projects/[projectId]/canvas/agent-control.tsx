"use client";

import { Bot, Loader2, Square } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/frontend/components/ui/button";
import { Input } from "@/frontend/components/ui/input";
import {
    type AgentResult,
    startAgentAction,
    stopAgentAction,
} from "./agent-actions";

/**
 * Floating control to send the meeting agent into a Google Meet for this
 * canvas, so a user never has to hand-craft a curl. Server actions hold the
 * control-API bearer; this only passes the meeting URL and projectId.
 */
export function AgentControl({ projectId }: { projectId: string }) {
    const [meetUrl, setMeetUrl] = useState("");
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<AgentResult | null>(null);
    const [pending, startTransition] = useTransition();

    const start = () => {
        startTransition(async () => {
            const res = await startAgentAction(projectId, meetUrl);
            setResult(res);
            if (res.ok) setRunning(true);
        });
    };

    const stop = () => {
        startTransition(async () => {
            const res = await stopAgentAction(projectId);
            setResult(res);
            if (res.ok) setRunning(false);
        });
    };

    return (
        <div className="pointer-events-auto absolute top-20 right-4 z-20 w-[min(92vw,360px)] rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur">
            <div className="mb-2 flex items-center gap-2 font-medium text-sm">
                <Bot className="size-4 text-primary" />
                Agente de reunión
            </div>
            <div className="flex flex-col gap-2">
                <Input
                    value={meetUrl}
                    onChange={(e) => setMeetUrl(e.target.value)}
                    placeholder="https://meet.google.com/xxx-xxxx-xxx"
                    aria-label="Link de Google Meet"
                    disabled={running || pending}
                />
                {running ? (
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={stop}
                        disabled={pending}
                        className="gap-2"
                    >
                        {pending ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <Square className="size-4" />
                        )}
                        Detener agente
                    </Button>
                ) : (
                    <Button
                        type="button"
                        onClick={start}
                        disabled={pending || meetUrl.trim().length === 0}
                        className="gap-2"
                    >
                        {pending ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <Bot className="size-4" />
                        )}
                        Invitar al Meet
                    </Button>
                )}
                {result ? (
                    <p
                        className={`text-xs ${result.ok ? "text-muted-foreground" : "text-destructive"}`}
                    >
                        {result.message}
                    </p>
                ) : (
                    <p className="text-muted-foreground text-xs">
                        El agente entra al Meet y las notas aparecen aquí solas.
                    </p>
                )}
            </div>
        </div>
    );
}
