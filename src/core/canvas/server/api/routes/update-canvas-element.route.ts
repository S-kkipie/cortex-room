import { Elysia } from "elysia";
import { z } from "zod";
import { canvasMutationResultSchema } from "@/core/canvas/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { applyCanvasCommandService } from "../../services/apply-canvas-command-service";
import { updateCanvasElementCommandSchema } from "../schemas";

export const updateCanvasElementRoute = new Elysia().use(authed).put(
    "/:projectId/elements/:elementId",
    async ({ user, params, body, status }) => {
        const result = await applyCanvasCommandService(
            user.id,
            params.projectId,
            body,
            params.elementId,
        );
        if (!result.ok) {
            return status(
                result.error.status as 400 | 404 | 409 | 500,
                errorToResponse(result.error),
            );
        }

        return status(
            200,
            CommonResponse.successful({ response: result.data }),
        );
    },
    {
        authed: true,
        params: z.object({ projectId: z.uuid(), elementId: z.uuid() }),
        body: updateCanvasElementCommandSchema,
        response: {
            200: successResponseSchema(
                canvasMutationResultSchema,
                "CanvasMutationResult",
            ),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Canvas"], summary: "Update a canvas element" },
    },
);
