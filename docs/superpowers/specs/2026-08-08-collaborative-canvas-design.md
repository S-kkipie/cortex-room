# Collaborative Canvas Design

**Date:** 2026-08-08  
**Status:** Approved  
**Source:** `C:\Users\RONALD\Documents\Hackthon\PRD-CANVA`  
**Target repository:** `cortex-room`

## 1. Summary

Build the collaborative core of Living Canvas as a minimal Miro-like infinite canvas. Two or more authenticated users opening the same project URL can create, move, resize, edit, select, and delete canvas elements while seeing each other's presence, cursors, selections, and changes in realtime.

The implementation uses:

- React Flow as the infinite canvas and interaction engine;
- shadcn/ui for toolbar, zoom controls, connection status, participant UI, and basic element presentation;
- Portal as the only realtime transport;
- Elysia, Drizzle, and PostgreSQL for permanent state;
- Better Auth for application identity and route protection;
- Zod as the only source of domain and event types.

The canvas must remain useful without AI. Human UI and future AI tools must invoke the same canvas action API.

## 2. Goals

- Provide fluid local pan, zoom, selection, movement, resize, editing, and deletion.
- Synchronize permanent element operations through Portal.
- Display live presence, cursors, and remote selection.
- Restore permanent canvas state after reload.
- Expose a reusable programmatic canvas action API.
- Keep permanent and ephemeral state explicitly separated.
- Produce a demonstrable MVP in one to two days.

## 3. Non-goals

- Google Meet, transcription, AI chat, or AI-generated content.
- Public or anonymous canvas access.
- Organizations, invitations, roles, or explicit room membership.
- CRDT collaboration or Google Docs-level concurrent text editing.
- Undo/redo, comments, voting, templates, exports, version history, or activity feed.
- Freehand drawing, images, uploads, audio, video, or advanced shapes.
- Final branding, advanced animation, perfect responsive behavior, or dark-mode refinement.
- A marketing landing page or a new authentication UI.

## 4. Existing Project Context

The repository is a Next.js 16 and React 19 starter with:

- Better Auth email/password authentication;
- a protected `(app)` route group;
- an existing `/projects` CRUD screen;
- Elysia APIs under `/api/v1`;
- Drizzle and PostgreSQL;
- Eden and TanStack Query;
- shadcn/ui using the New York style;
- Vitest and Biome.

There is no existing room route, canvas engine, workspace element model, realtime integration, or browser-level test setup.

The existing `Project` domain remains the room directory. A project ID is reused as the canvas room ID to avoid introducing a duplicate Room domain during the hackathon.

## 5. Product Decisions

### 5.1 Room identity

- `projectId` is the permanent room identifier.
- The application route is `/projects/[projectId]/canvas`.
- The Portal channel ID is `room-${projectId}`.
- The project ID must be non-sequential and difficult to guess.

### 5.2 Access model

The canvas is private through authentication, but link-accessible among authenticated users:

- unauthenticated visitors are redirected to sign-in;
- after successful sign-in, the visitor returns to the original canvas URL;
- any authenticated user with a valid project canvas URL may enter;
- anonymous Portal connections are rejected;
- the canvas is not publicly listed or indexed;
- explicit memberships and invitations are outside the MVP.

This is an intentional exception to the starter's owner-only project access pattern. Regular project CRUD remains owner-scoped. Canvas access validates authentication and project existence but does not require project ownership.

This exception is an explicit product decision approved for the Canvas domain and supersedes the generic owner-only rule in `GEMINI.md` only for canvas snapshot access, canvas mutations, and room-scoped Portal token minting. No other domain receives this exception.

### 5.3 Realtime provider

Portal is the only realtime provider. Ably, Socket.IO, Supabase Realtime, and custom WebSocket infrastructure are not used.

Portal provides:

