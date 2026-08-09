import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ["pg"],
    // Dev is often reached through a tunnel/proxy host (WSL, cloud IDE),
    // not localhost. Without this, Next blocks cross-origin dev resources
    // and client JS never hydrates — auth forms then fall back to a native
    // GET submit and never sign in. Allow the proxy hosts used here.
    allowedDevOrigins: [
        "xorseus-1.pirulines.net",
        "*.pirulines.net",
        "10.255.255.254",
    ],
};

export default nextConfig;
