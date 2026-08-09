# S4 Local Elements and Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the S3 React Flow canvas to the S2 snapshot API and deliver local create, select, edit, move, resize, delete, optimistic persistence, and reload behavior for all four canvas element types.

**Architecture:** Keep `CanvasSnapshot` in the TanStack Query cache as the only permanent client state. Build pure client-safe helpers for defaults, node derivation, LWW comparison, and record reconciliation; wrap them in a canvas controller that owns optimistic mutations and ephemeral interaction state. Keep React Flow as a rendering and interaction adapter, with toolbar, nodes, keyboard handlers, and future programmatic tools calling the same `CanvasActions` boundary.

**Tech Stack:** Next.js 16, React 19, `@xyflow/react` 12.11.2, Eden/TanStack Query, Zod-inferred Canvas types, shadcn/ui, Lucide, Sonner, Vitest, `happy-dom`, and Biome.

## Global Constraints

- Do not add runtime dependencies or modify `package.json`.
- `CanvasSnapshot` is the only permanent client state; React Flow must not become a second element store.
- Do not use `useNodesState` for canonical elements.
- React Flow nodes are derived from `snapshot.elements`; tombstones never render as nodes.
- Keep `CanvasShell` as a Server Component; only the canvas editor and its children are client code.
- Pass `projectId` and the authenticated `user.id` from the server route to the client shell.
- Use the existing S2 routes and response envelopes without changing their public contracts.
- Read API data from `data.response`; do not treat the CommonResponse envelope as a CanvasSnapshot.
- Bind the Eden proxy through `useElysia()` in one `src/core/canvas/client/hooks.ts` factory. Do not use raw `apiClient` in components or hooks.
- Do not hand-build Eden query keys, query functions, or mutation functions when the typed proxy exposes options.
- The client must not import files from `src/core/canvas/server/repository/`.
- The client and S2 repository must use the same pure LWW comparison semantics: timestamp first, lexicographically larger operation ID as tie-breaker, identical tuple idempotent.
- All commands use `crypto.randomUUID()` and `new Date().toISOString()`; the server remains authoritative for actor and audit timestamps.
- Drag and resize send one final mutation on interaction end, not one request per pointer event.
- Text edits use an ephemeral draft and persist on blur or `Ctrl/Cmd + Enter`; `Escape` cancels without a request.
- The toolbar starts in `Select`; insertion tools are one-shot and return to `Select` after creation.
- Initial element dimensions are Sticky `240 x 180`, Text `280 x 120`, Card `320 x 200`, Heading `360 x 96`.
- Minimum dimensions are Sticky `160 x 100`, Text `160 x 64`, Card `220 x 120`, Heading `200 x 64`.
- Initial `fitView` runs once only when the loaded snapshot contains elements, with `maxZoom: 1` and `padding: 0.2`.
- Viewport, active tool, local selection, drafts, previews, and pending operations are ephemeral and never persisted.
- S4 does not add Portal, presence, cursors, remote selection, retry queues, offline durability, or realtime events.
- At the end of every task, review the implementation using `docs/code-review/README.md`, `docs/code-review/types-schemas.md`, and `docs/code-review/frontend-data-fetching.md`; do not invoke a code-review skill.
- Do not commit changes unless the user explicitly requests a commit.

---

## File Map

The implementation is split by responsibility rather than by one large canvas component:

| File | Responsibility |
|---|---|
| `src/core/canvas/domain/operation-version.ts` | Client/server-safe LWW comparison extracted from the existing repository helper |
| `src/core/canvas/client/controller/element-defaults.ts` | Initial/minimum dimensions and Card content parsing |
| `src/core/canvas/client/controller/reconcile-canvas-record.ts` | Pure active-element/tombstone reconciliation |
| `src/core/canvas/client/controller/to-react-flow-nodes.ts` | Pure domain-to-React-Flow node derivation with local previews |
| `src/core/canvas/client/hooks.ts` | One Eden/TanStack Query canvas hook factory |
| `src/core/canvas/client/controller/canvas-controller.ts` | Pure action pipeline, pending versions, optimistic updates, rollback |
| `src/core/canvas/client/controller/canvas-controller-context.tsx` | React provider for canonical snapshot access and ephemeral UI state |
| `src/core/canvas/client/ui/canvas-editor.tsx` | React Flow event adapter, loading/error states, and initial fit |
| `src/core/canvas/client/ui/canvas-toolbar.tsx` | Accessible tool selection and actions |
| `src/core/canvas/client/ui/workspace-element-node.tsx` | Generic custom node and type-specific presentation |
| `src/core/canvas/client/ui/workspace-element-editor.tsx` | Text draft, confirm, cancel, and keyboard behavior |
| `src/core/canvas/client/ui/navigable-canvas.tsx` | S3 viewport wrapper extended with S4 project/user props |
| `src/core/canvas/client/ui/canvas-shell.tsx` | Server shell prop wiring only |
| `src/app/(workspace)/projects/[projectId]/canvas/page.tsx` | Pass `projectId` and authenticated `user.id` to the shell |

All new client tests live beside their responsibility under `__tests__` and use
pure tests or the existing `happy-dom` plus controlled React Flow mocks. No
Testing Library or browser-test dependency is added.

---

### Task 1: Shared Canvas Helpers and Reconciliation

**Files:**
- Create: `src/core/canvas/domain/operation-version.ts`
- Modify: `src/core/canvas/server/repository/lww.ts`
- Create: `src/core/canvas/client/controller/element-defaults.ts`
- Create: `src/core/canvas/client/controller/reconcile-canvas-record.ts`
- Test: `src/core/canvas/domain/__tests__/operation-version.test.ts`
- Test: `src/core/canvas/client/controller/__tests__/element-defaults.test.ts`
- Test: `src/core/canvas/client/controller/__tests__/reconcile-canvas-record.test.ts`

**Interfaces:**
- Consumes: `OperationVersion`, `WorkspaceElement`, `ElementTombstone`, `CanvasSnapshot`, and `WorkspaceElementType` from `@/core/canvas/domain/types`.
- Produces: `compareOperationVersions`, `isOperationNewer`, `ELEMENT_DEFAULTS`, `getElementDefaults`, `parseCardContent`, `isCanvasTombstone`, and `reconcileCanvasRecord` for Tasks 2-5.

