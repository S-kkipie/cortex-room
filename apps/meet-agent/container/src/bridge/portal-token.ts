import { canvasPortalChannelId } from "../../../../../src/core/canvas/domain/portal-channel";

const PORTAL_API_URL = "https://api.useportal.co";
const BOT_USER_ID = "meet-agent";
const BOT_LABEL = "Meet Agent";
const TOKEN_TTL = "1h";

/**
 * Mint a Portal access token for the bridge bot, scoped to a project's canvas
 * channel with connect+publish rights. Mirrors the web app's
 * getPortalTokenService so both sides authenticate against the same channel
 * (`room-{projectId}`) with the same secret-key flow — the canvas channel is
 * token-gated, so an anonymous publish would be rejected.
 */
export async function mintPortalToken(opts: {
    secretKey: string;
    projectId: string;
    userId?: string;
    userLabel?: string;
    ttl?: string;
    apiUrl?: string;
    fetchImpl?: typeof fetch;
}): Promise<string> {
    const doFetch = opts.fetchImpl ?? fetch;
    const channelId = canvasPortalChannelId(opts.projectId);
    const res = await doFetch(`${opts.apiUrl ?? PORTAL_API_URL}/v1/tokens`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${opts.secretKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            userId: opts.userId ?? BOT_USER_ID,
            claims: { username: opts.userLabel ?? BOT_LABEL },
            channels: { [channelId]: ["connect", "publish"] },
            ttl: opts.ttl ?? TOKEN_TTL,
        }),
    });
    if (!res.ok) throw new Error(`portal token request failed (${res.status})`);
    const data = (await res.json()) as { token?: string };
    if (!data.token) throw new Error("portal token response missing token");
    return data.token;
}
