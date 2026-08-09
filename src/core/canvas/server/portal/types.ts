import type { z } from "zod";
import type {
    portalExternalTokenResponseSchema,
    portalTokenRequestSchema,
} from "./schemas";

export type PortalTokenRequest = z.infer<typeof portalTokenRequestSchema>;
export type PortalExternalTokenResponse = z.infer<
    typeof portalExternalTokenResponseSchema
>;
