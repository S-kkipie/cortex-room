import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "cloudflare:workers": resolve(__dirname, "worker/__tests__/cloudflare-workers.ts"),
        },
    },
    test: {
        environment: "node",
        globals: true,
        include: ["**/__tests__/**/*.test.ts"],
        passWithNoTests: true,
    },
});
