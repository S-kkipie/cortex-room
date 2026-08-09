# S3 Navigable Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the S1 canvas placeholder with a React Flow canvas that supports local pan, bounded zoom, visible shadcn controls, and reset to the origin without loading or persisting elements.

**Architecture:** Keep `CanvasShell` as a Server Component and place one client island, `NavigableCanvas`, in the flexible main region. Keep viewport constants and bounded zoom calculations in a small client-domain module, render controls as a provider-aware child, and pass an empty node/edge collection to React Flow. The viewport remains controlled in the client island and is never sent to S2, Portal, or the URL.

**Tech Stack:** Next.js 16, React 19, `@xyflow/react` 12.11.2, shadcn `Button`/`Tooltip`/`Separator`, Lucide, Vitest, `happy-dom`, Biome.

## Global Constraints

- `@xyflow/react` is the only new runtime dependency.
- `CanvasShell` remains a Server Component; only `NavigableCanvas` and its controls are client code.
- React Flow receives empty nodes and edges; S3 does not load or render the S2 snapshot.
- Viewport starts at `{ x: 0, y: 0, zoom: 1 }` and is bounded to `minZoom = 0.25` and `maxZoom = 2`.
- Zoom controls animate for 200 ms; reset uses `setViewport` toward the origin and zoom 1.
- The viewport is local and ephemeral: no Elysia request, PostgreSQL write, Portal event, query parameter, or `localStorage` entry.
- The background uses subtle dots and the control group is positioned in the bottom-right corner.
- Preserve accessible names, the S1 header, responsive actions, and React Flow attribution.
- Follow `docs/code-review/README.md`: keep code under `src/core/canvas/client`, do not add data-fetching hooks, and do not re-export borrowed types.
- Do not commit implementation changes unless the user explicitly requests a commit.

---

### Task 1: Add the viewport contract

**Files:**
- Modify: `package.json` through `pnpm add @xyflow/react@^12.11.2`
- Modify: `pnpm-lock.yaml` through the same package-manager command
- Create: `src/core/canvas/client/viewport.ts`
- Test: `src/core/canvas/client/__tests__/viewport.test.ts`

**Interfaces:**
- Consumes: `Viewport` from `@xyflow/react`.
- Produces: `INITIAL_VIEWPORT`, `MIN_ZOOM`, `MAX_ZOOM`, `VIEWPORT_ANIMATION_DURATION_MS`, `getNextZoom`, and `getZoomPercentage` for Tasks 2 and 3.

- [ ] **Step 1: Add the failing viewport tests**

Create `src/core/canvas/client/__tests__/viewport.test.ts` with the exact behaviors below:

```ts
import { describe, expect, it } from "vitest";
import {
    INITIAL_VIEWPORT,
    MAX_ZOOM,
    MIN_ZOOM,
    VIEWPORT_ANIMATION_DURATION_MS,
    getNextZoom,
    getZoomPercentage,
} from "@/core/canvas/client/viewport";

describe("canvas viewport contract", () => {
    it("starts at the origin with 100% zoom", () => {
        expect(INITIAL_VIEWPORT).toEqual({ x: 0, y: 0, zoom: 1 });
        expect(MIN_ZOOM).toBe(0.25);
        expect(MAX_ZOOM).toBe(2);
        expect(VIEWPORT_ANIMATION_DURATION_MS).toBe(200);
    });

    it("calculates bounded zoom steps", () => {
        expect(getNextZoom(1, "in")).toBe(1.2);
        expect(getNextZoom(1, "out")).toBeCloseTo(1 / 1.2);
        expect(getNextZoom(1.9, "in")).toBe(MAX_ZOOM);
        expect(getNextZoom(0.3, "out")).toBe(MIN_ZOOM);
    });

    it("rounds the visible zoom percentage", () => {
        expect(getZoomPercentage(1)).toBe(100);
        expect(getZoomPercentage(1.245)).toBe(125);
        expect(getZoomPercentage(0.25)).toBe(25);
    });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm vitest run src/core/canvas/client/__tests__/viewport.test.ts`

Expected: FAIL because `@/core/canvas/client/viewport` does not exist yet.

- [ ] **Step 3: Install the only new runtime dependency**

Run: `pnpm add @xyflow/react@^12.11.2`

Expected: `package.json` and `pnpm-lock.yaml` add `@xyflow/react`; no other runtime dependency is introduced.

- [ ] **Step 4: Implement the minimal viewport module**

Create `src/core/canvas/client/viewport.ts`:

