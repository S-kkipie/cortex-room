# S8 Resilience & Sync — Implementation Plan

## Constraints

- Alcance exclusivo de Canva; no modificar `apps/meet-agent/`.
- Revisar cada tarea contra `docs/code-review/README.md`,
  `docs/code-review/types-schemas.md` y
  `docs/code-review/frontend-data-fetching.md`; no usar otra skill de revisión.
- Zod sigue siendo la fuente única de wire contracts; el buffer/outbox son
  infraestructura cliente y no duplican schemas de dominio.
- Portal permanece detrás de `CanvasPortalProvider`; Eden/TanStack permanece en
  `useCanvas` factory; componentes UI sólo consumen el controller.
- Sólo memoria de sesión: no añadir `localStorage`, IndexedDB ni backend nuevo.
- Un solo commit al terminar todas las tareas de S8:
  `feat(canvas): add sync resilience`.

## Task 1 — Buffer de recepción y activación ordenada

- [x] Crear buffer acotado de `CanvasPortalMessage` con capacidad 200, dedupe
  local y drain seguro.
- [x] Conectar el buffer al provider/controller para retener mensajes hasta
  que exista el snapshot, procesando después history/live con dedupe S6.
- [x] Cancelar/limpiar el buffer al desmontar o cambiar de proyecto.
- [x] Añadir pruebas de mensaje previo al snapshot, overlap, límite y scope.
- [x] Ejecutar tests enfocados y revisar todo el diff contra
  `docs/code-review/`; corregir hallazgos antes de continuar.

## Task 2 — Outbox Portal de finales

- [x] Crear outbox FIFO bounded de 100 finales persistentes, con dedupe por
  `content.eventId`, backoff y máximo cinco intentos.
- [x] Integrar la publicación de finales de S6 con el outbox sin cambiar la
  regla `applied: true` ni reenviar `applied: false`.
- [x] Exponer snapshot de pendientes/failed, flush al reconectar y Retry
  manual; cancelar timers al desmontar.
- [x] Cubrir éxito, fallo, retry, orden, dedupe, límite y cleanup.
- [x] Ejecutar tests enfocados, `pnpm typecheck` y revisión de código de esta
  tarea; corregir hallazgos en el mismo task.

## Task 3 — Retry de persistencia y estado Unsynced

- [x] Añadir retry bounded para errores retryable de transportes Eden,
  reutilizando el command `eventId` y preservando rollback/error handling.
- [x] Conectar `pendingPublishCount` y `retryPendingPublishes` al controller/UI;
  mostrar `Unsynced` y botón Retry sin romper status Portal.
- [x] Cubrir no-retry 4xx/applied-false, transición `Unsynced` -> `Live`,
  Portal unavailable/reconnecting y accesibilidad del control.
- [x] Ejecutar `pnpm test`, `pnpm typecheck`, Biome enfocado y `pnpm build`;
  revisar todos los archivos cambiados con `docs/code-review/`.
- [x] Verificar que no haya cambios en `apps/meet-agent/` y crear el único
  commit de S8.

## S8 verification checklist

- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] Biome enfocado de Canva
- [x] `pnpm build`
- [x] `git status --short --branch` limpio después del commit.
