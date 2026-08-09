import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    signInSocial: vi.fn(),
}));

vi.mock("@better-auth-ui/react", () => ({
    providerIcons: {},
    useAuth: () => ({
        authClient: {},
        baseURL: "https://app.example",
        localization: {
            auth: { continueWith: "Continue with {{provider}}" },
        },
        redirectTo: "/projects",
    }),
    useSignInSocial: () => ({ mutate: mocks.signInSocial }),
}));

vi.mock("@tanstack/react-query", () => ({
    useIsMutating: () => 0,
}));

import { ProviderButton } from "../provider-button";

describe("ProviderButton", () => {
    beforeEach(() => mocks.signInSocial.mockClear());

    it("uses an explicit redirect destination for social sign-in", () => {
        const button = ProviderButton({
            provider: "google",
            redirectTo: "/projects/project-1/canvas",
        });

        button.props.onClick();

        expect(mocks.signInSocial).toHaveBeenCalledWith({
            provider: "google",
            callbackURL:
                "https://app.example/projects/project-1/canvas",
        });
    });
});
