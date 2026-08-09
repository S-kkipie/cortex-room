# S9 Acceptance and Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the collaborative canvas release gate with controller acceptance coverage, real PostgreSQL integration coverage, quality checks, and the complete two-session PRD demonstration.

**Architecture:** Add one black-box controller acceptance test that connects two real `createCanvasActions` instances through observable in-memory persistence and realtime ports. Expand the existing PostgreSQL repository integration test to exercise the complete permanent command lifecycle; production code changes are allowed only when a new acceptance test exposes a P0 blocker.

**Tech Stack:** TypeScript, Vitest 3, Zod 4, React 19, Next.js 16, Drizzle ORM, PostgreSQL, Portal, Biome

## Global Constraints

- Do not add Playwright or any other E2E dependency or project infrastructure.
- Do not add product features, contracts, or architecture changes.
- Do not modify any file under `apps/meet-agent/`.
- Use `CANVAS_TEST_DATABASE_URL` only with an isolated test database; never point it at the application or production database.
- Do not commit screenshots, videos, or a permanent demo evidence report.
- Fix only defects that block a P0 criterion or a Canvas quality gate.
- Keep Zod schemas as the only domain type source and do not re-export domain types.
- Preserve the `CommonResponse` envelope, Result-valued expected errors, and both authentication declarations on authenticated routes.
- Review `GEMINI.md` and `docs/code-review/README.md` before each code review gate.

---

## File Map

- Create `src/core/canvas/client/controller/__tests__/canvas-acceptance.test.ts`: black-box two-controller acceptance scenario for the permanent action pipeline, reload, and ephemeral-state isolation.
- Modify `src/core/canvas/server/repository/__tests__/apply-canvas-command.integration.test.ts`: real PostgreSQL lifecycle covering all permanent commands, stale rejection, snapshot state, tombstone, and non-resurrection.
- Modify production Canvas files only if one of the new tests exposes a blocking defect. Keep any such fix in the existing file that owns the failed behavior and add the narrow regression assertion to the test that exposed it.
- Do not create a demo evidence file; report the manual result in the execution session.

---

### Task 1: Two-Controller Acceptance Coverage

**Files:**
- Create: `src/core/canvas/client/controller/__tests__/canvas-acceptance.test.ts`
- Reference: `src/core/canvas/client/controller/canvas-controller.ts`
- Reference: `src/core/canvas/client/controller/reconcile-canvas-record.ts`

**Interfaces:**
- Consumes: `createCanvasActions(dependencies): CanvasActions`, `CanvasTransport`, `CanvasSnapshotPort`, `CanvasSelectionPort`, `CanvasRealtimePort`, and `reconcileCanvasRecord(snapshot, record): CanvasSnapshot`.
- Produces: one acceptance test proving the complete `A -> persistence -> final Portal message -> B -> reload` pipeline.

- [ ] **Step 1: Create the two-controller acceptance test**

Create `src/core/canvas/client/controller/__tests__/canvas-acceptance.test.ts` with this complete test harness:

```ts
import { describe, expect, it } from "vitest";
import {
    type CanvasActions,
    type CanvasSelectionPort,
    type CanvasSnapshotPort,
    type CanvasTransport,
    createCanvasActions,
} from "@/core/canvas/client/controller/canvas-controller";
import { reconcileCanvasRecord } from "@/core/canvas/client/controller/reconcile-canvas-record";
import type { CanvasRealtimePort } from "@/core/canvas/client/portal/canvas-portal-events";
import type {
    CanvasCommand,
    CanvasMutationResult,
    CanvasSnapshot,
} from "@/core/canvas/domain/types";

const projectId = "00000000-0000-4000-8000-000000000001";
const elementId = "00000000-0000-4000-8000-000000000002";
const ids = [
    elementId,
    "00000000-0000-4000-8000-000000000003",
    "00000000-0000-4000-8000-000000000004",
    "00000000-0000-4000-8000-000000000005",
    "00000000-0000-4000-8000-000000000006",
    "00000000-0000-4000-8000-000000000007",
    "00000000-0000-4000-8000-000000000008",
    "00000000-0000-4000-8000-000000000009",
    "00000000-0000-4000-8000-000000000010",
];
const times = [
    "2026-08-09T12:00:00.000Z",
    "2026-08-09T12:00:01.000Z",
    "2026-08-09T12:00:02.000Z",
    "2026-08-09T12:00:03.000Z",
    "2026-08-09T12:00:04.000Z",
    "2026-08-09T12:00:05.000Z",
    "2026-08-09T12:00:06.000Z",
    "2026-08-09T12:00:07.000Z",
];

function emptySnapshot(): CanvasSnapshot {
    return { projectId, elements: [], tombstones: [] };
}

function unavailableTransport(): CanvasTransport {
    const unavailable = async (): Promise<CanvasMutationResult> => {
        throw new Error("Transport is not available for this client");
    };
    return {
        create: unavailable,
        update: unavailable,
        delete: unavailable,
    };
}

function createClient(options: {
    userId: string;
    initialSnapshot?: CanvasSnapshot;
    ids?: string[];
    times?: string[];
    realtime?: CanvasRealtimePort;
    transportFactory?: (read: () => CanvasSnapshot) => CanvasTransport;
}) {
    let snapshot = structuredClone(options.initialSnapshot ?? emptySnapshot());
    let selection: string[] = [];
    const queuedIds = [...(options.ids ?? [])];
    const queuedTimes = [...(options.times ?? [])];
    const state: CanvasSnapshotPort = {
        read: () => snapshot,
        write: (updater) => {
            snapshot = updater(snapshot);
        },
    };
    const selectionPort: CanvasSelectionPort = {
        read: () => selection,
        write: (elementIds) => {
            selection = [...elementIds];
        },
    };
    const read = () => snapshot;
    const actions = createCanvasActions({
        projectId,
        userId: options.userId,
        state,
        selection: selectionPort,
        transport:
            options.transportFactory?.(read) ?? unavailableTransport(),
        realtime: options.realtime,
        idFactory: () =>
            queuedIds.shift() ?? "00000000-0000-4000-8000-000000000099",
        now: () => queuedTimes.shift() ?? "2026-08-09T12:00:09.000Z",
    });

    return { actions, read };
}

describe("canvas collaborative acceptance", () => {
    it("converges two clients through every permanent action and reload", async () => {
        let persisted = emptySnapshot();
        const persistentKinds: string[] = [];
        const clientB = createClient({ userId: "user-b" });
        let remoteActions: CanvasActions = clientB.actions;
        const realtime: CanvasRealtimePort = {
            publishPersistent: async (message) => {
                persistentKinds.push(message.content.kind);
                remoteActions.applyRemoteMessage(message);
            },
            publishEphemeral: async (message) => {
                remoteActions.applyRemoteMessage(message);
            },
        };
        const clientA = createClient({
            userId: "user-a",
            ids,
            times,
            realtime,
            transportFactory: (read) => {
                const persist = async (
                    command: CanvasCommand,
                ): Promise<CanvasMutationResult> => {
                    const current = read();
                    const targetId =
                        command.kind === "workspace.element.create"
                            ? command.element.id
                            : command.elementId;
                    const record =
                        current.elements.find(({ id }) => id === targetId) ??
                        current.tombstones.find(({ id }) => id === targetId);
                    if (!record)
                        throw new Error("Expected optimistic canvas record");
                    persisted = reconcileCanvasRecord(persisted, record);
                    return { applied: true, record };
                };

                return {
                    create: persist,
                    update: persist,
                    delete: persist,
                };
            },
        });

        await clientA.actions.createElement({
            type: "STICKY",
            content: "Initial",
            x: 10,
            y: 20,
            width: 240,
            height: 180,
        });
        expect(clientB.actions.getElement(elementId)).toMatchObject({
            content: "Initial",
            x: 10,
            y: 20,
        });

        await clientA.actions.updateElement(elementId, { content: "Final" });
        await clientA.actions.moveElement(elementId, { x: 80, y: 90 });
        await clientA.actions.resizeElement(elementId, {
            width: 320,
            height: 220,
        });
        expect(clientB.actions.getElement(elementId)).toMatchObject({
            content: "Final",
            x: 80,
            y: 90,
            width: 320,
            height: 220,
        });

        await clientA.actions.deleteElement(elementId);
        expect(clientB.actions.getElements()).toEqual([]);
        expect(clientB.read().tombstones).toHaveLength(1);
        expect(persistentKinds).toEqual([
            "workspace.element.created.final",
            "workspace.element.updated.final",
            "workspace.element.moved.final",
            "workspace.element.resized.final",
            "workspace.element.deleted.final",
        ]);

        const durableState = structuredClone(persisted);
        clientA.actions.publishCursor({ x: 12, y: 34 });
        clientA.actions.publishSelection([elementId]);
        clientA.actions.publishMovePreview(elementId, { x: 100, y: 110 });
        expect(persisted).toEqual(durableState);
        expect(clientB.read()).toEqual(durableState);

        const reloaded = createClient({
            userId: "user-c",
            initialSnapshot: persisted,
        });
        remoteActions = reloaded.actions;
        expect(reloaded.actions.getElements()).toEqual([]);
        expect(reloaded.read().tombstones).toEqual(persisted.tombstones);
    });
});
```