- [ ] **Step 1: Write the failing shared LWW tests**

Create `src/core/canvas/domain/__tests__/operation-version.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```text
pnpm vitest run src/core/canvas/domain/__tests__/operation-version.test.ts
```

Expected: FAIL because `src/core/canvas/domain/operation-version.ts` does not
exist yet.

- [ ] **Step 3: Implement the shared comparator and preserve the existing S2 import path**

Create `src/core/canvas/domain/operation-version.ts`:

```ts
import type { OperationVersion } from "./types";

export function compareOperationVersions(
    left: OperationVersion,
    right: OperationVersion,
): number {
    const timestampDifference =
        Date.parse(left.lastOperationAt) - Date.parse(right.lastOperationAt);

    if (timestampDifference !== 0) return timestampDifference;

    const leftOperationId = left.lastOperationId.toLowerCase();
    const rightOperationId = right.lastOperationId.toLowerCase();

    if (leftOperationId === rightOperationId) return 0;
    return leftOperationId > rightOperationId ? 1 : -1;
}

export function isOperationNewer(
    incoming: OperationVersion,
    current: OperationVersion,
): boolean {
    return compareOperationVersions(incoming, current) > 0;
}
```

Modify `src/core/canvas/server/repository/lww.ts` to preserve the existing
server module's public imports while delegating to the shared implementation:

```ts
export {
    compareOperationVersions,
    isOperationNewer,
} from "@/core/canvas/domain/operation-version";
```

Do not import this server wrapper from client code. Existing S2 tests must keep
importing `../lww` successfully.

- [ ] **Step 4: Write failing defaults and reconciliation tests**

Create `src/core/canvas/client/controller/__tests__/element-defaults.test.ts`
with these assertions:

```ts
import { describe, expect, it } from "vitest";
import {
    ELEMENT_DEFAULTS,
    getElementDefaults,
    parseCardContent,
} from "@/core/canvas/client/controller/element-defaults";

describe("canvas element defaults", () => {
    it("defines the approved initial and minimum dimensions", () => {
        expect(ELEMENT_DEFAULTS).toEqual({
            STICKY: { width: 240, height: 180, minWidth: 160, minHeight: 100 },
            TEXT: { width: 280, height: 120, minWidth: 160, minHeight: 64 },
            CARD: { width: 320, height: 200, minWidth: 220, minHeight: 120 },
            HEADING: { width: 360, height: 96, minWidth: 200, minHeight: 64 },
        });
        expect(getElementDefaults("CARD").width).toBe(320);
    });

    it("parses the first card line as title and the rest as description", () => {
        expect(parseCardContent("Title\nDescription\n")).toEqual({
            title: "Title",
            description: "Description",
        });
    });

    it("allows an empty card content", () => {
        expect(parseCardContent("")).toEqual({ title: "", description: "" });
    });
});
```

Create `src/core/canvas/client/controller/__tests__/reconcile-canvas-record.test.ts`
with fixtures for one active element and one tombstone, then test:

```ts
it("replaces an active record with a newer active record", () => {
    const result = reconcileCanvasRecord(snapshotWith(activeElement), newerElement);

    expect(result.elements).toEqual([newerElement]);
    expect(result.tombstones).toEqual([]);
});

it("moves an id from elements to tombstones for a newer delete", () => {
    const result = reconcileCanvasRecord(snapshotWith(activeElement), newerTombstone);

    expect(result.elements).toEqual([]);
    expect(result.tombstones).toEqual([newerTombstone]);
});

it("ignores an older record and accepts an equal-version authoritative record", () => {
    expect(reconcileCanvasRecord(snapshotWith(newerElement), olderElement)).toEqual(
        snapshotWith(newerElement),
    );
    expect(
        reconcileCanvasRecord(snapshotWith(localElement), authoritativeSameVersion),
    ).toEqual(snapshotWith(authoritativeSameVersion));
});

it("never lets an older active element resurface over a tombstone", () => {
    const result = reconcileCanvasRecord(snapshotWith(newerTombstone), olderElement);

    expect(result.elements).toEqual([]);
    expect(result.tombstones).toEqual([newerTombstone]);
});
```

Use real `WorkspaceElement` and `ElementTombstone` fixtures validated by the
existing Zod schemas. Do not introduce handwritten domain mirror interfaces.

- [ ] **Step 5: Implement defaults, Card parsing, and immutable reconciliation**

Create `src/core/canvas/client/controller/element-defaults.ts`:

```ts
import type { WorkspaceElementType } from "@/core/canvas/domain/types";

export const ELEMENT_DEFAULTS = {
    STICKY: { width: 240, height: 180, minWidth: 160, minHeight: 100 },
    TEXT: { width: 280, height: 120, minWidth: 160, minHeight: 64 },
    CARD: { width: 320, height: 200, minWidth: 220, minHeight: 120 },
    HEADING: { width: 360, height: 96, minWidth: 200, minHeight: 64 },
} as const satisfies Record<
    WorkspaceElementType,
    { width: number; height: number; minWidth: number; minHeight: number }
>;

export function getElementDefaults(type: WorkspaceElementType) {
    return ELEMENT_DEFAULTS[type];
}

export function parseCardContent(content: string) {
    const [titleLine = "", ...descriptionLines] = content.split(/\r?\n/);

    return {
        title: titleLine.trim(),
        description: descriptionLines.join("\n").trimEnd(),
    };
}
```

Create `src/core/canvas/client/controller/reconcile-canvas-record.ts`:

```ts
import { compareOperationVersions } from "@/core/canvas/domain/operation-version";
import type {
    CanvasSnapshot,
    ElementTombstone,
    WorkspaceElement,
} from "@/core/canvas/domain/types";

type CanvasRecord = WorkspaceElement | ElementTombstone;

export function isCanvasTombstone(
    record: CanvasRecord,
): record is ElementTombstone {
    return "deletedAt" in record;
}

