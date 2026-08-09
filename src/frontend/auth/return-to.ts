export const DEFAULT_RETURN_TO = "/projects";

function containsUnsafeControlCharacter(value: string): boolean {
    return Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
    });
}

export function sanitizeReturnTo(value: string | string[] | undefined): string {
    if (
        typeof value !== "string" ||
        value.length === 0 ||
        !value.startsWith("/") ||
        value.startsWith("//") ||
        value.includes("\\") ||
        containsUnsafeControlCharacter(value)
    ) {
        return DEFAULT_RETURN_TO;
    }

    return value;
}

export function buildSignInRedirect(returnTo?: string): string {
    if (!returnTo) return "/auth/sign-in";

    const params = new URLSearchParams({
        returnTo: sanitizeReturnTo(returnTo),
    });

    return `/auth/sign-in?${params.toString()}`;
}

export function withReturnTo(path: string, returnTo: string): string {
    const safeReturnTo = sanitizeReturnTo(returnTo);
    if (safeReturnTo === DEFAULT_RETURN_TO) return path;

    const separator = path.includes("?") ? "&" : "?";
    const params = new URLSearchParams({ returnTo: safeReturnTo });

    return `${path}${separator}${params.toString()}`;
}
