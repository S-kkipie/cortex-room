import { describe, expect, it, vi } from "vitest";

const edenMocks = vi.hoisted(() => ({
    treaty: vi.fn(() => ({})),
    createEdenTanStackQuery: vi.fn(() => ({
        EdenProvider: vi.fn(),
        useEden: vi.fn(),
    })),
}));

vi.mock("@elysiajs/eden", () => ({ treaty: edenMocks.treaty }));
vi.mock("eden-tanstack-react-query", () => ({
    createEdenTanStackQuery: edenMocks.createEdenTanStackQuery,
}));
vi.mock("@/config/client-config", () => ({
    ClientConfig: { baseUrl: "http://localhost:3000" },
}));

import "@/frontend/lib/eden";

describe("Eden client", () => {
    it("keeps wire timestamps as ISO strings", () => {
        expect(edenMocks.treaty).toHaveBeenCalledWith("http://localhost:3000", {
            parseDate: false,
        });
    });
});
