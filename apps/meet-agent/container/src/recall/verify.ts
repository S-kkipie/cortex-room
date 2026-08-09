// Verifies Recall.ai webhook/websocket signatures (svix-compatible HMAC-SHA256).
// Signed string is `${id}.${timestamp}.${rawBody}`; key is the base64 body of a
// `whsec_`-prefixed secret. Header names may be webhook-* or svix-*.
function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export async function verifyRecallSignature(args: {
    secret: string;
    headers: Record<string, string>;
    rawBody: string | null;
}): Promise<boolean> {
    const { secret, headers, rawBody } = args;
    if (!secret || !secret.startsWith("whsec_")) return false;

    const id = headers["webhook-id"] ?? headers["svix-id"];
    const ts = headers["webhook-timestamp"] ?? headers["svix-timestamp"];
    const sigHeader = headers["webhook-signature"] ?? headers["svix-signature"];
    if (!id || !ts || !sigHeader) return false;

    let keyBytes: Uint8Array;
    try {
        keyBytes = Uint8Array.from(atob(secret.slice("whsec_".length)), (c) => c.charCodeAt(0));
    } catch {
        return false;
    }

    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${rawBody ?? ""}`));
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

    for (const part of sigHeader.split(" ")) {
        const [version, sig] = part.split(",");
        if (version !== "v1" || !sig) continue;
        if (constantTimeEqual(sig, expected)) return true;
    }
    return false;
}
