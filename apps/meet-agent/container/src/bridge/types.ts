import { z } from "zod";

export const noteCategorySchema = z.enum(["action", "decision", "topic", "question", "risk"]);
export type NoteCategory = z.infer<typeof noteCategorySchema>;

export const canvasNoteSchema = z.object({
    category: noteCategorySchema,
    text: z.string().min(1),
    ownerName: z.string().optional(),
    ownerParticipantId: z.string().optional(),
});
export type CanvasNote = z.infer<typeof canvasNoteSchema>;

export const extractionSchema = z.object({
    actionItems: z.array(z.object({ text: z.string(), owner: z.string().optional() })).default([]),
    decisions: z.array(z.object({ text: z.string() })).default([]),
    topics: z.array(z.object({ text: z.string() })).default([]),
    questions: z.array(z.object({ text: z.string(), owner: z.string().optional() })).default([]),
    risks: z.array(z.object({ text: z.string() })).default([]),
});
export type Extraction = z.infer<typeof extractionSchema>;
