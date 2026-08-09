import { Elysia } from "elysia";
import { z } from "zod";
import {
    canvasMutationResultSchema,
    createElementCommandSchema,
} from "@/core/canvas/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    createdResponseSchema,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { applyCanvasCommandService } from "../../services/apply-canvas-command-service";

export const createCanvasElementRoute = new Elysia().use(authed).post(
    "/:projectId/elements",
    async ({ user, params, body, status }) => {
        const result = await applyCanvasCommandService(
            user.id,
            params.projectId,
            body,
        );
        if (!result.ok) {
            return status(
                result.error.status as 400 | 404 | 409 | 500,
                errorToResponse(result.error),
            );
        }

        if (result.data.applied) {
            return status(
                201,
                CommonResponse.created({ response: result.data }),
            );
        }

        return status(
            200,
            CommonResponse.successful({ response: result.data }),
        );
    },
    {
        authed: true,
        params: z.object({ projectId: z.uuid() }),
        body: createElementCommandSchema,
        response: {
            200: successResponseSchema(
                canvasMutationResultSchema,
                "CanvasMutationResult",
            ),
            201: createdResponseSchema(
                canvasMutationResultSchema,
                "CanvasMutationResult",
            ),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Canvas"], summary: "Create a canvas element" },
    },
);
