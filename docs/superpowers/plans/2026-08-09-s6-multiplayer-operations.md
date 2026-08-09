# S6 Multiplayer Operations — Implementation Plan

## Constraints

- Alcance exclusivo de Canva; no modificar `apps/meet-agent/`.
- Revisar cada tarea con `docs/code-review/README.md`, `types-schemas.md` y
  `frontend-data-fetching.md`; no usar otra skill de revisión.
- Mantener Zod como fuente única, `reconcileCanvasRecord` como frontera LWW,
  Portal detrás de `CanvasPortalProvider` y Eden/TanStack en el factory hook.
- Un solo commit al terminar todas las tareas de S6:
  `feat(canvas): add multiplayer canvas operations`.

## Task 1 — Contratos y adaptadores de eventos

- [x] Crear builders tipados para eventos finales y previews usando los schemas
  existentes, con reglas explícitas de `type` y `ephemeral`.
- [x] Añadir un publicador desacoplado de Portal SDK que permita probar sends
  persistentes/efímeros con fakes.
- [x] Cubrir mapping de create/update/move/resize/delete, `applied: false`,
  tombstones y throttle/debounce en pruebas unitarias.
- [x] Ejecutar tests enfocados y revisar el diff contra `docs/code-review/`;
  corregir cualquier hallazgo antes de continuar.

## Task 2 — Operaciones finales remotas y LWW

- [x] Conectar el controller al publicador de S5: persistir primero, publicar
  sólo el registro autoritativo cuando `applied: true`.
- [x] Aplicar mensajes finales recibidos al snapshot canónico mediante
  `reconcileCanvasRecord`, con validación, scope de proyecto y caché FIFO de
  `eventId` para duplicados/ecos propios.
- [x] Mantener los previews fuera del snapshot y hacer que los consumers no
  persistan eventos remotos.
- [x] Añadir pruebas de controller/contexto para replicación, dedupe, self-echo,
  stale LWW y delete tombstone.
- [x] Ejecutar tests enfocados, `pnpm typecheck` y revisión de código de esta
  tarea; corregir hallazgos en el mismo task.

## Task 3 — Previews de interacción y texto

- [x] Publicar previews de move/resize como máximo cada `50 ms`, conservando el
  último valor y cancelando timers al desmontar.
- [x] Publicar previews de texto tras `100 ms` de debounce y confirmar el valor
  final tras `500 ms` de idle o blur/confirmación explícita, sin duplicar la
  mutación.
- [x] Conectar las callbacks existentes de React Flow/editor al controller sin
  imports directos de Portal en UI y conservar la respuesta local inmediata.
- [x] Cubrir timers, cancelación, edición sin cambios y errores de persistencia.
- [x] Ejecutar `pnpm test`, `pnpm typecheck`, Biome enfocado y `pnpm build`;
  revisar todos los archivos cambiados con `docs/code-review/`.
- [x] Verificar que no haya cambios en `apps/meet-agent/` y crear el único
  commit de S6.

## S6 verification checklist

- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] Biome enfocado de Canva
- [x] `pnpm build`
- [ ] `git status --short --branch` limpio después del commit.