export function reconcileCanvasRecord(
    snapshot: CanvasSnapshot,
    incoming: CanvasRecord,
): CanvasSnapshot {
    const current =
        snapshot.elements.find((record) => record.id === incoming.id) ??
        snapshot.tombstones.find((record) => record.id === incoming.id);

    if (
        current &&
        compareOperationVersions(incoming, current) < 0
    ) {
        return snapshot;
    }

    const elements = snapshot.elements.filter((record) => record.id !== incoming.id);
    const tombstones = snapshot.tombstones.filter(
        (record) => record.id !== incoming.id,
    );

    if (isCanvasTombstone(incoming)) tombstones.push(incoming);
    else elements.push(incoming);

    return { ...snapshot, elements, tombstones };
}
```

Preserve the existing snapshot `projectId` and array order for unaffected
records. An equal version is accepted so an authoritative response can replace
provisional `createdBy` and audit timestamps.

- [ ] **Step 6: Run focused tests and the existing S2 LWW tests**

Run:

```text
pnpm vitest run src/core/canvas/domain/__tests__/operation-version.test.ts src/core/canvas/client/controller/__tests__/element-defaults.test.ts src/core/canvas/client/controller/__tests__/reconcile-canvas-record.test.ts src/core/canvas/server/repository/__tests__/lww.test.ts
```

Expected: all focused files pass, including the pre-existing S2 LWW suite.

- [ ] **Step 7: Review Task 1 with repository rules**

Read and apply these files directly; do not invoke a code-review skill:

- `docs/code-review/README.md`: helpers remain in the Canvas domain and no unrelated infrastructure is added.
- `docs/code-review/types-schemas.md`: all domain record types come from `domain/types.ts`; no mirror interface is introduced.
- `docs/code-review/frontend-data-fetching.md`: this task has no fetch path and must not create one.

Run `git diff --check` and inspect only the Task 1 files. Confirm the server
wrapper keeps its existing imports and the client has no `server` import.

---

### Task 2: Query Transport and Canvas Action Controller

**Files:**
- Create: `src/core/canvas/client/hooks.ts`
- Create: `src/core/canvas/client/controller/canvas-controller.ts`
- Create: `src/core/canvas/client/controller/canvas-controller-context.tsx`
- Test: `src/core/canvas/client/controller/__tests__/canvas-controller.test.ts`
- Test: `src/core/canvas/client/controller/__tests__/canvas-controller-context.test.tsx`

**Interfaces:**
- Consumes: Task 1 helpers, S2 Canvas API routes, `CanvasSnapshot`, `CanvasCommand`, and `CanvasMutationResult`.
- Produces: `CanvasActions`, `CanvasTransport`, `createCanvasActions`, `CanvasControllerProvider`, and `useCanvasController` for Tasks 3-5.

- [ ] **Step 1: Define the tested transport and state-port contracts**

At the top of `canvas-controller.ts`, derive action inputs from existing inferred
types instead of duplicating schemas:

```ts
import type {
    CanvasMutationResult,
    CanvasSnapshot,
    CreateElementCommand,
    DeleteElementCommand,
    MoveElementCommand,
    ResizeElementCommand,
    UpdateElementCommand,
    WorkspaceElement,
} from "@/core/canvas/domain/types";

export type CreateElementInput = Omit<
    CreateElementCommand["element"],
    "id"
>;
export type UpdateElementInput = Pick<UpdateElementCommand, "content">;
export type MoveElementInput = Pick<MoveElementCommand, "x" | "y">;
export type ResizeElementInput = Pick<
    ResizeElementCommand,
    "width" | "height"
>;

export type CanvasTransport = {
    create(command: CreateElementCommand): Promise<CanvasMutationResult>;
    update(
        command: UpdateElementCommand | MoveElementCommand | ResizeElementCommand,
    ): Promise<CanvasMutationResult>;
    delete(command: DeleteElementCommand): Promise<CanvasMutationResult>;
};

export type CanvasSnapshotPort = {
    read(): CanvasSnapshot | undefined;
    write(updater: (snapshot: CanvasSnapshot) => CanvasSnapshot): void;
};

export type CanvasSelectionPort = {
    read(): string[];
    write(elementIds: string[]): void;
};

export type CanvasActions = {
    createElement(input: CreateElementInput): Promise<CanvasMutationResult>;
    updateElement(
        elementId: string,
        changes: UpdateElementInput,
    ): Promise<CanvasMutationResult>;
    moveElement(
        elementId: string,
        position: MoveElementInput,
    ): Promise<CanvasMutationResult>;
    resizeElement(
        elementId: string,
        dimensions: ResizeElementInput,
    ): Promise<CanvasMutationResult>;
    deleteElement(elementId: string): Promise<CanvasMutationResult>;
    selectElements(elementIds: string[]): void;
    getElement(elementId: string): WorkspaceElement | undefined;
    getElements(): CanvasSnapshot["elements"];
    getSelectedElements(): CanvasSnapshot["elements"];
};
```

- [ ] **Step 2: Write failing controller tests with fake transport and deterministic clocks**

Create a fake `CanvasSnapshotPort` and a fake `CanvasTransport` in the test file.
Inject `idFactory` and `now` into `createCanvasActions` so operation IDs and
timestamps are deterministic. Cover these cases:

```ts
it("creates an optimistic element and reconciles the authoritative response", async () => {
    const transport = deferredTransport();
    const { actions, read } = createTestController(transport);

    const promise = actions.createElement({
        type: "STICKY",
        content: "",
        x: 10,
        y: 20,
        width: 240,
        height: 180,
    });

    expect(read().elements).toHaveLength(1);
    expect(read().elements[0].createdBy).toBe("user-1");

    transport.resolve({
        applied: true,
        record: authoritativeElement,
    });
    await expect(promise).resolves.toEqual({
        applied: true,
        record: authoritativeElement,
    });
    expect(read().elements).toEqual([authoritativeElement]);
});

it("installs the server winner for an applied-false response", async () => {
    const transport = deferredTransport();
    const { actions, read } = createTestController(transport);
    const promise = actions.moveElement(elementId, { x: 80, y: 90 });

    transport.resolve({ applied: false, record: newerAuthoritativeElement });
    await promise;

    expect(read().elements).toEqual([newerAuthoritativeElement]);
});