- standard channels;
- authenticated identities;
- presence;
- persistent messages for final operations;
- ephemeral messages for high-frequency previews;
- reconnection behavior;
- `PortalProvider` and `useChannel` React integration.

### 5.4 Canvas engine

React Flow is used instead of building coordinate transforms and interactions from scratch. It provides:

- infinite viewport behavior;
- pan and zoom;
- custom nodes;
- selection;
- drag handling;
- `NodeResizer`;
- viewport coordinate conversion;
- fit-view controls.

React Flow is an interaction and rendering adapter, not the domain state owner.

## 6. User Journeys

### 6.1 Owner opens a canvas

1. The authenticated owner creates or selects a project from `/projects`.
2. The owner chooses `Open canvas`.
3. The application opens `/projects/[projectId]/canvas`.
4. The client connects to Portal and loads the persisted element snapshot.
5. The canvas becomes interactive and displays connection status.

### 6.2 Collaborator opens a shared link

1. A collaborator opens the canvas URL.
2. If unauthenticated, the collaborator is redirected to sign-in with a sanitized relative return URL.
3. After sign-in, the collaborator returns to the same canvas URL.
4. The server validates that the project exists.
5. The collaborator joins the Portal channel with an identified user token.
6. Both users appear in presence.

### 6.3 Collaborative operation

1. User A invokes a canvas action through the toolbar, pointer, keyboard, or programmatic API.
2. The action updates User A's canonical local element state immediately.
3. High-frequency interaction previews publish through Portal when applicable.
4. The action initiator persists the final operation through Elysia.
5. After persistence succeeds, the initiator publishes the authoritative final operation through Portal.
6. User B validates and applies the operation to local state.
7. Reloading either client reconstructs the latest persisted state.

### 6.4 Programmatic creation

Calling `createElement` programmatically follows the exact same pipeline as a toolbar action. It appears locally, reaches other clients through Portal, and persists through the canvas API.

## 7. UI and Realtime Experience

### 7.1 Canvas shell

The canvas route uses a full-height editor layout. The generic starter header must not reduce the usable canvas area. Essential identity and sign-out controls may be placed in a compact canvas overlay or a canvas-specific layout.

### 7.2 Toolbar

The toolbar uses shadcn `Button`, `Tooltip`, and `Separator` components with Lucide icons.

Initial tools:

- Select;
- Hand/Pan;
- Sticky;
- Text;
- Card;
- Heading;
- Delete.

The selected tool has a visible active state. Selecting an insertion tool and clicking the canvas creates the element at the corresponding flow coordinate.

### 7.3 Zoom controls

Zoom controls use shadcn buttons and show:

- zoom out;
- current percentage;
- zoom in;
- fit/reset.

Viewport changes remain local and are never published or persisted.

### 7.4 Realtime feedback

- Local interactions update immediately without waiting for Portal or the API.
- Remote drag and resize previews update continuously through throttled ephemeral messages.
- Final drag and resize operations persist to PostgreSQL and then publish as persistent Portal messages.
- Text editing updates remotely after a short debounce and persists after pause or edit completion.
- Remote cursors include a participant label and render in canvas coordinates.
- Remote selection renders a participant-colored outline around the selected element.
- A compact presence area shows connected participants.
- A visible status indicator uses `Connecting`, `Live`, `Reconnecting`, and `Offline` states.
- Reconnection must not freeze local canvas interaction.

### 7.5 Shared link

A shadcn button may copy the current canvas URL. Manual URL copying is an acceptable fallback if schedule pressure requires cutting this button.

## 8. Architecture

### 8.1 Component boundaries

```text
Canvas Route
    |
    +-- Auth and project validation
    +-- Initial snapshot loading
    +-- PortalProvider
            |
            +-- Canvas Controller
                    |
                    +-- Canonical CanvasSnapshot state
                    +-- Canvas actions
                    +-- Portal adapter
                    +-- Persistence adapter
                    +-- Ephemeral awareness state
                            |
                            +-- React Flow adapter
                            +-- shadcn canvas controls
                            +-- Remote cursor and selection overlays
```

