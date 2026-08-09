import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
    server: {
        DATABASE_URL: z.url(),
        BETTER_AUTH_SECRET: z.string().min(32),
        PORTAL_SECRET_KEY: z.string().startsWith("sk_").optional(),
        MEET_AGENT_URL: z.url().optional(),
        MEET_AGENT_AUTH_TOKEN: z.string().min(1).optional(),
    },
    client: {
        NEXT_PUBLIC_APP_URL: z.url(),
        NEXT_PUBLIC_PORTAL_API_KEY: z.string().startsWith("pk_").optional(),
    },
    runtimeEnv: {
        DATABASE_URL: process.env.DATABASE_URL,
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
        PORTAL_SECRET_KEY: process.env.PORTAL_SECRET_KEY,
        MEET_AGENT_URL: process.env.MEET_AGENT_URL,
        MEET_AGENT_AUTH_TOKEN: process.env.MEET_AGENT_AUTH_TOKEN,
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
        NEXT_PUBLIC_PORTAL_API_KEY: process.env.NEXT_PUBLIC_PORTAL_API_KEY,
    },
    emptyStringAsUndefined: true,
});