```ts
import type { Viewport } from "@xyflow/react";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
export const ZOOM_FACTOR = 1.2;
export const VIEWPORT_ANIMATION_DURATION_MS = 200;

export const INITIAL_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

type ZoomDirection = "in" | "out";

export function getNextZoom(zoom: number, direction: ZoomDirection) {
    const nextZoom = direction === "in" ? zoom * ZOOM_FACTOR : zoom / ZOOM_FACTOR;

    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
}

export function getZoomPercentage(zoom: number) {
    return Math.round(zoom * 100);
}
```

Do not add a second camera state or a client hook. This module only centralizes the values and calculations used by the controls and React Flow adapter.

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `pnpm vitest run src/core/canvas/client/__tests__/viewport.test.ts`

Expected: 1 test file passes with 3 tests and 0 failures.

- [ ] **Step 6: Review Task 1 with `docs/code-review/`**

Review the staged/working diff directly against:

- `docs/code-review/README.md`: code belongs to `src/core/canvas/client` and introduces no API hook or server concern.
- `docs/code-review/types-schemas.md`: `Viewport` is imported as a type from its defining package; no mirror interface or type re-export is added.
- `docs/code-review/frontend-data-fetching.md`: no `apiClient`, Eden hook, query key, or hand-rolled data-fetching path is introduced because S3 has no data fetch.

Run: `git diff --check` and inspect `git diff -- package.json pnpm-lock.yaml src/core/canvas/client`

Expected: no whitespace errors and no unrelated files changed.

---

### Task 2: Implement viewport controls

**Files:**
- Modify: `vitest.config.ts` to include both `.test.ts` and `.test.tsx` files
- Create: `src/core/canvas/client/ui/canvas-viewport-controls.tsx`
- Test: `src/core/canvas/client/ui/__tests__/canvas-viewport-controls.test.tsx`

**Interfaces:**
- Consumes: `Viewport` from `@xyflow/react`, `useReactFlow`, and the viewport contract from Task 1.
- Produces: `CanvasViewportControls({ viewport }: { viewport: Viewport })`, a provider-aware control group for Task 3.

- [ ] **Step 1: Extend Vitest discovery for the client test**

Change only the `include` entry in `vitest.config.ts` from:

```ts
include: ["src/**/__tests__/**/*.test.ts"],
```

to:

```ts
include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
```

Keep the default environment as `node`; the component test opts into `happy-dom` with its file directive.

- [ ] **Step 2: Add failing control tests with a controlled React Flow mock**

Create `src/core/canvas/client/ui/__tests__/canvas-viewport-controls.test.tsx`. Use `// @vitest-environment happy-dom`, `react-dom/client`, and React `act`; do not add Testing Library. Mock only `useReactFlow` with hoisted spies:

```tsx
// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasViewportControls } from "@/core/canvas/client/ui/canvas-viewport-controls";

const flowMock = vi.hoisted(() => ({
    zoomTo: vi.fn(),
    setViewport: vi.fn(),
}));

vi.mock("@xyflow/react", () => ({
    useReactFlow: () => flowMock,
}));

function render(element: ReactElement) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => root.render(element));

    return {
        container,
        rerender(nextElement: ReactElement) {
            act(() => root.render(nextElement));
        },
        unmount() {
            act(() => root.unmount());
            container.remove();
        },
    };
}

afterEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
});

describe("CanvasViewportControls", () => {
    it("shows the current percentage and accessible actions", () => {
        const view = render(
            createElement(CanvasViewportControls, {
                viewport: { x: 0, y: 0, zoom: 1 },
            }),
        );

        expect(view.container.querySelector("fieldset")?.getAttribute("aria-label")).toBe(
            "Canvas zoom controls",
        );
        expect(view.container.textContent).toContain("100%");
        expect(view.container.querySelector('[aria-label="Zoom out"]')).not.toBeNull();
        expect(view.container.querySelector('[aria-label="Zoom in"]')).not.toBeNull();
        expect(view.container.querySelector('[aria-label="Reset viewport"]')).not.toBeNull();

        view.rerender(
            createElement(CanvasViewportControls, {
                viewport: { x: 18, y: -4, zoom: 1.25 },
            }),
        );
        expect(view.container.textContent).toContain("125%");
        view.unmount();
    });

    it("uses bounded zoom operations and reset animation", () => {
        const view = render(
            createElement(CanvasViewportControls, {
                viewport: { x: 0, y: 0, zoom: 1 },
            }),
        );

        act(() => {
            view.container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.click();
            view.container.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')?.click();
            view.container.querySelector<HTMLButtonElement>('[aria-label="Reset viewport"]')?.click();
        });

        expect(flowMock.zoomTo).toHaveBeenNthCalledWith(1, 1.2, { duration: 200 });
        expect(flowMock.zoomTo).toHaveBeenNthCalledWith(2, 1 / 1.2, { duration: 200 });
        expect(flowMock.setViewport).toHaveBeenCalledWith(
            { x: 0, y: 0, zoom: 1 },
            { duration: 200 },
        );
        view.unmount();
    });

    it("disables the operation that would exceed either zoom limit", () => {
        const view = render(
            createElement(CanvasViewportControls, {
                viewport: { x: 0, y: 0, zoom: 0.25 },
            }),
        );
        expect(
            view.container.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')?.disabled,
        ).toBe(true);
        expect(
            view.container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.disabled,
        ).toBe(false);

        view.rerender(
            createElement(CanvasViewportControls, {
                viewport: { x: 0, y: 0, zoom: 2 },
            }),
        );
        expect(
            view.container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.disabled,
        ).toBe(true);
        expect(
            view.container.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')?.disabled,
        ).toBe(false);
        view.unmount();
    });
});
```