it("rolls back only when a failed operation is still current", async () => {
    const transport = deferredTransport();
    const { actions, read } = createTestController(transport);
    const first = actions.moveElement(elementId, { x: 20, y: 20 });
    const second = actions.moveElement(elementId, { x: 40, y: 40 });

    transport.rejectFirst(new Error("network"));
    await expect(first).rejects.toThrow("network");
    expect(read().elements[0]).toMatchObject({ x: 40, y: 40 });

    transport.resolveSecond({ applied: true, record: authoritativeSecond });
    await second;
});

it("creates a tombstone on optimistic delete and restores the element on failure", async () => {
    const transport = deferredTransport();
    const { actions, read } = createTestController(transport);
    const promise = actions.deleteElement(elementId);

    expect(read().elements).toEqual([]);
    expect(read().tombstones).toHaveLength(1);

    transport.rejectFirst(new Error("network"));
    await expect(promise).rejects.toThrow("network");
    expect(read().elements).toHaveLength(1);
    expect(read().tombstones).toEqual([]);
});
```

Also test command kinds, route-relevant element IDs, no client audit fields in
commands, UUID/timestamp generation, `getElements`, `getElement`, selection,
and `getSelectedElements`.

- [ ] **Step 3: Run the focused controller test and verify it fails**

Run:

```text
pnpm vitest run src/core/canvas/client/controller/__tests__/canvas-controller.test.ts
```

Expected: FAIL because the controller module and action factory do not exist.

- [ ] **Step 4: Implement immutable optimistic action handling**

`createCanvasActions` must accept:

```ts
type CanvasControllerDependencies = {
    projectId: string;
    userId: string;
    state: CanvasSnapshotPort;
    transport: CanvasTransport;
    selection: CanvasSelectionPort;
    idFactory?: () => string;
    now?: () => string;
    onError?: (error: unknown) => void;
};
```

Implement these rules:

1. Generate one operation ID and timestamp per action.
2. Build the strict S0 command without actor or server audit fields.
3. Build a provisional active record or tombstone with the operation version.
4. Save the current record as a preimage in a pending map keyed by element ID and operation ID.
5. Call `state.write` with `reconcileCanvasRecord` so the optimistic record is visible immediately.
6. Call the matching transport method.
7. Reconcile `result.record` only when its version is not older than the current record.
8. Clear only the matching pending operation.
9. On rejection, rollback the preimage only if the current record still has the failed operation version; otherwise leave the newer local operation intact.
10. Re-throw the error after calling `onError` so programmatic consumers can observe failure.

Use `isCanvasTombstone` to separate `elements` and `tombstones`; never mutate
the snapshot arrays in place. A successful delete response may contain a
tombstone, while a newer create response may reactivate an ID.

For same-element operations, maintain a promise chain only to preserve command
send order; do not turn it into a durable retry queue. Different element IDs may
send concurrently.

- [ ] **Step 5: Implement the Eden/TanStack Query factory**

Create `src/core/canvas/client/hooks.ts` with one exported factory. Its shape
must follow the existing Project hook pattern:

```ts
"use client";

export const useCanvas = () => {
    const client = useElysia().canvas;
    const queryClient = useQueryClient();

    const useSnapshot = (projectId: string) => {
        const procedure = client({ projectId }).elements.get;
        return useQuery(procedure.queryOptions());
    };

    const useController = ({
        projectId,
        userId,
        selection,
    }: {
        projectId: string;
        userId: string;
        selection: CanvasSelectionPort;
    }) => {
        const procedure = client({ projectId }).elements;
        const snapshotProcedure = procedure.get;
        const snapshotQuery = useQuery(snapshotProcedure.queryOptions());
        const queryKey = snapshotProcedure.queryKey();

        const createMutation = useMutation(procedure.post.mutationOptions());
        const updateMutation = useMutation({
            mutationFn: ({ elementId, command }: { elementId: string; command: UpdateElementCommand | MoveElementCommand | ResizeElementCommand }) =>
                client({ projectId }).elements({ elementId }).put.mutationOptions().mutationFn(command),
        });
        const deleteMutation = useMutation({
            mutationFn: ({ elementId, command }: { elementId: string; command: DeleteElementCommand }) =>
                client({ projectId }).elements({ elementId }).delete.mutationOptions().mutationFn(command),
        });

        const state: CanvasSnapshotPort = {
            read: () => snapshotQuery.data?.response,
            write: (updater) => {
                queryClient.setQueryData(queryKey, (current) =>
                    current
                        ? { ...current, response: updater(current.response) }
                        : current,
                );
            },
        };

        return {
            snapshotQuery,
            actions: createCanvasActions({
                projectId,
                userId,
                state,
                transport: {
                    create: async (command) =>
                        (await createMutation.mutateAsync(command)).response,
                    update: async ({ elementId, ...command }) =>
                        (
                            await updateMutation.mutateAsync({
                                elementId,
                                command,
                            })
                        ).response,
                    delete: async (command) =>
                        (
                            await deleteMutation.mutateAsync({
                                elementId: command.elementId,
                                command,
                            })
                        ).response,
                },
                selection,
            }),
        };
    };

    return { useSnapshot, useController };
};
```

Adjust only the inferred Eden proxy nesting needed by the actual `AppRouter`; do
not replace it with `fetch` or raw `apiClient`. The route parameters must be
bound before calling the dynamic update/delete procedure. Preserve the full
CommonResponse object in the query cache while updating only `response`.

- [ ] **Step 6: Add the React controller context**

Create `canvas-controller-context.tsx` with:

```ts
export type CanvasTool =
    | "select"
    | "hand"
    | "STICKY"
    | "TEXT"
    | "CARD"
    | "HEADING"
    | "delete";

export type CanvasPreview = {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
};

