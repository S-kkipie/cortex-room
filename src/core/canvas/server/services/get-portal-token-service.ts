import "server-only";
import { ServerConfig } from "@/config/server-config";
import type { PortalTokenResponse } from "@/core/canvas/domain/types";
import {
    portalExternalTokenResponseSchema,
    portalTokenRequestSchema,
} from "@/core/canvas/server/portal/schemas";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { findProjectForCanvasById } from "../repository/find-project-for-canvas-by-id";

const PORTAL_TOKEN_TTL = "1h";

export type PortalTokenFetch = typeof fetch;

export async function getPortalTokenService(
    actorId: string,
    projectId: string,
    userLabel: string,
    fetchImpl: PortalTokenFetch = fetch,
): AsyncAppResult<PortalTokenResponse> {
    try {
        const project = await findProjectForCanvasById(projectId);
        if (!project)
            return err(AppErrors.notFound({ targets: ["projectId"] }));

        const secretKey = ServerConfig.portalSecretKey;
        if (!secretKey) {
            return err(
                AppErrors.unexpected(
                    new Error("Portal is not configured for this environment"),
                ),
            );
        }

        const channelId = `room-${projectId}`;
        const requestBody = portalTokenRequestSchema.parse({
            userId: actorId,
            claims: { username: userLabel },
            channels: { [channelId]: ["connect", "publish"] },
            ttl: PORTAL_TOKEN_TTL,
        });

        const response = await fetchImpl(
            `${ServerConfig.portalApiUrl}/v1/tokens`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${secretKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
            },
        );

        if (!response.ok) {
            return err(
                AppErrors.unexpected(
                    new Error(
                        `Portal token request failed (${response.status})`,
                    ),
                ),
            );
        }

        const payload = portalExternalTokenResponseSchema.parse(
            await response.json(),
        );

        return ok({ ...payload, channelId });
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
