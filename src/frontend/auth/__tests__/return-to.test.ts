import { describe, expect, it } from "vitest";
import {
    buildSignInRedirect,
    DEFAULT_RETURN_TO,
    sanitizeReturnTo,
    withReturnTo,
} from "../return-to";

describe("sanitizeReturnTo", () => {
    it("accepts internal paths and preserves query, fragment, and encoding", () => {
        expect(sanitizeReturnTo("/projects/p1/canvas")).toBe(
            "/projects/p1/canvas",
        );
        expect(sanitizeReturnTo("/projects?p=1#canvas")).toBe(
            "/projects?p=1#canvas",
        );
        expect(sanitizeReturnTo("/projects/p1/%2Fcanvas")).toBe(
            "/projects/p1/%2Fcanvas",
        );
    });

    it("falls back for absent, empty, repeated, or unsafe values", () => {
        expect(sanitizeReturnTo(undefined)).toBe(DEFAULT_RETURN_TO);
        expect(sanitizeReturnTo("")).toBe(DEFAULT_RETURN_TO);
        expect(sanitizeReturnTo(["/projects/p1/canvas", "/projects"])).toBe(
            DEFAULT_RETURN_TO,
        );
        expect(sanitizeReturnTo("https://evil.example")).toBe(
            DEFAULT_RETURN_TO,
        );
        expect(sanitizeReturnTo("//evil.example")).toBe(DEFAULT_RETURN_TO);
        expect(sanitizeReturnTo("/projects\\evil")).toBe(DEFAULT_RETURN_TO);
        expect(sanitizeReturnTo("javascript:alert(1)")).toBe(DEFAULT_RETURN_TO);
        expect(sanitizeReturnTo("data:text/html,unsafe")).toBe(
            DEFAULT_RETURN_TO,
        );
    });

    it("rejects control characters that can become protocol-relative URLs", () => {
        expect(sanitizeReturnTo("/\n//evil.example")).toBe(DEFAULT_RETURN_TO);
        expect(sanitizeReturnTo("/\r//evil.example")).toBe(DEFAULT_RETURN_TO);
        expect(sanitizeReturnTo("/\t//evil.example")).toBe(DEFAULT_RETURN_TO);
    });
});

describe("auth return URL helpers", () => {
    it("encodes a destination in the sign-in path", () => {
        expect(buildSignInRedirect("/projects/p1/canvas")).toBe(
            "/auth/sign-in?returnTo=%2Fprojects%2Fp1%2Fcanvas",
        );
        expect(
            buildSignInRedirect("/projects/p1/canvas?tab=nodes#canvas"),
        ).toBe(
            "/auth/sign-in?returnTo=%2Fprojects%2Fp1%2Fcanvas%3Ftab%3Dnodes%23canvas",
        );
        expect(buildSignInRedirect()).toBe("/auth/sign-in");
    });

    it("preserves a non-default destination between auth views", () => {
        expect(withReturnTo("/auth/sign-up", "/projects/p1/canvas")).toBe(
            "/auth/sign-up?returnTo=%2Fprojects%2Fp1%2Fcanvas",
        );
        expect(withReturnTo("/auth/sign-up", DEFAULT_RETURN_TO)).toBe(
            "/auth/sign-up",
        );
        expect(
            withReturnTo("/auth/sign-up?view=compact", "/projects/p1/canvas"),
        ).toBe("/auth/sign-up?view=compact&returnTo=%2Fprojects%2Fp1%2Fcanvas");
    });
});
