import "server-only";
import { redirect } from "next/navigation";
import { buildSignInRedirect } from "@/frontend/auth/return-to";
import { authenticate } from "./auth";

/** Page guard for protected server components. `redirect` throws, so the
 *  return is always a non-null session. */
export async function requireAuth(returnTo?: string) {
    const session = await authenticate();
    if (!session) redirect(buildSignInRedirect(returnTo));
    return session;
}
