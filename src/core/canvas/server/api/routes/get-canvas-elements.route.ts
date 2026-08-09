import { Elysia } from "elysia";
import { z } from "zod";
import { canvasSnapshotSchema } from "@/core/canvas/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { getCanvasSnapshotService } from "../../services/get-canvas-snapshot-service";

export const getCanvasElementsRoute = new Elysia().use(authed).get(
    "/:projectId/elements",
    async ({ params, status }) => {
        const result = await getCanvasSnapshotService(params.projectId);
        if (!result.ok) {
            return status(
                result.error.status as 404 | 500,
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
        params: z.object({ projectId: z.uuid() }),
        response: {
            200: successResponseSchema(canvasSnapshotSchema, "CanvasSnapshot"),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            500: errorResponseSchema(500),
        },
        detail: {
            tags: ["Canvas"],
            summary: "Get a project's persisted canvas elements",
        },
    },
);
