import { describe, expect, it, vi } from "vitest";
import { buildPrompt, createGeminiExtractor, extractNotes } from "../extract";

const fixture = JSON.stringify({
    actionItems: [{ text: "send the deck", owner: "Diego" }],
    decisions: [{ text: "use Recall" }],
    questions: [{ text: "what budget?" }],
    risks: [{ text: "API key exposed" }],
    topics: [{ text: "roadmap" }],
});

describe("extractNotes", () => {
    it("flattens all five categories with correct tags", async () => {
        const notes = await extractNotes({ newText: "x", alreadyEmitted: [], extractImpl: async () => fixture });
        expect(notes).toContainEqual({ category: "action", text: "send the deck", ownerName: "Diego" });
        expect(notes).toContainEqual({ category: "decision", text: "use Recall" });
        expect(notes).toContainEqual({ category: "question", text: "what budget?" });
        expect(notes).toContainEqual({ category: "risk", text: "API key exposed" });
        expect(notes).toContainEqual({ category: "topic", text: "roadmap" });
        expect(notes).toHaveLength(5);
    });

    it("returns [] on malformed JSON", async () => {
        expect(await extractNotes({ newText: "x", alreadyEmitted: [], extractImpl: async () => "not json" })).toEqual([]);
    });

    it("returns [] when extractImpl throws", async () => {
        expect(
            await extractNotes({
                newText: "x",
                alreadyEmitted: [],
                extractImpl: async () => {
                    throw new Error("boom");
                },
            }),
        ).toEqual([]);
    });

    it("includes already-emitted list in the prompt", () => {
        const prompt = buildPrompt("hello", ["send the deck"]);
        expect(prompt).toContain("send the deck");
    });
});

describe("createGeminiExtractor", () => {
    it("posts to the Gemini endpoint and returns the text part", async () => {
        const fetchImpl = vi.fn(async () =>
            new Response(
                JSON.stringify({ candidates: [{ content: { parts: [{ text: fixture }] } }] }),
                { status: 200 },
            ),
        ) as unknown as typeof fetch;
        const extract = createGeminiExtractor({ apiKey: "k", model: "gemini-2.5-flash", fetchImpl });
        const raw = await extract("prompt");
        expect(raw).toBe(fixture);
        const url = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(url).toContain("gemini-2.5-flash:generateContent");
    });
});
