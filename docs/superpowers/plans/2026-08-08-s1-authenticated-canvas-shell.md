# S1 Authenticated Canvas Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build the authenticated, full-screen Canvas entry point with safe auth return URLs, shared-project access, route states, and an `Open canvas` action from Projects.

**Architecture:** Keep the existing owner-only Project domain unchanged. Add a Canvas-specific repository and service that validates project existence by ID after authentication. Place the route under the same Next.js application in the `(workspace)` presentation group so it keeps the root providers but does not inherit the administrative `(app)` header.

**Tech Stack:** Next.js 16 App Router, React 19, Better Auth UI, Drizzle/PostgreSQL, Elysia project conventions, shadcn/ui, Lucide, Vitest, Biome, TypeScript.

## Global Constraints

- `src/app/(workspace)` is a presentation route group inside the same application; it does not change the public URL, deployment, root layout, or global providers.
- S1 does not add packages or modify `package.json`.
- Canvas access requires authentication and validates project existence, but does not require project ownership or active status.
- Project CRUD remains owner-only; do not add `skipOwnership`, `shared`, or similar flags to Project repositories or services.
- Expected service failures return `err(AppErrors.x)` values; route presentation converts not-found to `notFound()` and unexpected failures to the route error boundary.
- `sanitizeReturnTo` accepts only an internal path with exactly one leading slash, rejects `//`, backslashes, arrays, and external schemes, and never decodes a value a second time.
- `SignIn` and `SignUp` use the sanitized return path; all other authentication flows preserve their existing behavior.
- The Canvas shell has no React Flow, Portal, element persistence, realtime state, toolbar, zoom controls, or element interactions.
- Use `apply_patch` for source edits. Do not commit unless the user explicitly requests a commit.

---

### Task 1: Safe Auth Return Path

**Files:**
- Create: `src/frontend/auth/return-to.ts`
- Create: `src/frontend/auth/__tests__/return-to.test.ts`
- Modify: `src/server/auth/require-auth.ts`
- Modify: `src/app/auth/[path]/page.tsx`
- Modify: `src/frontend/components/auth/auth.tsx`
- Modify: `src/frontend/components/auth/sign-in.tsx`
- Modify: `src/frontend/components/auth/sign-up.tsx`

**Interfaces:**
- Produces `DEFAULT_RETURN_TO: "/projects"`.
- Produces `sanitizeReturnTo(value: string | string[] | undefined): string`.
- Produces `buildSignInRedirect(returnTo?: string): string`.
- Produces `withReturnTo(path: string, returnTo: string): string`.
- `requireAuth(returnTo?: string)` keeps `/auth/sign-in` when no destination is passed and uses `buildSignInRedirect` when one is passed.
- `Auth`, `SignIn`, and `SignUp` accept `redirectTo?: string`; absent values fall back to the Better Auth provider's current `redirectTo`.

- [ ] **Step 1: Write failing helper tests**

Create `return-to.test.ts` with these exact cases:

```ts
import { describe, expect, it } from "vitest";
import {
    DEFAULT_RETURN_TO,
    buildSignInRedirect,
    sanitizeReturnTo,
    withReturnTo,
} from "../return-to";

describe("sanitizeReturnTo", () => {
    it("accepts internal paths", () => {
        expect(sanitizeReturnTo("/projects/p1/canvas")).toBe(
            "/projects/p1/canvas",
        );
        expect(sanitizeReturnTo("/projects?p=1#canvas")).toBe(
            "/projects?p=1#canvas",
        );
    });

    it("falls back for absent, repeated, or unsafe values", () => {
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
        expect(sanitizeReturnTo("javascript:alert(1)")).toBe(
            DEFAULT_RETURN_TO,
        );
    });
});

describe("auth return URL helpers", () => {
    it("encodes a canvas destination in the sign-in path", () => {
        expect(buildSignInRedirect("/projects/p1/canvas")).toBe(
            "/auth/sign-in?returnTo=%2Fprojects%2Fp1%2Fcanvas",
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
    });
});
```

- [ ] **Step 2: Run the helper tests and verify RED**

Run:

```bash
pnpm test -- src/frontend/auth/__tests__/return-to.test.ts
```

Expected: FAIL because `../return-to` does not exist.

- [ ] **Step 3: Implement the pure helpers**

Create `return-to.ts`:

```ts
export const DEFAULT_RETURN_TO = "/projects";

export function sanitizeReturnTo(
    value: string | string[] | undefined,
): string {
    if (
        typeof value !== "string" ||
        value.length === 0 ||
        !value.startsWith("/") ||
        value.startsWith("//") ||
        value.includes("\\")
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
```

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run the same targeted Vitest command. Expected: all helper tests pass.