export type CanvasControllerValue = {
    projectId: string;
    snapshot: CanvasSnapshot | undefined;
    isLoading: boolean;
    error: Error | null;
    retry(): void;
    actions: CanvasActions;
    activeTool: CanvasTool;
    setActiveTool(tool: CanvasTool): void;
    selectedElementIds: string[];
    editingElementId: string | null;
    textDrafts: Record<string, string>;
    setMovePreview(elementId: string, preview: { x: number; y: number }): void;
    setResizePreview(
        elementId: string,
        preview: { width: number; height: number },
    ): void;
    clearPreview(elementId: string): void;
    getPreview(elementId: string): CanvasPreview | undefined;
    beginEditing(elementId: string): void;
    setTextDraft(elementId: string, content: string): void;
    confirmEditing(elementId: string): Promise<CanvasMutationResult | undefined>;
    cancelEditing(elementId: string): void;
    fitViewHasRun: boolean;
    markFitViewComplete(): void;
};
```

The provider keeps `selectedElementIds` in React state first, then calls
`useCanvas().useController({ projectId, userId, selection })` with a
`CanvasSelectionPort` backed by that state. It keeps only the other listed
ephemeral values in React state, exposes the query retry action, and renders its
children. `selectElements` must normalize UI selection to at most one ID while
preserving the array-based domain contract for future S7 use. `confirmEditing`
compares the draft with the canonical content and skips the API call when
unchanged.

- [ ] **Step 7: Run controller and type checks**

Run:

```text
pnpm vitest run src/core/canvas/client/controller/__tests__/canvas-controller.test.ts src/core/canvas/client/controller/__tests__/canvas-controller-context.test.tsx
pnpm typecheck
```

Expected: controller tests pass and TypeScript accepts the inferred Eden route
proxy, mutation response envelope, context value, and action input aliases.

- [ ] **Step 8: Review Task 2 with repository rules**

Use only the repository review documents:

- `docs/code-review/frontend-data-fetching.md`: verify one `useCanvas` factory, Eden options, dynamic route parameters, and `.response` access.
- `docs/code-review/types-schemas.md`: verify action inputs use inferred types and no manual domain mirrors or type re-exports exist.
- `docs/code-review/README.md`: verify server-only modules are not imported by client code and the controller stays under `src/core/canvas/client`.

Run `git diff --check`, inspect the exact Task 2 diff, and confirm no raw
`apiClient`, `fetch`, hand-built query key, or direct repository call exists.
Do not invoke a code-review skill.

---

### Task 3: React Flow Nodes and Text Editing

**Files:**
- Create: `src/core/canvas/client/controller/to-react-flow-nodes.ts`
- Create: `src/core/canvas/client/ui/workspace-element-node.tsx`
- Create: `src/core/canvas/client/ui/workspace-element-editor.tsx`
- Test: `src/core/canvas/client/controller/__tests__/to-react-flow-nodes.test.ts`
- Test: `src/core/canvas/client/ui/__tests__/workspace-element-node.test.tsx`
- Test: `src/core/canvas/client/ui/__tests__/workspace-element-editor.test.tsx`

**Interfaces:**
- Consumes: Task 1 defaults and Card parser, Task 2 `CanvasControllerValue`, and React Flow `Node`/`NodeProps` types.
- Produces: `toReactFlowNodes(elements, previews)`, `WORKSPACE_NODE_TYPES`, `WorkspaceElementNode`, and `WorkspaceElementEditor` for Task 5.

- [ ] **Step 1: Write failing node derivation tests**

Create tests for:

```ts
it("derives one React Flow node per active element", () => {
    const nodes = toReactFlowNodes([stickyElement, cardElement], new Map());

    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
        id: stickyElement.id,
        type: "workspaceElement",
        position: { x: stickyElement.x, y: stickyElement.y },
        style: { width: stickyElement.width, height: stickyElement.height },
        data: { element: stickyElement },
    });
});

it("overlays local move and resize previews without mutating the element", () => {
    const previews = new Map([
        [stickyElement.id, { x: 80, y: 90, width: 300, height: 220 }],
    ]);
    const nodes = toReactFlowNodes([stickyElement], previews);

    expect(nodes[0].position).toEqual({ x: 80, y: 90 });
    expect(nodes[0].style).toMatchObject({ width: 300, height: 220 });
    expect(stickyElement.x).not.toBe(80);
});
```

Also assert that node type remains `workspaceElement`, edges are not created by
this mapper, and IDs are preserved exactly.

- [ ] **Step 2: Run the focused mapper test and verify it fails**

Run:

```text
pnpm vitest run src/core/canvas/client/controller/__tests__/to-react-flow-nodes.test.ts
```

Expected: FAIL because the node mapper does not exist.

- [ ] **Step 3: Implement the pure node adapter**

Create `to-react-flow-nodes.ts` with domain-derived data and preview types:

```ts
import type { Node } from "@xyflow/react";
import type { WorkspaceElement } from "@/core/canvas/domain/types";
import type { CanvasPreview } from "./canvas-controller-context";

export type WorkspaceElementNodeData = {
    element: WorkspaceElement;
    preview?: CanvasPreview;
};

export type WorkspaceElementNode = Node<WorkspaceElementNodeData, "workspaceElement">;

export function toReactFlowNodes(
    elements: WorkspaceElement[],
    previews: ReadonlyMap<string, CanvasPreview>,
): WorkspaceElementNode[] {
    return elements.map((element) => {
        const preview = previews.get(element.id);

        return {
            id: element.id,
            type: "workspaceElement",
            position: {
                x: preview?.x ?? element.x,
                y: preview?.y ?? element.y,
            },
            style: {
                width: preview?.width ?? element.width,
                height: preview?.height ?? element.height,
            },
            data: { element, preview },
        };
    });
}
```

If the installed React Flow type requires a different generic form, preserve
the same runtime shape and import the corrected type from `@xyflow/react`.

- [ ] **Step 4: Write failing node and editor tests with a controlled context**

Mock `useCanvasController` and `NodeResizer` in `happy-dom`. Cover:

1. Sticky, Text, Card, and Heading render distinct data attributes/classes;
2. `NodeResizer` receives selected state and type minimum dimensions;
3. a non-editing node renders content without calling `updateElement`;
4. the editor initializes from canonical content;
5. input changes update only the draft callback;
6. blur and `Ctrl/Cmd + Enter` confirm;
7. `Escape` cancels and prevents delete handling inside the textarea;
8. Card display uses the title/description parser.

Use direct DOM events and `react-dom/client` as in the existing S3 tests; do not
add Testing Library.

- [ ] **Step 5: Implement `WorkspaceElementEditor`**

The editor must be a controlled `Textarea` with:

```tsx
<Textarea
    aria-label={`${element.type} content`}
    value={draft}
    autoFocus
    onChange={(event) => setTextDraft(element.id, event.target.value)}
    onBlur={() => void confirmEditing(element.id)}
    onKeyDown={(event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            cancelEditing(element.id);
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void confirmEditing(element.id);
        }
    }}
