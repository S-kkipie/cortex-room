# Final Fix Report

## Finding 1: `/start` state mutation before Recall bot creation

- Updated `/home/skkippie/work/AI-DO/cortex-room/apps/meet-agent/worker/worker.ts:95-114`.
- `createRecallBot` now runs first inside `try/catch`; failures return HTTP 502 with the error message and leave the session idle.
- `botId`, `t0Ms`, `state`, and `session.started` are set only after successful bot creation.

## Finding 2: Transcript timestamp anchoring

- Updated `/home/skkippie/work/AI-DO/cortex-room/apps/meet-agent/container/src/recall/webhook.ts:5-40` to return `anchorT0Ms`, derived from participant event absolute and relative timestamps, while returning `null` for unauthorized, malformed, or non-participant payloads.
- Updated `/home/skkippie/work/AI-DO/cortex-room/apps/meet-agent/worker/worker.ts:70,147-161` to retain the first anchor and use it for subsequent webhook mapping.
- Transcript mapping continues to use `MapCtx.t0Ms`; the DO now supplies the anchored value once available.

## Added webhook coverage

- `anchors participant events and not transcript events` in `/home/skkippie/work/AI-DO/cortex-room/apps/meet-agent/container/src/recall/__tests__/webhook.test.ts:28-55`.

## Verification

- `cd apps/meet-agent && pnpm test`: passed — 8 test files, 35 tests.
- `cd apps/meet-agent && pnpm typecheck`: passed — exit 0.
- Biome CLI was not present in the package dependencies, so no Biome command was available to run.

## Commit

- Implementation commit: `683459673797ced08d14c983999d3641813bd9f9`