- [ ] **Step 3: Run the focused control test and verify it fails**

Run: `pnpm vitest run src/core/canvas/client/ui/__tests__/canvas-viewport-controls.test.tsx`

Expected: FAIL because `CanvasViewportControls` does not exist yet.

- [ ] **Step 4: Implement the control group**

Create `src/core/canvas/client/ui/canvas-viewport-controls.tsx` with these rules:

```tsx
"use client";

import { Minus, Plus, RotateCcw } from "lucide-react";
import { useReactFlow, type Viewport } from "@xyflow/react";
import { Button } from "@/frontend/components/ui/button";
import { Separator } from "@/frontend/components/ui/separator";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/frontend/components/ui/tooltip";
import {
    INITIAL_VIEWPORT,
    MAX_ZOOM,
    MIN_ZOOM,
    VIEWPORT_ANIMATION_DURATION_MS,
    getNextZoom,
    getZoomPercentage,
} from "@/core/canvas/client/viewport";

export function CanvasViewportControls({ viewport }: { viewport: Viewport }) {
    const { setViewport, zoomTo } = useReactFlow();
    const percentage = getZoomPercentage(viewport.zoom);

    const zoom = (direction: "in" | "out") => {
        void zoomTo(getNextZoom(viewport.zoom, direction), {
            duration: VIEWPORT_ANIMATION_DURATION_MS,
        });
    };

    const reset = () => {
        void setViewport(INITIAL_VIEWPORT, {
            duration: VIEWPORT_ANIMATION_DURATION_MS,
        });
    };

    return (
        <TooltipProvider>
            <fieldset
                aria-label="Canvas zoom controls"
                className="absolute right-4 bottom-4 z-10 flex items-center rounded-lg border bg-background/95 p-1 shadow-lg backdrop-blur"
            >
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Zoom out"
                            disabled={viewport.zoom <= MIN_ZOOM}
                            onClick={() => zoom("out")}
                        >
                            <Minus />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>Zoom out</TooltipContent>
                </Tooltip>
                <span
                    aria-live="polite"
                    className="min-w-14 px-2 text-center font-medium text-xs tabular-nums"
                >
                    <span className="sr-only">Zoom </span>
                    {percentage}%
                </span>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Zoom in"
                            disabled={viewport.zoom >= MAX_ZOOM}
                            onClick={() => zoom("in")}
                        >
                            <Plus />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>Zoom in</TooltipContent>
                </Tooltip>
                <Separator orientation="vertical" className="mx-1 h-6" />
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Reset viewport"
                            onClick={reset}
                        >
                            <RotateCcw />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>Reset viewport</TooltipContent>
                </Tooltip>
            </fieldset>
        </TooltipProvider>
    );
}
```

Use the project formatter style rather than copying the compact snippet formatting verbatim. Keep the control component free of project IDs, snapshots, API calls, and borrowed type re-exports.

- [ ] **Step 5: Run the focused control tests and verify they pass**

Run: `pnpm vitest run src/core/canvas/client/ui/__tests__/canvas-viewport-controls.test.tsx`

Expected: 1 test file passes with 3 tests and 0 failures.

- [ ] **Step 6: Review Task 2 with `docs/code-review/`**

Review the diff against:

- `docs/code-review/README.md`: UI remains under the canvas domain and uses existing shadcn primitives.
- `docs/code-review/types-schemas.md`: `Viewport` is a type-only import from `@xyflow/react`; no duplicate interface and no re-export is added.
- `docs/code-review/frontend-data-fetching.md`: confirm this task has no raw API client, query hook, mutation hook, or envelope access because it is viewport-only.

Run: `git diff --check`, `pnpm typecheck`, and the focused Vitest command.