/>
```

Stop propagation for pointer and keyboard events that would otherwise drag or
delete the node while editing. The component must not call Eden or `setQueryData`.

- [ ] **Step 6: Implement the generic custom node**

`WorkspaceElementNode` must:

- read `data.element` and `selected` from React Flow props;
- read action/context functions from `useCanvasController`;
- render `NodeResizer` only when selected, with defaults from `getElementDefaults`;
- call `setResizePreview` during resize and `actions.resizeElement` on resize end;
- show `WorkspaceElementEditor` only for the active `editingElementId`;
- call `beginEditing` on double click;
- render Card title and description from `parseCardContent` when not editing;
- expose `data-element-type` for tests;
- avoid handles, edges, API calls, and duplicated domain fields.

Use a stable `WORKSPACE_NODE_TYPES` object:

```ts
export const WORKSPACE_NODE_TYPES = {
    workspaceElement: WorkspaceElementNode,
};
```

- [ ] **Step 7: Run focused node tests and typecheck**

Run:

```text
pnpm vitest run src/core/canvas/client/controller/__tests__/to-react-flow-nodes.test.ts src/core/canvas/client/ui/__tests__/workspace-element-node.test.tsx src/core/canvas/client/ui/__tests__/workspace-element-editor.test.tsx
pnpm typecheck
```

Expected: all mapper/editor/node tests pass and React Flow generic types compile.

- [ ] **Step 8: Review Task 3 with repository rules**

Read `docs/code-review/README.md` and confirm the adapter remains under the
Canvas client domain. Read `docs/code-review/types-schemas.md` and confirm node
data wraps `WorkspaceElement` instead of duplicating its fields. Read
`docs/code-review/frontend-data-fetching.md` and confirm node/editor components
do not use `apiClient`, `fetch`, or query/mutation code directly.

Run `git diff --check` and inspect only Task 3 files. Do not invoke a code-review
skill.

---

### Task 4: Toolbar and Canvas Interaction State

**Files:**
- Create: `src/core/canvas/client/ui/canvas-toolbar.tsx`
- Create: `src/core/canvas/client/ui/__tests__/canvas-toolbar.test.tsx`
- Modify: `src/core/canvas/client/controller/canvas-controller-context.tsx`
- Modify: `src/core/canvas/client/ui/workspace-element-node.tsx`

**Interfaces:**
- Consumes: `CanvasTool`, controller context, `CanvasActions`, and existing shadcn/Lucide components.
- Produces: an accessible toolbar and interaction methods used by `CanvasEditor` in Task 5.

- [ ] **Step 1: Write failing toolbar tests**

Create a context mock and test:

```ts
it("renders all tools with an accessible active state", () => {
    const view = renderToolbar({ activeTool: "select" });

    expect(view.container.querySelector('[aria-label="Canvas tools"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Select"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Hand"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Create sticky"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Create text"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Create card"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Create heading"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Delete selected element"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-pressed="true"]')?.getAttribute("aria-label")).toBe("Select");
});

it("selects tools and deletes through CanvasActions", () => {
    const view = renderToolbar({ activeTool: "select" });

    click(view.container, "[aria-label=\"Hand\"]");
    expect(contextMock.setActiveTool).toHaveBeenCalledWith("hand");

    click(view.container, "[aria-label=\"Delete selected element\"]");
    expect(contextMock.actions.deleteElement).toHaveBeenCalledWith(elementId);
});
```

Also verify disabled state while loading, no delete call without a selected ID,
tooltips, `Separator`, and mobile-safe compact sizing.

- [ ] **Step 2: Run the focused toolbar test and verify it fails**

Run:

```text
pnpm vitest run src/core/canvas/client/ui/__tests__/canvas-toolbar.test.tsx
```

Expected: FAIL because `CanvasToolbar` does not exist.

- [ ] **Step 3: Implement the toolbar**

Use a single `TooltipProvider` and a floating `fieldset` with
`aria-label="Canvas tools"`. Each tool button must have:

- a visible Lucide icon;
- an accessible `aria-label`;
- `aria-pressed` for toggle-like tools;
- `disabled` while the snapshot is loading or has failed;
- an active `variant` or class when selected;
- a tooltip matching the accessible name.

The tool mapping is:

```ts
const TOOL_BUTTONS = [
    { tool: "select", label: "Select", ariaLabel: "Select" },
    { tool: "hand", label: "Hand", ariaLabel: "Hand" },
    { tool: "STICKY", label: "Sticky", ariaLabel: "Create sticky" },
    { tool: "TEXT", label: "Text", ariaLabel: "Create text" },
    { tool: "CARD", label: "Card", ariaLabel: "Create card" },
    { tool: "HEADING", label: "Heading", ariaLabel: "Create heading" },
    { tool: "delete", label: "Delete", ariaLabel: "Delete selected element" },
] as const;
```

Clicking an insertion tool only changes `activeTool`; pane insertion in Task 5
performs creation and resets to `select`. Clicking Delete calls
`actions.deleteElement` for the first selected ID and then resets to `select`.

- [ ] **Step 4: Add the ephemeral interaction operations to the context**

Implement `setMovePreview`, `setResizePreview`, `clearPreview`,
`beginEditing`, `setTextDraft`, `confirmEditing`, and `cancelEditing` as React
state operations. Preview updates must replace only the selected element's
ephemeral entry. `getPreview` must return `undefined` after `clearPreview`.

`confirmEditing` calls `actions.updateElement` only when the draft differs from
the canonical content. Clear the draft and editing ID after a successful action;
if the action rejects, retain the draft and editing ID so the user can retry, and
let the provider's `onError` surface the failure.

- [ ] **Step 5: Add node drag/resize interaction callbacks**

Keep preview writes in the context, not in React Flow node state:

```tsx
const onNodeDrag = (_event: ReactMouseEvent, node: WorkspaceElementNode) => {
    setMovePreview(node.id, node.position);
};