### 8.2 Domain boundaries

The new canvas domain follows the repository convention under `src/core/canvas/`:

- `domain/`: Zod schemas, inferred types, action and event contracts;
- `server/repository/`: Drizzle access to workspace elements;
- `server/services/`: project validation, snapshot loading, and mutations;
- `server/api/routes/`: authenticated Elysia leaf routes;
- `server/api/router.ts`: canvas router composition and prefix;
- `client/`: controller, Portal adapter, React Flow adapter, actions, hooks, and UI.

The canvas router must be registered in `src/server/router.ts`.

### 8.3 Canonical client state

`CanvasSnapshot` is the only canonical permanent client state. It contains active `WorkspaceElement` records plus an operation-version index that includes delete tombstones. React Flow nodes are derived only from active elements. React Flow callbacks dispatch canvas actions rather than independently mutating another node collection.

This avoids divergence between:

- domain elements;
- React Flow nodes;
- Portal operations;
- persisted records.

### 8.4 Permanent state

Permanent state includes:

- element identity and type;
- content;
- position;
- dimensions;
- creator;
- creation and update timestamps.

### 8.5 Ephemeral state

Ephemeral state includes:

- local viewport;
- local and remote selection;
- presence;
- cursor positions;
- active tool;
- hover state;
- drag and resize previews;
- edit draft timing;
- connection status;
- in-memory pending operations.

Ephemeral state is not stored in PostgreSQL.

## 9. Domain Model

Zod schemas are the only type source. Schemas live in `domain/schemas.ts`; `domain/types.ts` defines types exclusively through `z.infer`. Consumers import schemas from `schemas.ts` and inferred types from `types.ts`, without convenience re-exports.

```ts
const workspaceElementTypeSchema = z.enum([
    "STICKY",
    "TEXT",
    "CARD",
    "HEADING",
]);

const workspaceElementSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    type: workspaceElementTypeSchema,
    content: z.string(),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    height: z.number().positive(),
    createdBy: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    lastOperationAt: z.iso.datetime(),
    lastOperationId: z.string(),
});

const elementTombstoneSchema = z.object({
    id: z.string(),
    lastOperationAt: z.iso.datetime(),
    lastOperationId: z.string(),
    deletedAt: z.iso.datetime(),
});

const canvasSnapshotSchema = z.object({
    elements: z.array(workspaceElementSchema),
    tombstones: z.array(elementTombstoneSchema),
});
```

Card title and description are represented inside `content` for this MVP. The first line is the optional title and all remaining lines are the optional description. The editor joins them with one newline and trims only trailing empty lines. Introducing different database columns or a rich content union is unnecessary until a real card-specific consumer requires it.

## 10. Persistence Design

### 10.1 Database

Create a normalized `workspace_elements` table with:

- `id` primary key;
- `project_id` foreign key;
- `type` enum or constrained text;
- `content` text;
- `x` and `y` PostgreSQL double-precision values;
- `width` and `height` PostgreSQL double-precision values;
- `created_by` text containing the creator's user ID without a foreign key;
- `created_at` and `updated_at` timestamps.
- `last_operation_at` operation timestamp;
- `last_operation_id` deterministic tie-break key;
- `deleted_at` nullable timestamp used as a tombstone.

`project_id` references `projects.id` with `ON DELETE CASCADE`. Keeping `created_by` as plain text preserves audit identity if a user account is removed. Index `project_id` because every initial load queries all non-deleted elements for one project.

### 10.2 API surface

The authenticated canvas API provides:

```text
GET    /api/v1/canvas/:projectId/elements
POST   /api/v1/canvas/:projectId/elements
PUT    /api/v1/canvas/:projectId/elements/:elementId
DELETE /api/v1/canvas/:projectId/elements/:elementId
GET    /api/v1/portal/token?projectId=:projectId
```