Expected: no whitespace errors, no new type errors, and all focused tests pass.

---

### Task 3: Mount the navigable canvas in the shell

**Files:**
- Create: `src/core/canvas/client/ui/navigable-canvas.tsx`
- Test: `src/core/canvas/client/ui/__tests__/navigable-canvas.test.tsx`
- Modify: `src/core/canvas/client/ui/canvas-shell.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: Task 1 viewport constants and Task 2 `CanvasViewportControls`.
- Produces: `NavigableCanvas`, a client island rendered by `CanvasShell`; empty React Flow nodes/edges, local controlled viewport, subtle dots, native pan/scroll/pinch behavior, and reset-compatible provider context.

- [ ] **Step 1: Add failing adapter tests with a focused React Flow mock**

Create `src/core/canvas/client/ui/__tests__/navigable-canvas.test.tsx` with `// @vitest-environment happy-dom`. Mock `ReactFlowProvider`, `ReactFlow`, `Background`, and `useReactFlow` so tests verify adapter props without depending on SVG layout or `ResizeObserver`:

```tsx
// @vitest-environment happy-dom

import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavigableCanvas } from "@/core/canvas/client/ui/navigable-canvas";

const flowMock = vi.hoisted(() => ({
    zoomTo: vi.fn(),
    setViewport: vi.fn(),
}));

vi.mock("@xyflow/react", () => ({
    BackgroundVariant: { Dots: "dots" },
    Background: (props: { variant: string; gap: number; size: number }) =>
        createElement("div", {
            "data-testid": "canvas-background",
            "data-variant": props.variant,
            "data-gap": props.gap,
            "data-size": props.size,
        }),
    ReactFlowProvider: ({ children }: { children: ReactNode }) =>
        createElement("div", { "data-testid": "react-flow-provider" }, children),
    ReactFlow: (props: {
        nodes: unknown[];
        edges: unknown[];
        minZoom: number;
        maxZoom: number;
        viewport: { x: number; y: number; zoom: number };
        children: ReactNode;
    }) =>
        createElement(
            "div",
            {
                "data-testid": "react-flow",
                "data-node-count": props.nodes.length,
                "data-edge-count": props.edges.length,
                "data-min-zoom": props.minZoom,
                "data-max-zoom": props.maxZoom,
                "data-zoom": props.viewport.zoom,
            },
            props.children,
        ),
    useReactFlow: () => flowMock,
}));

function render(element: ReactElement) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(element));
    return { container, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
});

describe("NavigableCanvas", () => {
    it("mounts an empty bounded flow with a dotted background and controls", () => {
        const view = render(createElement(NavigableCanvas));
        const flow = view.container.querySelector('[data-testid="react-flow"]');

        expect(flow?.getAttribute("data-node-count")).toBe("0");
        expect(flow?.getAttribute("data-edge-count")).toBe("0");
        expect(flow?.getAttribute("data-min-zoom")).toBe("0.25");
        expect(flow?.getAttribute("data-max-zoom")).toBe("2");
        expect(flow?.getAttribute("data-zoom")).toBe("1");
        expect(
            view.container.querySelector('[data-testid="canvas-background"]')?.getAttribute(
                "data-variant",
            ),
        ).toBe("dots");
        expect(view.container.querySelector("fieldset")).not.toBeNull();
        view.unmount();
    });
});
```

The adapter test must remain a `.test.tsx` file so Vitest discovers it after Task 2's config change.

- [ ] **Step 2: Run the focused adapter test and verify it fails**

Run: `pnpm vitest run src/core/canvas/client/ui/__tests__/navigable-canvas.test.tsx`

Expected: FAIL because `NavigableCanvas` does not exist yet.

- [ ] **Step 3: Implement the client canvas adapter**

Create `src/core/canvas/client/ui/navigable-canvas.tsx`:

```tsx
"use client";

import {
    Background,
    BackgroundVariant,
    type Edge,
    type Node,
    ReactFlow,
    ReactFlowProvider,
    type Viewport,
} from "@xyflow/react";
import { useState } from "react";
import { CanvasViewportControls } from "@/core/canvas/client/ui/canvas-viewport-controls";
import {
    INITIAL_VIEWPORT,
    MAX_ZOOM,
    MIN_ZOOM,
} from "@/core/canvas/client/viewport";

const EMPTY_NODES: Node[] = [];
const EMPTY_EDGES: Edge[] = [];

export function NavigableCanvas() {
    const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);

    return (
        <div
            data-testid="navigable-canvas"
            className="relative size-full overflow-hidden"
        >
            <ReactFlowProvider>
                <ReactFlow
                    nodes={EMPTY_NODES}
                    edges={EMPTY_EDGES}
                    viewport={viewport}
                    onViewportChange={setViewport}
                    minZoom={MIN_ZOOM}
                    maxZoom={MAX_ZOOM}
                    panOnDrag
                    zoomOnScroll
                    zoomOnPinch
                    aria-label="Canvas"
                >
                    <Background
                        variant={BackgroundVariant.Dots}
                        gap={24}
                        size={1}
                        color="var(--border)"
                        style={{ opacity: 0.55 }}
                    />
                </ReactFlow>
                <CanvasViewportControls viewport={viewport} />
            </ReactFlowProvider>
        </div>
    );
}
```