const onNodeDragStop = async (
    _event: ReactMouseEvent,
    node: WorkspaceElementNode,
) => {
    clearPreview(node.id);
    await actions.moveElement(node.id, node.position);
};
```

The final `CanvasEditor` wiring is completed in Task 5, but the node resizer
must already call the same preview/final action boundary. No `onNodesChange`
handler may directly update a separate nodes collection.

- [ ] **Step 6: Run toolbar/context tests**

Run:

```text
pnpm vitest run src/core/canvas/client/ui/__tests__/canvas-toolbar.test.tsx src/core/canvas/client/controller/__tests__/canvas-controller-context.test.tsx
pnpm typecheck
```

Expected: toolbar and ephemeral context tests pass with no direct transport use
from UI components.

- [ ] **Step 7: Review Task 4 with repository rules**

Use `docs/code-review/README.md` to verify UI boundaries and shadcn usage. Use
`docs/code-review/types-schemas.md` to verify `CanvasTool` is UI state and does
not duplicate a domain schema. Use `docs/code-review/frontend-data-fetching.md`
to verify toolbar and context call actions rather than Eden or `apiClient`.

Run `git diff --check` and inspect the Task 4 diff. Do not invoke a code-review
skill.

---

### Task 5: Integrate the Editor into S3 and Wire Route Props

**Files:**
- Create: `src/core/canvas/client/ui/canvas-editor.tsx`
- Create: `src/core/canvas/client/ui/__tests__/canvas-editor.test.tsx`
- Modify: `src/core/canvas/client/ui/navigable-canvas.tsx`
- Modify: `src/core/canvas/client/ui/canvas-shell.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/canvas/page.tsx`
- Modify: `src/core/canvas/client/ui/__tests__/navigable-canvas.test.tsx`
- Modify: `src/core/canvas/client/ui/__tests__/canvas-shell.test.tsx`

**Interfaces:**
- Consumes: Task 2 provider/actions, Task 3 `WORKSPACE_NODE_TYPES` and mapper, Task 4 toolbar and interaction state, and S3 viewport controls.
- Produces: `NavigableCanvas({ projectId, userId })` with loaded nodes, local actions, loading/error/retry states, and one-time initial fit.

- [ ] **Step 1: Extend failing S3 tests for project/user props and non-empty nodes**

Update the React Flow mock props in `navigable-canvas.test.tsx` to capture:

- `nodes` and their IDs/types;
- `nodeTypes`;
- `onPaneClick`, `onNodeClick`, `onNodeDoubleClick`, `onNodeDrag`,
  `onNodeDragStop`, and `onSelectionChange`;
- `nodesDraggable`, `elementsSelectable`, and `panOnDrag`.

Add tests:

```ts
it("renders loaded domain elements as React Flow nodes", () => {
    render(
        createElement(NavigableCanvas, {
            projectId,
            userId,
        }),
    );

    expect(flowMock.reactFlowProps?.nodes).toHaveLength(1);
    expect(flowMock.reactFlowProps?.nodes[0]).toMatchObject({
        id: stickyElement.id,
        type: "workspaceElement",
    });
});