- [ ] **Step 2: Run the focused acceptance test**

Run:

```bash
pnpm vitest run src/core/canvas/client/controller/__tests__/canvas-acceptance.test.ts
```

Expected: one test passes. This is release characterization coverage over existing behavior, so no production change is expected. If it fails, preserve the failing assertion, invoke `superpowers:systematic-debugging`, identify the production owner of the mismatch, and make only the minimal Canvas fix required by the approved S9 acceptance criterion.

- [ ] **Step 3: Run the complete controller and Portal suites**

Run:

```bash
pnpm vitest run src/core/canvas/client/controller src/core/canvas/client/portal
```

Expected: all controller and Portal test files pass with no skipped tests.

- [ ] **Step 4: Run the Canvas formatter gate**

Run:

```bash
pnpm exec biome check src/core/canvas/client/controller/__tests__/canvas-acceptance.test.ts
```

Expected: `Checked 1 file` and no diagnostics. If formatting differs, run `pnpm exec biome check --write src/core/canvas/client/controller/__tests__/canvas-acceptance.test.ts`, inspect the diff, and rerun the check.

- [ ] **Step 5: Review and commit the controller acceptance coverage**

Review `GEMINI.md`, `docs/code-review/README.md`, the test diff, and the focused test output. Then run:

```bash
git add src/core/canvas/client/controller/__tests__/canvas-acceptance.test.ts
git commit -m "test(canvas): cover collaborative acceptance flow"
```

Expected: one commit containing only the acceptance test, plus a minimal blocking production fix if the test exposed one.

---

### Task 2: Complete PostgreSQL Lifecycle Coverage

**Files:**
- Modify: `src/core/canvas/server/repository/__tests__/apply-canvas-command.integration.test.ts:18-116`
- Reference: `src/core/canvas/server/repository/apply-canvas-command.ts`
- Reference: `src/core/canvas/server/repository/find-canvas-snapshot-rows.ts`

**Interfaces:**
- Consumes: `applyCanvasCommand(command, actorId, database): Promise<ApplyCanvasCommandResult>` and `findCanvasSnapshotRows(projectId, database)`.
- Produces: one real-database test proving create, update, move, resize, stale rejection, active snapshot, delete, tombstone, and non-resurrection.

- [ ] **Step 1: Make operation timestamps deterministic within the integration test**

Replace the current timestamp helper with:

```ts
const operationBase = Date.now();

function timestamp(offsetMs: number): string {
    return new Date(operationBase + offsetMs).toISOString();
}
```

This preserves strict operation ordering even when database calls take longer than expected.

- [ ] **Step 2: Replace the partial lifecycle test with the complete lifecycle**

Replace the existing `it("persists create...` block with:

```ts
it("persists the full lifecycle and prevents stale resurrection", async () => {
    const createResult = await applyCanvasCommand(
        {
            kind: "workspace.element.create",
            eventId: randomUUID(),
            projectId,
            occurredAt: timestamp(-6_000),
            element: {
                id: elementId,
                type: "STICKY",
                content: "persisted",
                x: 10,
                y: 20,
                width: 240,
                height: 160,
            },
        },
        userId,
        testDb,
    );
    expect(createResult.kind).toBe("applied");

    const updateResult = await applyCanvasCommand(
        {
            kind: "workspace.element.update",
            eventId: randomUUID(),
            projectId,
            occurredAt: timestamp(-5_000),
            elementId,
            content: "updated",
        },
        userId,
        testDb,
    );
    expect(updateResult.kind).toBe("applied");

    const moveResult = await applyCanvasCommand(
        {
            kind: "workspace.element.move",
            eventId: randomUUID(),
            projectId,
            occurredAt: timestamp(-4_000),
            elementId,
            x: 80,
            y: 90,
        },
        userId,
        testDb,
    );
    expect(moveResult.kind).toBe("applied");

    const resizeResult = await applyCanvasCommand(
        {
            kind: "workspace.element.resize",
            eventId: randomUUID(),
            projectId,
            occurredAt: timestamp(-3_000),
            elementId,
            width: 320,
            height: 220,
        },
        userId,
        testDb,
    );
    expect(resizeResult.kind).toBe("applied");

    const staleResult = await applyCanvasCommand(
        {
            kind: "workspace.element.update",
            eventId: randomUUID(),
            projectId,
            occurredAt: timestamp(-7_000),
            elementId,
            content: "stale",
        },
        userId,
        testDb,
    );
    expect(staleResult.kind).toBe("stale");

    const activeSnapshot = await findCanvasSnapshotRows(projectId, testDb);
    expect(activeSnapshot.kind).toBe("found");
    if (activeSnapshot.kind === "found") {
        expect(activeSnapshot.rows).toHaveLength(1);
        expect(activeSnapshot.rows[0]).toMatchObject({
            content: "updated",
            x: 80,
            y: 90,
            width: 320,
            height: 220,
            deletedAt: null,
        });
    }

    const deleteResult = await applyCanvasCommand(
        {
            kind: "workspace.element.delete",
            eventId: randomUUID(),
            projectId,
            occurredAt: timestamp(-1_000),
            elementId,
        },
        userId,
        testDb,
    );
    expect(deleteResult.kind).toBe("applied");

    const resurrectionResult = await applyCanvasCommand(
        {
            kind: "workspace.element.move",
            eventId: randomUUID(),
            projectId,
            occurredAt: timestamp(-2_000),
            elementId,
            x: 500,
            y: 500,
        },
        userId,
        testDb,
    );
    expect(resurrectionResult.kind).toBe("stale");

    const deletedSnapshot = await findCanvasSnapshotRows(projectId, testDb);
    expect(deletedSnapshot.kind).toBe("found");
    if (deletedSnapshot.kind === "found") {
        expect(deletedSnapshot.rows).toHaveLength(1);
        expect(deletedSnapshot.rows[0]?.deletedAt).not.toBeNull();
        expect(deletedSnapshot.rows[0]).not.toMatchObject({ x: 500, y: 500 });
    }
});
```

