import { viewPaths } from "@better-auth-ui/core";
import { notFound } from "next/navigation";
import { sanitizeReturnTo } from "@/frontend/auth/return-to";
import { Auth } from "@/frontend/components/auth/auth";

// Auth views read live session/query state via `useAuth()`, so this route
// can't be statically prerendered.
export const dynamic = "force-dynamic";

export default async function AuthPage({
    params,
    searchParams,
}: {
    params: Promise<{ path: string }>;
    searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
    const [{ path }, { returnTo }] = await Promise.all([params, searchParams]);
    if (!Object.values(viewPaths.auth).includes(path)) {
        notFound();
    }

    return (
        <main className="flex min-h-svh items-center justify-center p-4">
            <div className="w-full max-w-sm">
                <Auth path={path} redirectTo={sanitizeReturnTo(returnTo)} />
            </div>
        </main>
    );
}