it("switches React Flow interaction flags for Hand", () => {
    const view = render(createElement(NavigableCanvas, { projectId, userId }));

    act(() => contextMock.setActiveTool("hand"));

    expect(flowMock.reactFlowProps?.nodesDraggable).toBe(false);
    expect(flowMock.reactFlowProps?.elementsSelectable).toBe(false);
});
```

Supply `snapshotWithSticky` through the mocked controller context for the first
test. Do not add an `initialSnapshot` production prop just to make the test
convenient.

Keep the existing S3 tests for empty nodes, viewport bounds, native gestures,
background, controls, and initial 100% viewport. Replace only assumptions that
S4 now allows loaded nodes.

- [ ] **Step 2: Run the focused integration test and verify it fails**

Run:

```text
pnpm vitest run src/core/canvas/client/ui/__tests__/navigable-canvas.test.tsx src/core/canvas/client/ui/__tests__/canvas-editor.test.tsx
```

Expected: FAIL because `NavigableCanvas` still has no project/user props and no
editor/controller integration.

- [ ] **Step 3: Pass route identity through the server boundary**

Modify `page.tsx` so the successful render passes the existing project ID and
authenticated user ID:

```tsx
return (
    <CanvasShell
        projectId={projectId}
        userId={user.id}
        projectName={result.data.name}
        userLabel={user.name?.trim() || user.email}
    />
);
```

Modify `CanvasShell` props to require `projectId` and `userId`, and pass them to:

```tsx
<NavigableCanvas projectId={projectId} userId={userId} />
```

Do not convert `CanvasShell` or the route page into a Client Component.

- [ ] **Step 4: Implement `CanvasEditor` as the React Flow adapter**

`CanvasEditor` must:

1. read controller context;
2. derive nodes with `toReactFlowNodes(snapshot?.elements ?? [], previews)`;
3. render `CanvasToolbar` and `ReactFlow` with `WORKSPACE_NODE_TYPES`;
4. pass `EMPTY_EDGES` from a module-stable constant;
5. use `activeTool` for `nodesDraggable`, `elementsSelectable`, and pane behavior;
6. create an element on pane click for `STICKY`, `TEXT`, `CARD`, or `HEADING` using `screenToFlowPosition` and `ELEMENT_DEFAULTS`;
7. select a node on click in `Select`;
8. begin editing on node double click in `Select`;
9. update local move preview in `onNodeDrag` and call `actions.moveElement` on `onNodeDragStop`;
10. route selection changes through `actions.selectElements`, normalized to zero or one ID;
11. handle Delete/Backspace at the wrapper level only when focus is not in an input, textarea, or active editor;
12. render the error state with a Retry button and never render the toolbar as enabled while loading/error;
13. preserve the S3 dotted `Background`, native pan/scroll/pinch, viewport limits, and attribution.

Use a `fieldset` or wrapper with `tabIndex={0}` so keyboard handling has an
accessible focus target. A pane click in `Select` only clears selection; a pane
click in an insertion tool creates one element and resets the tool.

- [ ] **Step 5: Implement initial `fitView` exactly once**

Inside the provider-aware editor, call `useReactFlow().fitView` from an effect
when `snapshot?.elements.length` becomes greater than zero and
`fitViewHasRun` is false:

```tsx
useEffect(() => {
    if (!snapshot || snapshot.elements.length === 0 || fitViewHasRun) return;

    void fitView({
        duration: 200,
        maxZoom: 1,
        padding: 0.2,
    });
    markFitViewComplete();
}, [fitViewHasRun, fitView, markFitViewComplete, snapshot]);
```

Do not call `fitView` for an empty initial snapshot, after every mutation, or
after a viewport reset. If the exact React Flow method return type is void,
remove `void` while keeping the same options.

- [ ] **Step 6: Add loading/error and interaction tests**

Mock the controller context and React Flow methods to assert:

1. loading shows `Loading canvas`, disables toolbar, and does not render editable nodes;
2. error shows `Unable to load canvas` and Retry calls query `refetch`;
3. success renders nodes and preserves viewport controls;
4. pane insertion uses flow coordinates and the correct default dimensions;
5. insertion resets to Select and begins editing the new ID;
6. node click selects, double click edits, and Hand disables node interaction;
7. drag preview does not call the final action until drag stop;
8. Delete/Backspace calls delete outside editors but not inside textarea;
9. fitView is called once for a non-empty snapshot and never for an empty one;
10. S3 controls still call `zoomTo` and `setViewport` through the existing provider.

- [ ] **Step 7: Run focused integration tests and typecheck**

Run:

```text
pnpm vitest run src/core/canvas/client/ui/__tests__/canvas-editor.test.tsx src/core/canvas/client/ui/__tests__/navigable-canvas.test.tsx src/core/canvas/client/ui/__tests__/canvas-shell.test.tsx
pnpm typecheck
```

Expected: all S4/S3 integration tests pass and the server-to-client prop
boundary compiles.

- [ ] **Step 8: Review Task 5 with repository rules**

Review the exact diff against:

- `docs/code-review/README.md`: `CanvasShell` remains server-renderable and all client UI stays under `src/core/canvas/client`.
- `docs/code-review/types-schemas.md`: route props use existing Project/session values; React Flow node data wraps domain types and does not duplicate them.
- `docs/code-review/frontend-data-fetching.md`: all data access stays in `useCanvas`; components call actions and read `.response` through the controller.

Run `git diff --check`, inspect the S1/S3 boundary, and confirm no Portal import,
raw fetch, direct repository call, or second node state exists. Do not invoke a
code-review skill.

---

### Task 6: Full Automated Verification and Manual Acceptance

**Files:**
- Verify: all files changed in Tasks 1-5
- Modify only if needed: focused test fixtures or Biome formatting in the same Task files
- No new feature files unless a failing verification identifies a concrete missing boundary

**Interfaces:**
- Consumes: complete local Canvas action flow, S2 API, and S3 viewport.
- Produces: evidence that S4 is complete without Portal or unrelated regressions.

- [ ] **Step 1: Run the complete Vitest suite**

Run:

```text
pnpm test
```

Expected: all unit/component tests pass. The opt-in PostgreSQL integration test
may remain skipped when `CANVAS_TEST_DATABASE_URL` is unset. If a test fails,
fix only the concrete regression before continuing; do not weaken the assertion.

- [ ] **Step 2: Run typecheck, Biome, and production build separately**

Run:

```text
pnpm typecheck
pnpm check
pnpm build
```

Expected: each command exits with code 0. If the repository reports a
pre-existing diagnostic, identify its exact file and do not attribute it to S4
without evidence.

- [ ] **Step 3: Review the complete diff with `docs/code-review/`**

Read these documents directly:

- `docs/code-review/README.md`
- `docs/code-review/types-schemas.md`
- `docs/code-review/frontend-data-fetching.md`

Inspect `git status --short`, `git diff --check`, and the complete S4 diff. Confirm:

- no raw `apiClient` or `fetch` in hooks/components;
- one Canvas Eden factory hook;
- every API consumer reads `response`;
- no client import from `server/repository`;
- no manual mirror of a Zod domain shape;
- no type re-export from client hooks or UI;
- no second permanent React Flow node store;
- no Portal, token, presence, or realtime code;
- no unrelated file changes.

Do not invoke any code-review skill.

- [ ] **Step 4: Run manual browser acceptance**

With `pnpm dev` and an authenticated existing project:

1. Open `/projects/<projectId>/canvas` and wait for the snapshot.
2. Confirm persisted elements render and tombstones do not render.
3. Create Sticky, Text, Card, and Heading from the toolbar.
4. Confirm each new element is positioned at the clicked flow coordinate, selected, and immediately editable.
5. Edit content, confirm with blur and `Ctrl/Cmd + Enter`, and cancel with Escape.
6. Move and resize all four types; confirm only one final API request is sent for each interaction.
7. Delete with the toolbar and `Delete`; confirm the node disappears and reload preserves the tombstone.
8. Refresh and confirm content, positions, dimensions, and active elements persist.
9. Test Select, Hand, zoom, reset, and initial fit on desktop and mobile-sized viewports.
10. Simulate a mutation failure and confirm rollback plus an actionable toast.
11. Confirm browser network activity contains no Portal token request or realtime connection.

- [ ] **Step 5: Record completion evidence without committing**

Capture the final command results and manual acceptance outcome in the session
summary. Leave the working tree available for the user to inspect. Do not create
or amend a commit unless the user separately requests it.

---

## Plan Self-Review

Spec coverage checked against `docs/superpowers/specs/2026-08-09-s4-local-elements-actions-spec.md`:

- Snapshot loading, explicit loading/error/retry states: Tasks 2 and 5.
- Single permanent `CanvasSnapshot` source and ephemeral previews: Tasks 2, 4, and 5.
- Shared LWW comparison and stale-response protection: Tasks 1 and 2.
- Optimistic create/update/move/resize/delete with conditional rollback: Task 2.
- Four element types, dimensions, Card parsing, and minimum sizes: Tasks 1 and 3.
- Shared CanvasActions API for UI and programmatic creation: Task 2.
- Toolbar, Select, Hand, one-shot insertion, delete, and keyboard rules: Task 4 and 5.
- React Flow node derivation, NodeResizer, coordinate conversion, and fitView: Tasks 3 and 5.
- S2 route reuse without contract changes: Task 2.
- No Portal/realtime/presence/offline queue: global constraints and Task 6 review.
- Automated, manual, and quality-command verification: Tasks 1-6.

The plan contains no unresolved placeholders, does not add a dependency, and
keeps all type signatures aligned with the existing Zod and Eden contracts.
