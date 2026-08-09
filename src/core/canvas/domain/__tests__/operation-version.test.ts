import { describe, expect, it } from "vitest";
import {
    compareOperationVersions,
    isOperationNewer,
} from "@/core/canvas/domain/operation-version";

const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";

describe("shared canvas operation versions", () => {
    it("prefers the later timestamp", () => {
        expect(
            compareOperationVersions(
                {
                    lastOperationAt: "2026-08-09T12:00:01.000Z",
                    lastOperationId: firstId,
                },
                {
                    lastOperationAt: "2026-08-09T12:00:00.000Z",
                    lastOperationId: secondId,
                },
            ),
        ).toBeGreaterThan(0);
    });

    it("uses the larger operation id for an equal timestamp", () => {
        const older = {
            lastOperationAt: "2026-08-09T12:00:00.000Z" as const,
            lastOperationId: firstId,
        };
        const newer = {
            lastOperationAt: "2026-08-09T12:00:00.000Z" as const,
            lastOperationId: secondId,
        };

        expect(compareOperationVersions(newer, older)).toBeGreaterThan(0);
        expect(isOperationNewer(newer, older)).toBe(true);
        expect(isOperationNewer(older, newer)).toBe(false);
        expect(isOperationNewer(newer, newer)).toBe(false);
    });

    it("keeps UUID comparison case-insensitive like the PostgreSQL path", () => {
        const lower = {
            lastOperationAt: "2026-08-09T12:00:00.000Z" as const,
            lastOperationId: "00000000-0000-4000-8000-00000000000a",
        };
        const upper = {
            lastOperationAt: "2026-08-09T12:00:00.000Z" as const,
            lastOperationId: "00000000-0000-4000-8000-00000000000A",
        };

        expect(compareOperationVersions(lower, upper)).toBe(0);
        expect(isOperationNewer(lower, upper)).toBe(false);
    });
});
