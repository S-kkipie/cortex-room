import { env } from "./env";

export const ClientConfig = {
    baseUrl: env.NEXT_PUBLIC_APP_URL,
    portalApiKey: env.NEXT_PUBLIC_PORTAL_API_KEY,
} as const;