- [ ] **Step 5: Add the optional return path to the auth guard**

Update `require-auth.ts` so it imports `buildSignInRedirect` and uses:

```ts
export async function requireAuth(returnTo?: string) {
    const session = await authenticate();
    if (!session) redirect(buildSignInRedirect(returnTo));
    return session;
}
```

The no-argument call still redirects to exactly `/auth/sign-in`.

- [ ] **Step 6: Thread the sanitized path through the auth route and views**

Update the auth page props to include Next's query promise and render:

```tsx
export default async function AuthPage({
    params,
    searchParams,
}: {
    params: Promise<{ path: string }>;
    searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
    const [{ path }, { returnTo }] = await Promise.all([
        params,
        searchParams,
    ]);
    if (!Object.values(viewPaths.auth).includes(path)) {
        notFound();
    }

    return (
        <main className="flex min-h-svh items-center justify-center p-4">
            <div className="w-full max-w-sm">
                <Auth
                    path={path}
                    redirectTo={sanitizeReturnTo(returnTo)}
                />
            </div>
        </main>
    );
}
```

In `Auth`, rename the provider value to `providerRedirectTo`, add `redirectTo?: string` to `AuthProps`, resolve `redirectToOverride ?? providerRedirectTo`, and pass the resolved override to the selected built-in or plugin view.

In `SignIn` and `SignUp`:

- add `redirectTo?: string` to the props;
- resolve `redirectToOverride ?? providerRedirectTo` from `useAuth()`;
- use the resolved value in the successful navigation callback;
- wrap the sign-in/sign-up links with `withReturnTo` so a canvas destination survives switching views;
- leave forgot password, reset password, and verification behavior unchanged.

- [ ] **Step 7: Run auth-focused verification**

Run:

```bash
pnpm test -- src/frontend/auth/__tests__/return-to.test.ts
pnpm typecheck
```

Expected: targeted tests pass and TypeScript reports no errors.

---

### Task 2: Canvas Project Access Service

**Files:**
- Create: `src/core/canvas/server/repository/find-project-for-canvas-by-id.ts`
- Create: `src/core/canvas/server/services/get-canvas-project-service.ts`
- Create: `src/core/canvas/server/services/__tests__/get-canvas-project-service.test.ts`

**Interfaces:**
- `findProjectForCanvasById(id: string): Promise<ProjectRow | null>` queries `projects` by ID only.
- `getCanvasProjectService(id: string): AsyncAppResult<Project>` maps the row through the existing `toProject` converter.

- [ ] **Step 1: Write failing service tests**

Mock the repository module before importing the service. Use a row with `userId: "owner-1"`, `status: "active"`, and ISO-convertible `Date` values. Add these tests:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/find-project-for-canvas-by-id", () => ({
    findProjectForCanvasById: vi.fn(),
}));

import { findProjectForCanvasById } from "../../repository/find-project-for-canvas-by-id";
import { getCanvasProjectService } from "../get-canvas-project-service";

const activeRow = {
    id: "project-1",
    userId: "owner-1",
    name: "Shared canvas",
    description: null,
    status: "active" as const,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

describe("getCanvasProjectService", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns an existing project without an owner argument", async () => {
        vi.mocked(findProjectForCanvasById).mockResolvedValue(activeRow);

        const result = await getCanvasProjectService("project-1");

        expect(findProjectForCanvasById).toHaveBeenCalledWith("project-1");
        expect(result).toEqual({
            ok: true,
            data: expect.objectContaining({
                id: "project-1",
                name: "Shared canvas",
            }),
        });
    });

    it("allows archived projects", async () => {
        vi.mocked(findProjectForCanvasById).mockResolvedValue({
            ...activeRow,
            status: "archived",
        });

        const result = await getCanvasProjectService("project-1");

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.status).toBe("archived");
    });

    it("returns not found when the project is absent", async () => {
        vi.mocked(findProjectForCanvasById).mockResolvedValue(null);

        const result = await getCanvasProjectService("missing");

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });

    it("converts repository failures to an unexpected error value", async () => {
        vi.mocked(findProjectForCanvasById).mockRejectedValue(
            new Error("database unavailable"),
        );

        const result = await getCanvasProjectService("project-1");

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("INTERNAL_SERVER_ERROR");
    });
});
```

- [ ] **Step 2: Run the service tests and verify RED**

Run:

```bash
pnpm test -- src/core/canvas/server/services/__tests__/get-canvas-project-service.test.ts
```

Expected: FAIL because the repository and service do not exist.

- [ ] **Step 3: Implement the Canvas-only repository**

Create the server-only repository with no `userId` parameter:

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import {
    type ProjectRow,
    projects,
} from "@/server/drizzle/schemas/project-schema";

export async function findProjectForCanvasById(
    id: string,
): Promise<ProjectRow | null> {
    const [row] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1);

    return row ?? null;
}
```

