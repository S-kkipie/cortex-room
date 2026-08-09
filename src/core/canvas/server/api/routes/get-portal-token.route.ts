import { Elysia } from "elysia";
import { z } from "zod";
import { portalTokenResponseSchema } from "@/core/canvas/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { getPortalTokenService } from "../../services/get-portal-token-service";

export const getPortalTokenRoute = new Elysia().use(authed).get(
    "/token",
    async ({ user, query, status }) => {
        const result = await getPortalTokenService(
            user.id,
            query.projectId,
            user.name.trim() || user.email,
        );

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
        query: z.object({ projectId: z.uuid() }),
        response: {
            200: successResponseSchema(
                portalTokenResponseSchema,
                "PortalTokenResponse",
            ),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Portal"], summary: "Mint a canvas Portal token" },
    },
);