- [ ] **Step 3: Verify the test database variable is isolated**

Confirm that `CANVAS_TEST_DATABASE_URL` is present in the shell used for tests and that its database name differs from `DATABASE_URL`. Do not print either full connection string or its credentials.

Run this PowerShell-safe check:

```powershell
if (-not $env:CANVAS_TEST_DATABASE_URL) { throw "CANVAS_TEST_DATABASE_URL is not set" }
$app = if ($env:DATABASE_URL) { ([Uri]$env:DATABASE_URL).AbsolutePath } else { "<unset>" }
$test = ([Uri]$env:CANVAS_TEST_DATABASE_URL).AbsolutePath
if ($app -eq $test) { throw "Canvas integration database must differ from the application database" }
"Canvas test database is configured separately"
```

Expected: `Canvas test database is configured separately`. If the test URL is absent, create an isolated database first and set the variable only in the local/CI test environment; do not add it to production configuration.

- [ ] **Step 4: Run the PostgreSQL integration test**

Run:

```bash
pnpm test:canvas:integration
```

Expected: one test passes and zero tests are skipped. If it fails, preserve the database state and failure output long enough to invoke `superpowers:systematic-debugging`; do not weaken an LWW assertion to make it pass.

- [ ] **Step 5: Run repository unit tests and formatting**

Run:

```bash
pnpm vitest run src/core/canvas/server/repository
pnpm exec biome check src/core/canvas/server/repository/__tests__/apply-canvas-command.integration.test.ts
```

Expected: all repository unit tests pass; the integration file has no Biome diagnostics. The integration test may be skipped in the first command if that process does not receive `CANVAS_TEST_DATABASE_URL`, but it must have executed and passed in Step 4.

- [ ] **Step 6: Review and commit the PostgreSQL coverage**

Review `GEMINI.md`, `docs/code-review/README.md`, the test diff, and the integration output. Then run:

```bash
git add src/core/canvas/server/repository/__tests__/apply-canvas-command.integration.test.ts
git commit -m "test(canvas): cover persistent command lifecycle"
```

Expected: one commit containing only the PostgreSQL integration coverage, plus a minimal repository fix if the test exposed a P0 blocker.

---

### Task 3: Release Gates and Two-Session Demonstration

**Files:**
- No planned source changes.
- Read: `docs/superpowers/specs/2026-08-09-s9-acceptance-demo-spec.md`
- Read: `docs/superpowers/specs/2026-08-08-collaborative-canvas-design.md:606-630`

**Interfaces:**
- Consumes: the complete automated suite, a migrated application database, an isolated Canvas test database, functional Better Auth configuration, and functional Portal credentials/configuration.
- Produces: a factual execution report in the session stating each gate and each demo step as passed, failed, or blocked. It produces no repository artifact.

- [ ] **Step 1: Run all automated release gates**

Run each command separately and retain its exit code/output:

```bash
pnpm test
pnpm test:canvas:integration
pnpm typecheck
pnpm build
pnpm exec biome check src/core/canvas
pnpm check
```

