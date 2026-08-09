import { z } from "zod";

const portalCapabilitySchema = z.enum(["connect", "publish"]);

export const portalTokenRequestSchema = z.strictObject({
    userId: z.string().min(1),
    claims: z.record(z.string(), z.unknown()).optional(),
    channels: z
        .record(z.string().min(1), z.array(portalCapabilitySchema))
        .optional(),
    ttl: z.string().min(1),
});

export const portalExternalTokenResponseSchema = z.strictObject({
    token: z.string().min(1),
    expiresAt: z.iso.datetime(),
});