Use an explicit `Viewport` type import, keep the empty arrays module-stable, and do not add `fitView`, `localStorage`, query state, snapshot queries, or Portal wiring. Preserve React Flow attribution by not setting `proOptions.hideAttribution`.

- [ ] **Step 4: Replace only the shell placeholder and add global React Flow CSS**

In `src/core/canvas/client/ui/canvas-shell.tsx`:

- import `NavigableCanvas` from the same canvas UI domain;
- keep the existing server component signature and header controls unchanged;
- replace the padded centered placeholder `<section>` with:

```tsx
<main className="relative flex min-h-0 flex-1 overflow-hidden">
    <NavigableCanvas />
</main>
```

In `src/app/globals.css`, add the official stylesheet import with the other top-level imports:

```css
@import "@xyflow/react/dist/style.css";
```

Do not import the stylesheet from a client component or add another global CSS entry point.

- [ ] **Step 5: Run focused tests and verify the adapter is green**

Run: `pnpm vitest run src/core/canvas/client/__tests__/viewport.test.ts src/core/canvas/client/ui/__tests__/canvas-viewport-controls.test.tsx src/core/canvas/client/ui/__tests__/navigable-canvas.test.tsx`

Expected: all S3-focused test files pass with 0 failures.

- [ ] **Step 6: Review Task 3 with `docs/code-review/`**

Review the diff against:

- `docs/code-review/README.md`: the client UI stays in `src/core/canvas/client`; no server-only imports or route API changes are introduced.
- `docs/code-review/types-schemas.md`: no hand-written canvas domain mirror, no borrowed type re-export, and all React Flow types are imported from their defining module.
- `docs/code-review/frontend-data-fetching.md`: confirm S3 has no raw `apiClient`, query, mutation, or direct envelope access because the spec explicitly forbids S2 reads.

Check the implementation manually for the S1 boundary: `CanvasShell` remains server-renderable and only `NavigableCanvas` is client code.

Run: `git diff --check`, `pnpm typecheck`, and `pnpm check`.

Expected: no whitespace errors, no type errors, and no Biome diagnostics attributable to S3.

---

### Task 4: Full verification and manual acceptance

**Files:**
- Verify: all files changed by Tasks 1-3
- No new implementation files

**Interfaces:**
- Consumes: the complete S3 implementation and focused tests.
- Produces: evidence for the spec's automated quality commands and manual acceptance checklist.

- [ ] **Step 1: Run the full automated suite**

Run: `pnpm test`

Expected: all existing and S3 tests pass; the opt-in PostgreSQL integration test may remain skipped when `CANVAS_TEST_DATABASE_URL` is unset.

- [ ] **Step 2: Run typecheck, lint, and build**

Run these commands separately:

```text
pnpm typecheck
pnpm check
pnpm build
```

Expected: each command exits with code 0. If the repository reports a pre-existing diagnostic, identify it by file and do not attribute it to S3 without evidence.

- [ ] **Step 3: Perform manual browser acceptance**

With `pnpm dev` and an authenticated existing project:

1. Open `/projects/<projectId>/canvas` and confirm the S1 header remains available.
2. Confirm the placeholder is gone and the empty dotted React Flow surface fills the region below the header.
3. Drag the empty background; confirm local pan and no page scroll.
4. Use wheel and pinch when available; confirm zoom stays between 25% and 200%.
5. Use `Zoom out`, `Zoom in`, and `Reset viewport`; confirm the percentage and reset target.
6. Reload; confirm the camera returns to origin at 100%.
7. Confirm no snapshot request, mutation request, or Portal connection is introduced by S3.
8. Repeat at a narrow viewport and confirm back and sign-out remain reachable.

- [ ] **Step 4: Run the final project-specific review**

Use only `docs/code-review/` for this review. Inspect `git diff`, `git status`, and the exact changed files. Confirm there are no unrelated changes, no data-fetching abstraction violations, no duplicated schemas/types, and no type re-exports. Do not invoke a code-review skill.