All routes:

- use `.use(authed)` and `{ authed: true }`;
- return the `CommonResponse` envelope;
- return expected failures as `Result` values;
- validate params and bodies through Zod;
- validate project existence;
- reject anonymous requests.

Every Elysia leaf route also declares its response schema map and OpenAPI `detail.tags` and `detail.summary` metadata, following the canonical Project domain.

Canvas element mutations accept client-generated element IDs, allowing the optimistic local element, Portal event, and database row to share one identity.

Every mutation returns a discriminated result inside `CommonResponse`:

```ts
z.discriminatedUnion("applied", [
    z.object({ applied: z.literal(true), record: workspaceElementSchema.or(elementTombstoneSchema) }),
    z.object({ applied: z.literal(false), record: workspaceElementSchema.or(elementTombstoneSchema) }),
]);
```

`applied: false` means the incoming last-write-wins tuple was stale. The returned record is the authoritative current element or tombstone.

### 10.3 Persistence ownership

The client that originates a final operation persists it before publishing the final Portal message. Remote clients apply the authoritative Portal event but do not persist it again. Mutation endpoints are idempotent where practical so retries do not create duplicate elements.

High-frequency previews are never persisted. Only final operations reach mutation endpoints. Delete is a soft delete at the canvas-element layer so delayed operations can be compared against a tombstone; project deletion still removes all associated rows through cascade.

## 11. Canvas Action API

The canvas controller exposes:

```ts
createElement(input);
updateElement(elementId, changes);
moveElement(elementId, position);
resizeElement(elementId, dimensions);
deleteElement(elementId);
getElement(elementId);
getElements();
getSelectedElements();
```

Mutation actions perform five responsibilities through one pipeline:

1. validate the command;
2. update canonical local state optimistically;
3. publish ephemeral previews when the interaction benefits from live intermediate feedback;
4. persist final state through the canvas API;
5. reconcile local state with the authoritative API response and publish that final operation through Portal.

Optimistic elements use provisional local audit timestamps until the mutation response replaces them. Remote clients only receive final events containing server-authoritative `createdAt` and `updatedAt` values.

The controller publishes a final Portal operation only when the API returns `applied: true`. When it returns `applied: false`, the controller replaces its optimistic state with the authoritative record or tombstone and does not publish the rejected operation.

The UI must not call repositories, Elysia mutations, or Portal sends directly. Pointer callbacks, keyboard handlers, toolbar controls, and future AI tools call canvas actions.

## 12. Portal Event Contract

All event content is validated with a Zod discriminated union before local application.

Common operation fields:

```ts
{
    eventId: string;
    projectId: string;
    occurredAt: string;
    type: string;
    payload: unknown;
}
```

`actorId` is never trusted from event content. A receiving client takes the actor from Portal's verified `message.sender.id`. Mutation APIs take the actor from the Better Auth session. `createdBy` is assigned from that verified identity rather than accepted from the request body.

Clients generate `eventId` and `occurredAt` when an optimistic operation begins. The server stores these as `last_operation_id` and `last_operation_at`, while `created_at` and `updated_at` remain server-controlled audit timestamps. API responses replace optimistic audit timestamps with authoritative values.

Permanent element event types:

```text
workspace.element.created
workspace.element.updated
workspace.element.moved
workspace.element.resized
workspace.element.deleted
```

Ephemeral awareness event types:

```text
participant.cursor.moved
participant.selection.changed
```

Portal native presence is used for participant join and leave instead of duplicating it as application messages.

### 12.1 Message behavior

- Create and delete publish final persistent messages after their API mutations succeed.
- Move and resize previews are ephemeral messages.
- Move and resize completion persists first and then produces a final persistent message.
- Text previews are ephemeral and debounced.
- Text edit completion or a 500 ms idle period persists first and then produces a final persistent update.
- Cursor movement is ephemeral and throttled.
- Selection changes are ephemeral; presence metadata carries the latest fallback selection.