- [ ] **Step 4: Implement the service**

Create `get-canvas-project-service.ts`:

```ts
import "server-only";
import type { Project } from "@/core/project/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { findProjectForCanvasById } from "../repository/find-project-for-canvas-by-id";
import { toProject } from "@/core/project/server/repository/utils";

export async function getCanvasProjectService(
    id: string,
): AsyncAppResult<Project> {
    try {
        const row = await findProjectForCanvasById(id);
        if (!row) return err(AppErrors.notFound({ targets: ["projectId"] }));
        return ok(toProject(row));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
```

- [ ] **Step 5: Run the service tests and verify GREEN**

Run the targeted service command again. Expected: all four tests pass.

---

### Task 3: Shared Sign-Out And Full-Screen Shell

**Files:**
- Create: `src/frontend/components/auth/sign-out-button.tsx`
- Modify: `src/app/(app)/sign-out-button.tsx`
- Create: `src/core/canvas/client/ui/canvas-shell.tsx`

**Interfaces:**
- Shared `SignOutButton` remains a client component and preserves the current sign-out behavior.
- `CanvasShell({ projectName, userLabel }: { projectName: string; userLabel: string })` renders only the presentation shell and does not own canvas state.

- [ ] **Step 1: Extract the existing sign-out behavior**

Move the current implementation from `(app)/sign-out-button.tsx` into the shared auth component without changing its behavior:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/frontend/auth/auth";
import { Button } from "@/frontend/components/ui/button";

export function SignOutButton() {
    const router = useRouter();

    return (
        <Button
            variant="outline"
            size="sm"
            onClick={async () => {
                await authClient.signOut();
                router.push("/auth/sign-in");
            }}
        >
            Sign out
        </Button>
    );
}
```

Replace the old route-local file with:

```ts
export { SignOutButton } from "@/frontend/components/auth/sign-out-button";
```

- [ ] **Step 2: Create the Canvas shell**

Create a server-compatible component that uses `Link`, the shared `SignOutButton`, and existing shadcn `Button` styles. The component must:

- occupy `min-h-svh`;
- render a compact header with a Projects link, a truncable project name, the user label, and sign-out;
- render a neutral main region announcing that the workspace is ready for canvas tools;
- keep essential actions visible at narrow widths;
- not render fake toolbar, zoom, or element controls.

Use this shape:

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/frontend/components/ui/button";
import { SignOutButton } from "@/frontend/components/auth/sign-out-button";

type CanvasShellProps = {
    projectName: string;
    userLabel: string;
};

export function CanvasShell({
    projectName,
    userLabel,
}: CanvasShellProps) {
    return (
        <div className="flex min-h-svh flex-col bg-muted/20">
            <header className="flex min-h-14 items-center gap-3 border-b bg-background px-4 py-2 sm:px-6">
                <Button asChild variant="ghost" size="sm" className="shrink-0">
                    <Link href="/projects">
                        <ArrowLeft />
                        <span className="hidden sm:inline">Projects</span>
                    </Link>
                </Button>
                <div className="min-w-0 flex-1">
                    <p className="text-muted-foreground text-xs uppercase tracking-wide">
                        Workspace
                    </p>
                    <h1 className="truncate font-semibold text-sm">
                        {projectName}
                    </h1>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <span className="hidden max-w-40 truncate text-muted-foreground text-sm md:inline">
                        {userLabel}
                    </span>
                    <SignOutButton />
                </div>
            </header>
            <main className="flex min-h-0 flex-1 items-center justify-center p-4">
                <section className="w-full max-w-md rounded-xl border border-dashed bg-background p-8 text-center shadow-sm">
                    <h2 className="font-semibold text-lg">Workspace ready</h2>
                    <p className="mt-2 text-muted-foreground text-sm">
                        Canvas tools will appear here.
                    </p>
                </section>
            </main>
        </div>
    );
}
```

- [ ] **Step 3: Run typecheck for the shell changes**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

---

### Task 4: Workspace Route And Route States

**Files:**
- Create: `src/app/(workspace)/projects/[projectId]/canvas/page.tsx`
- Create: `src/app/(workspace)/projects/[projectId]/canvas/loading.tsx`
- Create: `src/app/(workspace)/projects/[projectId]/canvas/error.tsx`
- Create: `src/app/(workspace)/projects/[projectId]/canvas/not-found.tsx`

**Interfaces:**
- Public URL remains `/projects/[projectId]/canvas`.
- The route inherits the root layout/providers but not `(app)/layout.tsx`.
- `page.tsx` authenticates before querying the project and passes only the project name and authenticated user label to the shell.

