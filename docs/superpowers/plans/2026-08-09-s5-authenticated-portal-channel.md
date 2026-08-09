# S5 Authenticated Portal Channel — Implementation Plan

## Constraints

- Scope is Canva only; never modify `apps/meet-agent/`.
- Follow `docs/code-review/README.md`, `types-schemas.md` and
  `frontend-data-fetching.md` at the end of every task. Do not invoke another
  code-review skill.
- Keep common response envelopes, zod boundary validation, `useElysia()` for
  API calls and one factory hook per domain.
- Commit once, and only once, after all S5 tasks and their reviews pass.

## Task 1 — Portal contracts, config and token service

- [x] Add the Portal dependencies and root `portal.config.ts` with
  `room-*` non-anonymous configuration.
- [x] Add optional typed env values and server/client config accessors.
- [x] Add a zod schema/types for the token response without duplicating domain
  types.
- [x] Implement the server-only token service: validate project existence,
  build the room scope and call Portal with the secret; parse the external
  response and map failures to `AsyncAppResult`.
- [x] Add focused service tests with an injected `fetch` seam; never use a real
  Portal credential in tests.
- [x] Run focused tests, then review the diff against `docs/code-review/`.
  Correct all findings before continuing.

## Task 2 — Authenticated token route and client provider

- [x] Add the `GET /portal/token` Elysia route with query validation,
  `authed: true`, response schemas and common errors; mount it in the Canva
  router.
- [x] Add the client-only Portal singleton/provider and token callback using
  `credentials: "include"`.
- [x] Normalize Portal messages with the Zod `canvasPortalMessageSchema` and
  verified Portal sender ID; discard invalid messages safely.
- [x] Expose `status`, `historyReady`, channel operations and configured state
  through `useCanvasPortal()`.
- [x] Add route/provider tests using controlled Portal and fetch mocks.
- [x] Run focused tests, `pnpm typecheck`, and review the complete task diff
  with `docs/code-review/`; fix findings in this task.

## Task 3 — Canvas wiring and connection status

- [x] Wrap only the Canva canvas subtree with `CanvasPortalProvider`, passing the
  authenticated project/user identity from the existing server boundary.
- [x] Delay S4 snapshot activation until the initial Portal buffer is ready,
  while allowing fallback loading when Portal is unconfigured/blocked.
- [x] Add an accessible compact connection-status indicator that does not call
  Portal or Eden directly from UI elements.
- [x] Cover unchanged S4 local behavior when Portal is unavailable.
- [x] Run `pnpm test`, `pnpm typecheck` and `pnpm build`; global `pnpm check`
  was run and reports only pre-existing diagnostics in `apps/meet-agent/`, which
  is outside this branch's Canva scope.
- [x] Review all changed files with `docs/code-review/README.md`,
  `types-schemas.md` and `frontend-data-fetching.md`; fix every finding.
- [x] Verify `git diff --name-only` contains no `apps/meet-agent/` files, then
  create the single commit:
  `feat(canvas): add authenticated Portal channel`.

## S5 verification checklist

- [x] `pnpm test`
- [x] `pnpm typecheck`
- [ ] `pnpm check` — blocked by pre-existing `apps/meet-agent/` diagnostics;
  no out-of-scope files were changed.
- [x] `pnpm build`
- [ ] `git status --short --branch` is clean after the S5 commit.