### 12.2 Echo and duplicate handling

Every operation has a unique `eventId`. The origin client records recently applied event IDs and ignores its own echoed message. Remote clients also ignore duplicate IDs. This cache is bounded and in-memory because it protects realtime rendering, not permanent business data.

### 12.3 Conflict behavior

The MVP uses last write wins based on the persisted tuple `(lastOperationAt, lastOperationId)`. The timestamp is compared first and `eventId` is the deterministic tie-break. Create, update, move, resize, and delete mutations only replace a row or tombstone when the incoming tuple is newer. Clients apply the same comparison and do not resurrect an element after a newer delete.

This approach intentionally accepts client clock-skew limitations for simultaneous edits to one element. Persisting the comparison tuple and delete tombstones keeps reload behavior deterministic despite that limitation. CRDT and server-issued revisions remain outside scope.

## 13. Cursor and Selection Coordinates

Pointer coordinates must be converted from screen coordinates to React Flow coordinates before publication. Remote cursor overlays render through the React Flow viewport so each client can maintain a different pan and zoom while pointing to the same canvas location.

Portal cursor behavior follows its recommended two-signal approach:

- ephemeral sends provide smooth live movement;
- throttled presence metadata provides a last-known fallback for newly joined users.

No cursor, selection, or viewport data is written to PostgreSQL.

## 14. Initial Load and Reconnection

### 14.1 Initial load

To avoid losing operations between snapshot fetch and realtime connection:

1. validate authentication and project existence;
2. mount `useChannel` with `history: 200` and begin buffering valid final operations;
3. wait until initial Portal history has populated or the channel is live;
4. fetch the persisted snapshot;
5. load the snapshot into canonical state;
6. apply buffered live and historical operations using persisted last-write-wins tuples and tombstones;
7. mark the canvas ready.

This ordering intentionally supersedes the PRD's illustrative `GET -> render -> connect` sequence because connecting and buffering first closes its lost-update window.

Final operations are always durable before publication. Therefore a joiner sees an operation either in PostgreSQL, in the live Portal stream, or in the bounded Portal history backfill. Old history entries are harmless because active elements and tombstones carry the same comparison tuple. Portal history is not treated as the database and is never used without reconciliation against the snapshot.

The editor may render a loading surface until the snapshot is installed, but connection status remains visible.

### 14.2 Reconnection

- Local interaction remains responsive while Portal reconnects.
- Final local operations that cannot be sent are retained in a bounded in-memory queue.
- The queue retries after reconnection in original order.
- Persistence failures retry independently with idempotent requests.
- If retries remain unsuccessful, the UI shows a compact unsynced state rather than claiming `Live`.
- Pending operations do not survive a full browser close in this MVP.

## 15. Authentication and Portal Tokens

Portal channels use identified users only. The application installs and locks `@portalsdk/core`, `@portalsdk/react`, and development dependency `@portalsdk/config`. The `@portalsdk/react` package supports the repository's React 19 runtime through its documented `>=18 <20` peer range.

The server endpoint `GET /api/v1/portal/token?projectId=:projectId`:

- requires a Better Auth session;
- validates that the requested project exists;
- uses the authenticated user ID as Portal identity;
- includes the display name or email-derived label needed for presence;
- sends `POST https://api.useportal.co/v1/tokens` with `Authorization: Bearer sk_...`;
- requests a one-hour token restricted to `{ [room-${projectId}]: ["connect", "publish"] }`;
- never exposes that credential to the browser.

The Portal client uses an async token callback so reconnect and expiry fetch a fresh room-scoped token. Portal configuration matches `room-*`, sets `anonymous: false`, and permits only capabilities granted by the token. A token minted for one project cannot connect to another project's channel.

The repository includes a root `portal.config.ts`:

```ts
import { defineConfig } from "@portalsdk/config";

export default defineConfig({
    channels: {
        "room-*": { anonymous: false },
    },
});
```