- [ ] **Step 1: Create the server page**

Implement the page with this control flow:

```tsx
import { notFound } from "next/navigation";
import { CanvasShell } from "@/core/canvas/client/ui/canvas-shell";
import { getCanvasProjectService } from "@/core/canvas/server/services/get-canvas-project-service";
import { requireAuth } from "@/server/auth/require-auth";

export default async function CanvasPage({
    params,
}: {
    params: Promise<{ projectId: string }>;
}) {
    const { projectId } = await params;
    const session = await requireAuth(`/projects/${projectId}/canvas`);
    const result = await getCanvasProjectService(projectId);

    if (!result.ok) {
        if (result.error.type === "NotFoundError") notFound();
        throw new Error("Unable to load the canvas project");
    }

    const userLabel = session.user.name?.trim() || session.user.email;

    return (
        <CanvasShell
            projectName={result.data.name}
            userLabel={userLabel}
        />
    );
}
```

- [ ] **Step 2: Add the loading state**

Create `loading.tsx` with a full-height shell-shaped loading surface using the existing `Skeleton` component. It must show header and main-region loading affordances and must not present the ready state.

- [ ] **Step 3: Add the not-found state**

Create `not-found.tsx` with a centered `Canvas not found` heading, a short non-disclosing explanation, and a `Button asChild` link to `/projects`.

- [ ] **Step 4: Add the error boundary**

Create a `"use client"` `error.tsx` receiving `{ reset }: { error: Error; reset: () => void }`. Render a non-technical failure message, a `Retry` button calling `reset`, and a `Back to projects` link. Do not render `error.message` or infrastructure causes.

- [ ] **Step 5: Run the route compilation checks**

Run:

```bash
pnpm typecheck
pnpm check
```

Expected: both commands pass.

---

### Task 5: Open Canvas From Projects

**Files:**
- Modify: `src/core/project/client/ui/table/columns.tsx`

**Interfaces:**
- The first menu item in each project row is an `Open canvas` link to `/projects/{id}/canvas`.
- Existing `Edit` and `Delete` actions remain unchanged.
- The new action does not use `DataTableRowAction` and does not add a table column.

- [ ] **Step 1: Add the navigation item**

Import `Link` from `next/link`. In the existing dropdown content, add before `Edit`:

```tsx
<DropdownMenuItem asChild>
    <Link href={`/projects/${row.original.id}/canvas`}>
        Open canvas
    </Link>
</DropdownMenuItem>
```

Keep the separator before `Delete` in its existing position.

- [ ] **Step 2: Run the table and project checks**

Run:

```bash
pnpm typecheck
pnpm check
```

Expected: both commands pass.

---

### Task 6: Full Verification And Manual Acceptance

**Files:**
- No source changes unless a verification failure identifies a concrete defect.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
pnpm test
```

Expected: all existing S0 tests, auth helper tests, and Canvas service tests pass.

- [ ] **Step 2: Run static checks**

Run:

```bash
pnpm typecheck
pnpm check
```

Expected: both exit successfully with no diagnostics.

- [ ] **Step 3: Run the production build**

Run:

```bash
pnpm build
```

Expected: Next.js production build completes successfully.

- [ ] **Step 4: Perform the manual route matrix**

With the app running and authenticated test accounts available, verify:

1. `/projects` row menu opens `/projects/{id}/canvas` through `Open canvas`.
2. An anonymous deep link redirects to `/auth/sign-in?returnTo=...`.
3. Successful sign-in returns to the exact canvas URL.
4. Switching from sign-in to sign-up preserves the canvas destination.
5. A malicious `returnTo` such as `https://evil.example` falls back to `/projects`.
6. An authenticated user can open another user's existing project.
7. An archived project opens normally.
8. A missing project renders `Canvas not found`.
9. A forced repository failure renders the retry/back error state.
10. Desktop and narrow mobile viewports keep Projects and Sign out usable without horizontal overflow.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: only the S1 implementation, its tests, the approved S1 spec, and this plan are present; no generated secrets or unrelated files are changed.

## Spec Coverage Review

- Authenticated deep link and safe return path: Task 1 and Task 4.
- Sign-in and sign-up return behavior: Task 1.
- Canvas-specific non-owner project access: Task 2 and Task 4.
- Active and archived projects: Task 2 and manual matrix.
- Full-screen same-application `(workspace)` route group: Task 4.
- Loading, not-found, and unexpected-error states: Task 4.
- Shell identity, navigation, sign-out, and responsive behavior: Task 3 and Task 6.
- Projects table `Open canvas` action: Task 5.
- No React Flow, Portal, persistence, or package changes: Global Constraints and every implementation task.
- Automated quality commands: Task 6.
