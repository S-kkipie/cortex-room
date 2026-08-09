# S7 Presence & Awareness — Implementation Plan

## Constraints

- Alcance exclusivo de Canva; no modificar `apps/meet-agent/`.
- Revisar cada tarea contra `docs/code-review/README.md`,
  `docs/code-review/types-schemas.md` y
  `docs/code-review/frontend-data-fetching.md`; no usar otra skill de revisión.
- Zod sigue siendo la fuente única de los contratos; Portal queda encapsulado
  en `CanvasPortalProvider`; React Flow recibe sólo view models de Canva.
- Awareness no toca el snapshot, no llama Eden y no se persiste.
- Un solo commit al terminar todas las tareas de S7:
  `feat(canvas): add multiplayer awareness`.

## Task 1 — Contratos y normalización de awareness

- [x] Crear builders de cursor/selección con los schemas S0 y
  `CanvasRealtimePort` de S6.
- [x] Normalizar participantes detailed/aggregate de Portal usando sus tipos
  inferidos; validar metadata antes de exponerla al canvas.
- [x] Derivar mapas de participantes, cursores y selecciones remotos con
  aislamiento por proyecto y exclusión del usuario actual.
- [x] Añadir pruebas de builders, metadata inválida, self-echo, participant
  leave y presencia aggregate.
- [x] Ejecutar tests enfocados y revisar todo el diff contra
  `docs/code-review/`; corregir hallazgos antes de continuar.

## Task 2 — Publicación y ciclo de vida de awareness

- [x] Conectar cursor local a `screenToFlowPosition` y publicar mensajes
  efímeros con throttle de 50 ms, cancelando timers al desmontar.
- [x] Publicar cambios de selección efímeros y actualizar Portal metadata con
  throttle de 250 ms; mantener no-op seguro cuando Portal no está disponible.
- [x] Integrar acciones/contexto sin imports de Portal desde los componentes
  de interacción y conservar selección/operaciones locales.
- [x] Cubrir cursor, selección, metadata throttle, cleanup y errores de send.
- [x] Ejecutar tests enfocados, `pnpm typecheck` y revisión de código de esta
  tarea; corregir hallazgos en el mismo task.

## Task 3 — Overlays y presencia visible

- [x] Renderizar cursores remotos dentro de `ViewportPortal`, usando nombre o
  identidad segura del participante y coordenadas de flow.
- [x] Renderizar selección remota como overlay de nodo independiente de
  `selected` local, con identidad legible y sin `NodeResizer` remoto.
- [x] Mostrar contador/roster compacto, limpiar participantes ausentes y
  mantener fallback graceful para presence aggregate/unavailable.
- [x] Añadir pruebas de React Flow, overlays, pan/zoom y accesibilidad básica.
- [x] Ejecutar `pnpm test`, `pnpm typecheck`, Biome enfocado y `pnpm build`;
  revisar todos los archivos cambiados con `docs/code-review/`.
- [x] Verificar que no haya cambios en `apps/meet-agent/` y crear el único
  commit de S7.

## S7 verification checklist

- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] Biome enfocado de Canva
- [x] `pnpm build`
- [ ] `git status --short --branch` limpio después del commit.