Before S5 acceptance, the developer authenticates the Portal CLI, deploys this configuration to the same environment as `pk_...` and `sk_...`, and registers `http://localhost:3000` plus the deployed application origin as allowed origins. Portal dashboard project/environment creation and credential issuance are external prerequisites, not application features.

Required environment variables:

```env
DATABASE_URL="postgres://..."
BETTER_AUTH_SECRET="..."
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXT_PUBLIC_PORTAL_API_KEY="pk_..."
PORTAL_SECRET_KEY="..."
```

`PORTAL_SECRET_KEY` contains the Portal `sk_...` control-plane credential used by `POST /v1/tokens`. It is server-only. `NEXT_PUBLIC_PORTAL_API_KEY` contains the browser-safe `pk_...` key used to construct the Portal client.

Optional Portal API and realtime URL overrides are not added unless local Portal infrastructure requires them.

## 16. Error Handling

### 16.1 Route and access errors

- Missing session redirects to sign-in with a safe relative return URL.
- Missing project returns a not-found state.
- Invalid project or element IDs return validation errors through `CommonResponse`.
- Canvas access never silently falls back to anonymous mode.

The canvas-specific route group is separate from the generic `(app)` layout so it can use a full-screen shell and preserve the exact deep link. Its unauthenticated redirect uses:

```text
/auth/sign-in?returnTo=%2Fprojects%2F{projectId}%2Fcanvas
```

The auth provider reads `returnTo`, decodes it once, and accepts it only when it starts with a single `/`, contains no backslash, and does not start with `//`. Invalid values fall back to `/projects`. After successful authentication, `redirectTo` uses this sanitized value. This prevents an open redirect and replaces the current hard-coded post-login destination only when a valid `returnTo` is present.

### 16.2 Snapshot errors

- Initial load failure shows a retry action.
- The client does not render an empty canvas as if it were a successful snapshot.
- Buffered events remain bounded while retrying.

### 16.3 Portal errors

- Connection status changes visibly.
- Invalid remote payloads are ignored and logged.
- Duplicate and self-echoed events are ignored.
- Temporary disconnection does not block local edits.

### 16.4 Persistence errors

- Optimistic state is not immediately rolled back because remote users may already have received the operation.
- Failed final writes enter the retry queue.
- An unsynced indicator remains visible until persistence succeeds or the user reloads.
- Error toasts are reserved for actionable failures and are not emitted for every retry.

## 17. Testing Strategy

### 17.1 Automated tests

Vitest covers:

- workspace element schema acceptance and rejection;
- each command schema;
- each Portal event variant;
- reducer/application behavior for create, update, move, resize, and delete;
- stale operation rejection under last write wins;
- event deduplication and self-echo handling;
- coordinate conversion helpers where isolated;
- service success, project-not-found, and persistence error results;
- authenticated route response contracts;
- programmatic `createElement` invoking the same transport and persistence ports.

Portal and persistence are represented behind small adapters so controller tests can use fakes without a live WebSocket or database.

### 17.2 Manual two-browser acceptance

Use two independent authenticated sessions and one shared canvas URL:

1. both participants appear online;
2. both see the other's cursor at the correct canvas position;
3. User A creates a sticky and User B sees it without refresh;
4. User B drags it and User A sees live movement plus the final position;
5. User A edits text and User B sees the change;
6. User B selects and resizes an element and User A sees both states;
7. User A deletes an element and it disappears for both;
8. both reload and see the last persisted canvas;
9. one client disconnects and reconnects without freezing local interaction;
10. a programmatic `createElement` appears locally, remotely, and after reload.

### 17.3 Quality commands

Each implementation slice must finish with the relevant subset of:

