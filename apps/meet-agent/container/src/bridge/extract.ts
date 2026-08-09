import { type CanvasNote, extractionSchema } from "./types";

export type ExtractImpl = (prompt: string) => Promise<string>;

const SYSTEM = [
    "You extract structured meeting notes from a transcript window.",
    "Return ONLY new items not already captured. Output strict JSON with keys:",
    "actionItems[{text,owner?}], decisions[{text}], topics[{text}], questions[{text,owner?}], risks[{text}].",
    "owner is the speaker name responsible, when clear. Return empty arrays when nothing new. No prose.",
].join(" ");

export function buildPrompt(newText: string, alreadyEmitted: string[]): string {
    const emitted = alreadyEmitted.length ? alreadyEmitted.map((t) => `- ${t}`).join("\n") : "(none)";
    return `${SYSTEM}\n\nAlready captured (do NOT repeat):\n${emitted}\n\nNew transcript:\n${newText}`;
}

export async function extractNotes(args: {
    newText: string;
    alreadyEmitted: string[];
    extractImpl: ExtractImpl;
}): Promise<CanvasNote[]> {
    try {
        const raw = await args.extractImpl(buildPrompt(args.newText, args.alreadyEmitted));
        const parsed = extractionSchema.parse(JSON.parse(raw));
        const notes: CanvasNote[] = [];
        for (const a of parsed.actionItems) {
            notes.push({ category: "action", text: a.text, ...(a.owner ? { ownerName: a.owner } : {}) });
        }
        for (const d of parsed.decisions) {
            notes.push({ category: "decision", text: d.text });
        }
        for (const t of parsed.topics) {
            notes.push({ category: "topic", text: t.text });
        }
        for (const q of parsed.questions) {
            notes.push({ category: "question", text: q.text, ...(q.owner ? { ownerName: q.owner } : {}) });
        }
        for (const r of parsed.risks) {
            notes.push({ category: "risk", text: r.text });
        }
        return notes;
    } catch (err) {
        console.error("[bridge] extract failed (continuing):", err);
        return [];
    }
}

export function createGeminiExtractor(opts: {
    apiKey: string;
    model?: string;
    fetchImpl?: typeof fetch;
}): ExtractImpl {
    const model = opts.model ?? "gemini-2.0-flash";
    const doFetch = opts.fetchImpl ?? fetch;
    return async (prompt) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${opts.apiKey}`;
        const res = await doFetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: "application/json" },
            }),
        });
        if (!res.ok) {
            throw new Error(`gemini ${res.status}`);
        }
        const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    };
}
