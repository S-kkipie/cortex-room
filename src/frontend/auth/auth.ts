import { createAuthClient } from "better-auth/react";
import { ClientConfig } from "@/config/client-config";

// In the browser, always talk to the same origin the app is served from.
// Otherwise a fixed NEXT_PUBLIC_APP_URL (localhost) breaks when the app is
// reached through a tunnel/proxy host: the POST goes cross-origin (and
// https→http mixed content) and fails with "failed to fetch". SSR has no
// window, so it falls back to the configured base URL.
const browserBaseUrl =
    typeof window !== "undefined" ? window.location.origin : ClientConfig.baseUrl;

export const authClient = createAuthClient({
    baseURL: browserBaseUrl,
    basePath: "/api/v1/auth",
});