```text
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

## 18. SDD Task Decomposition

Implementation is divided into vertical slices. Each task must define an observable result, contracts, acceptance criteria, non-goals, errors, tests, and a concrete demonstration.

| ID | Slice | Observable deliverable | Estimate |
|---|---|---|---:|
| S0 | Canvas contracts | Zod element, snapshot, tombstone, command, and Portal event schemas; LWW and throttling rules; Canvas ownership exception added to `GEMINI.md` | 30-45m |
| S1 | Authenticated canvas shell | Protected deep link, post-login return, dependencies, providers, and route states | 45-60m |
| S2 | Persistent snapshot | Drizzle table, migration, canvas API, and reloadable element state | 90m |
| S3 | Navigable canvas | React Flow canvas with local pan, zoom, fit/reset, and shadcn controls | 60m |
| S4 | Local elements and actions | Four element types and create/select/edit/move/resize/delete through the shared action API | 2h |
| S5 | Authenticated Portal channel | Better Auth identity, room-scoped Portal token, deployed non-anonymous channel config, history policy, and connection status | 60-90m |
| S6 | Multiplayer operations | Realtime element operations, throttled previews, final persistence, echo deduplication, and LWW | 2h |
| S7 | Multiplayer awareness | Native presence, remote cursors, and remote selection overlays | 60-90m |
| S8 | Load and reconnect hardening | Snapshot event buffer, pending operation retry, reconnect state, and unsynced feedback | 60m |
| S9 | Acceptance and demo | Automated contract/controller tests and complete two-browser PRD demonstration | 60m |

Dependency order:

```text
S0 -> S1 -> S2 -> S3 -> S4 -> S5 -> S6 -> S7 -> S8 -> S9
```

Day-one target: S0 through S4.  
Day-two target: S5 through S9.

## 19. Scope Reduction Order

If time becomes constrained, preserve the vertical multiplayer demonstration rather than partially implementing every element type.

P0 required:

- authenticated shared canvas URL;
- sticky create, move, edit, and delete;
- pan and zoom;
- Portal presence and cursor;
- realtime sticky operations;
- persistence and reload;
- programmatic creation through canvas actions.

P0 after the core demonstration:

- resize;
- remote selection.

P1 reduction candidates:

- specialized visual differences among Text, Card, and Heading;
- copy-link button;
- polished participant avatars;
- detailed offline retry messaging.

Text, Card, and Heading may initially reuse one generic text element renderer while retaining distinct domain types. They must not delay the complete Sticky multiplayer flow.

## 20. Definition of Done

The collaborative canvas design is complete when:

- two authenticated users can open the same project canvas URL;
- unauthenticated deep links return to the canvas after sign-in;
- both users see presence, cursors, and remote selection;
- create, move, edit, resize, and delete propagate without refresh;
- the originating client persists final operations;
- reload reconstructs the last permanent state;
- viewport and awareness state remain unpersisted;
- programmatic actions use the same pipeline as human actions;
- schemas, controller behavior, and services pass automated tests;
- `pnpm typecheck`, `pnpm check`, and `pnpm build` pass;
- no Ably, CRDT, AI integration, or parallel realtime transport is introduced.

## 21. SDD Specification Template

Each task-specific specification created after this design uses:

```md
# Sx - Task name

## Objective
Describe the observable result of this slice.

## Dependencies
List completed slices and required credentials or services.

## Contracts
Define schemas, actions, events, endpoints, and component boundaries.

## Acceptance Criteria
Use Given/When/Then scenarios, including local, remote, and reload behavior where relevant.

## Non-goals
State what this slice intentionally does not implement.

## Error Cases
Cover authentication, validation, Portal, persistence, and duplicate events as applicable.

## Tests
Name the failing test first, minimum implementation, and manual verification.

## Definition of Done
List quality commands and the observable demonstration for this slice.
```

Task specifications must describe end-to-end behavior. Avoid layer-only tasks such as "build toolbar" or "add WebSocket." Prefer outcomes such as "create a sticky from the toolbar and recover it after reload."
