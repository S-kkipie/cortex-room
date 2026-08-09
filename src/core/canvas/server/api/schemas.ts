import { z } from "zod";
import {
    moveElementCommandSchema,
    resizeElementCommandSchema,
    updateElementCommandSchema,
} from "@/core/canvas/domain/schemas";

export const updateCanvasElementCommandSchema = z.discriminatedUnion("kind", [
    updateElementCommandSchema,
    moveElementCommandSchema,
    resizeElementCommandSchema,
]);