Expected:

- `pnpm test`: all non-integration tests pass.
- `pnpm test:canvas:integration`: one integration test passes, zero skipped.
- `pnpm typecheck`: exit code 0.
- `pnpm build`: exit code 0.
- Canvas Biome check: no diagnostics.
- Global `pnpm check`: its known preexisting diagnostics remain confined to `apps/meet-agent/`; any Canvas diagnostic is a blocker.

Do not modify `apps/meet-agent/`. If a Canvas gate fails, invoke `superpowers:systematic-debugging`, add or preserve a focused regression test, make the smallest Canvas-only fix, rerun the focused gate, and then rerun this complete gate set.

- [ ] **Step 2: Start the application with real development credentials**

Run:

```bash
pnpm dev
```

Expected: Next.js serves `http://localhost:3000`, Better Auth can create/sign in users, the application database is reachable, and the browser can mint a room-scoped Portal token. Never expose `PORTAL_SECRET_KEY`, database credentials, session cookies, or auth passwords in the execution report.

- [ ] **Step 3: Prepare two independent authenticated sessions**

Open two independent browser profiles or contexts, sign in as different users, and navigate both to the same `/projects/{projectId}/canvas` URL. Use a real existing project UUID owned by either account; Canvas access intentionally validates project existence rather than ownership.

Expected: both sessions reach the full-screen canvas, show a connected/live status, and list both participants. Two tabs sharing one cookie jar do not satisfy this step.

- [ ] **Step 4: Demonstrate awareness and viewport independence**

Pan and zoom the sessions to different viewports. Move each pointer over a recognizable element location and select the same element from one session.

Expected: each user sees the other participant, cursor, and selection at the correct canvas coordinate while retaining an independent viewport. Cursor, selection, and viewport must disappear from neither user's permanent element snapshot because they are never persisted there.

- [ ] **Step 5: Demonstrate the permanent collaborative lifecycle**

Perform these actions in order:

1. User A creates a sticky.
2. User B moves it while User A observes preview and final position.
3. User A edits its text while User B observes the final content.
4. User B selects and resizes it while User A observes selection and dimensions.
5. User A deletes it.

Expected: every final operation appears in the other session without refresh; no duplicate element, stale snap-back, or permanent divergence occurs.

- [ ] **Step 6: Demonstrate persistence and reload**

Create one sticky that will remain active, move it, resize it, edit its content, and reload both sessions.

Expected: both sessions reconstruct the same final active element from PostgreSQL. Deleted elements remain absent. Presence reconnects, while local viewport state is not restored as shared state.

- [ ] **Step 7: Demonstrate disconnect, unsynced state, and recovery**

Disable network access for User B's browser context, perform one final edit on the surviving sticky, and then restore network access.

Expected: local interaction remains responsive; the UI does not claim `Live` while the final publish is pending; after reconnection the outbox publishes in order, User A receives the final edit, and both sessions return to `Live` with no pending publish count.

- [ ] **Step 8: Demonstrate programmatic creation through the public controller API**

Run the focused acceptance scenario, whose first operation invokes
`clientA.actions.createElement` directly with this input:

```ts
{
    type: "STICKY",
    content: "Programmatic acceptance",
    x: 420,
    y: 180,
    width: 240,
    height: 180,
}
```

Run:

```bash
pnpm vitest run src/core/canvas/client/controller/__tests__/canvas-acceptance.test.ts -t "converges two clients through every permanent action and reload"
```

Expected: the direct programmatic call persists, reaches the second controller,
and survives reconstruction from the persisted snapshot. In the two live
sessions, create a second sticky through the existing insertion interaction and
verify it appears remotely and after reload; `canvas-editor.tsx` routes that
interaction through the same `actions.createElement` API. Together these checks
prove direct API invocation and the real Portal/PostgreSQL path without adding a
debug global or a new product surface.

- [ ] **Step 9: Review the final diff and report acceptance**

Run:

```bash
git status --short
git diff HEAD~2..HEAD -- src/core/canvas
git log --oneline -5
```

Expected: only the two planned Canvas test areas and any narrowly justified blocking Canvas fix changed; `apps/meet-agent/` is untouched.

Report, without creating a repository file:

- exact automated commands and pass/fail/skip counts;
- whether the global Biome diagnostics remained outside Canvas;
- each manual demo step as passed, failed, or blocked;
- any P0 blocker fixed and its regression test;
- any non-blocking issue left for later.

Do not call S9 complete if the PostgreSQL integration was skipped, a Canvas gate failed, credentials prevented the real two-session demo, or either session failed to converge.
