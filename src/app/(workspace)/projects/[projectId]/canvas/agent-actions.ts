"use server";

import { env } from "@/config/env";
import { requireAuth } from "@/server/auth/require-auth";

export type AgentResult = { ok: boolean; message: string };

function configured(): boolean {
    return Boolean(env.MEET_AGENT_URL && env.MEET_AGENT_AUTH_TOKEN);
}

/**
 * Send the meeting agent (Recall bot) into a Google Meet for this canvas.
 * Runs server-side so the control-API bearer never reaches the browser. The
 * meeting id is the projectId, so one bot session maps to one canvas, and the
 * bot publishes its AI notes to this project's Portal room.
 */
export async function startAgentAction(
    projectId: string,
    meetingUrl: string,
): Promise<AgentResult> {
    await requireAuth(`/projects/${projectId}/canvas`);
    if (!configured()) {
        return {
            ok: false,
            message: "Agente no configurado (MEET_AGENT_URL / TOKEN).",
        };
    }
    const url = meetingUrl.trim();
    if (!url.startsWith("https://meet.google.com/")) {
        return { ok: false, message: "Pega un link válido de Google Meet." };
    }
    try {
        const res = await fetch(
            `${env.MEET_AGENT_URL}/meetings/${projectId}/start`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${env.MEET_AGENT_AUTH_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    meetingUrl: url,
                    canvasProjectId: projectId,
                }),
            },
        );
        if (!res.ok) {
            return {
                ok: false,
                message: `Error ${res.status}: ${await res.text()}`,
            };
        }
        return { ok: true, message: "Agente uniéndose al Meet…" };
    } catch (cause) {
        return {
            ok: false,
            message:
                cause instanceof Error
                    ? cause.message
                    : "No se pudo invocar al agente.",
        };
    }
}

/** Tell the bot to leave the call for this canvas. */
export async function stopAgentAction(projectId: string): Promise<AgentResult> {
    await requireAuth(`/projects/${projectId}/canvas`);
    if (!configured()) {
        return { ok: false, message: "Agente no configurado." };
    }
    try {
        const res = await fetch(
            `${env.MEET_AGENT_URL}/meetings/${projectId}/stop`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${env.MEET_AGENT_AUTH_TOKEN}`,
                },
            },
        );
        if (!res.ok) return { ok: false, message: `Error ${res.status}` };
        return { ok: true, message: "Agente detenido." };
    } catch (cause) {
        return {
            ok: false,
            message:
                cause instanceof Error
                    ? cause.message
                    : "No se pudo detener al agente.",
        };
    }
}
