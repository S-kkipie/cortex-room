# S8 - Resiliencia y sincronización del canvas

**Fecha:** 2026-08-09
**Estado:** Implementada
**Dependencias:** S0 contratos Canvas, S4 acciones locales, S5 canal Portal autenticado, S6 operaciones multiplayer y S7 presence/awareness

## 1. Objetivo

Cerrar los casos de reconexión y carga concurrente sin degradar la respuesta
local del canvas. Las operaciones aceptadas por PostgreSQL deben conservar su
evento final hasta que Portal lo publique, el snapshot debe instalarse antes
de aplicar eventos remotos y la UI nunca debe afirmar que está sincronizada si
quedan publicaciones pendientes.

## 2. Resultado observable

- Portal se conecta y conserva un buffer acotado de mensajes válidos mientras
  el snapshot Eden todavía está cargando.
- Al instalar el snapshot, los mensajes históricos y live buffered se aplican
  una vez al controller mediante la misma validación, dedupe y LWW de S6.
- Los finales persistentes que no se puedan publicar quedan en un outbox en
  memoria, con máximo 100 mensajes, orden original y deduplicación por
  `eventId`.
- El outbox reintenta con backoff acotado y vuelve a intentar al reconectar;
  una operación posterior no adelanta a una anterior fallida.
- Los errores transitorios de persistencia se reintentan hasta tres intentos
  con backoff; una respuesta de negocio `applied: false` no se reintenta.
- Mientras exista un final pendiente, la UI muestra `Unsynced` y permite
  reintentar manualmente. Portal `ready` sin outbox pendiente vuelve a mostrar
  `Live`.
- Un cierre completo del navegador descarta el outbox; S8 no promete durable
  offline storage ni sincronización fuera de la sesión.

## 3. Alcance y límites

Incluye:

- buffer previo al snapshot, con capacidad bounded y drain ordenado;
- outbox de mensajes finales persistentes con retry, dedupe y observabilidad;
- reintentos bounded de requests de creación/actualización/eliminación ante
  errores de transporte retryable;
- integración con estado Portal, `CanvasConnectionStatus` y acción Retry;
- cleanup de timers/outbox al desmontar y pruebas de reconexión simulada.

No incluye:

- `localStorage`, IndexedDB, Service Worker, Background Sync o recuperación
  después de cerrar el navegador;
- persistencia de previews, cursor, selección o viewport;
- cambios a contratos de dominio, regla LWW, permisos Portal o backend de
  PostgreSQL fuera de la integración existente;
- CRDT, resolución automática de conflictos de negocio o replay ilimitado;
- cambios en `apps/meet-agent/`.

## 4. Contratos

### 4.1 Buffer de recepción

El buffer recibe únicamente `CanvasPortalMessage` ya normalizado por
`CanvasPortalProvider`. Su capacidad máxima es 200, igual que el history de
Portal. Antes de que exista snapshot, conserva los últimos mensajes y no muta
TanStack Query. Cuando el snapshot está disponible, el controller drena el
buffer y también procesa la ventana actual de Portal; la caché de `eventId` de
S6 hace idempotente la superposición history/live.

### 4.2 Outbox de publicación

El outbox acepta sólo finales `ephemeral: false`. La clave de dedupe es
`content.eventId`. Cada item contiene el mensaje completo y su estado local:

```ts
{
  eventId: string,
  attempts: number,
  failed: boolean
}
```

La política automática es máximo cinco intentos, con backoff creciente de
250 ms, 500 ms, 1 s y 2 s. Si falla el quinto intento, el item permanece
pendiente como `failed` sin bloquear el render; una acción manual Retry reinicia
su ciclo. El drain respeta FIFO. La cola sólo vive en memoria.

### 4.3 Retry de persistencia

Los transportes Eden reintentan errores sin status HTTP o con status `408`,
`429` o `5xx`, hasta tres intentos con 100 ms y 250 ms. Errores de validación,
autorización o negocio no se reintentan. El mismo command `eventId` se reutiliza
en cada intento, por lo que el servidor conserva idempotencia. `applied: false`
es una respuesta válida y sigue la reconciliación de S6 sin publicar un final.

### 4.4 Estado de sincronización

El controller expone `pendingPublishCount`, `hasUnsyncedChanges` y una acción
`retryPendingPublishes`. La UI combina ese estado con `CanvasPortalStatus`:

- `Unsynced` si `pendingPublishCount > 0`;
- `Live` sólo si Portal está `ready` y no hay pendientes;
- `Reconnecting`, `Degraded`, `Blocked` o `Unavailable` conservan sus estados
  explícitos cuando no hay un outbox pendiente.

El Retry manual no vuelve a ejecutar una mutación Eden ya aceptada: sólo reenvía
el final Portal pendiente.

## 5. Criterios de aceptación

### AC-01 Carga sin ventana perdida

Given un mensaje final llega antes que el snapshot
When el snapshot se instala
Then el mensaje se aplica una vez mediante LWW y no se pierde ni se duplica.

### AC-02 Publicación offline/reconnect

Given una mutación responde `applied: true` y Portal falla
When termina la acción local
Then el final queda en outbox, la UI indica `Unsynced` y el canvas conserva la
respuesta autoritativa local.

Given Portal vuelve a estar disponible
When el outbox hace flush
Then reenvía en FIFO, elimina sólo mensajes confirmados y vuelve a `Live` cuando
queda vacío.

### AC-03 Retry y dedupe

Given el mismo `eventId` se encola dos veces
When se procesa el outbox
Then Portal recibe una sola publicación lógica.

Given un error temporal de persistencia
When el request falla
Then se reintenta hasta tres veces con el mismo command; un error 4xx no se
reintenta y hace rollback según S4.

### AC-04 Orden y bounded memory

Given más de 100 publicaciones pendientes o más de 200 mensajes recibidos
When se agregan nuevos items
Then se conserva sólo la capacidad definida, se informa `Unsynced` y nunca se
crea una cola ilimitada.

### AC-05 Integración Portal/UI

Given Portal está `ready` y no hay pendientes
When se renderiza el canvas
Then el status dice `Live`. Given hay pendientes, muestra `Unsynced` y Retry
sin importar el SDK Portal directamente en componentes de interacción.

### AC-06 Aislamiento

Given se desmonta el canvas o cambia el proyecto
When se limpian recursos
Then se cancelan timers/listeners del outbox y buffer, no se publican mensajes
del proyecto anterior y no cambia ningún dominio fuera de Canva.

## 6. Pruebas y definición de terminado

- buffer: bounded, drain antes/después del snapshot, overlap history/live y
  dedupe;
- outbox: FIFO, dedupe, backoff, retry manual, cleanup, capacidad y estado;
- persistencia: retry de 408/429/5xx/network, no retry 4xx y rollback;
- provider/UI: `Unsynced`, Retry, transición de vuelta a `Live` y cleanup;
- `pnpm test`, `pnpm typecheck`, Biome enfocado de Canva y `pnpm build` pasan;
- cada tarea termina con revisión de `docs/code-review/README.md` y guías
  aplicables; cualquier hallazgo se corrige en la misma tarea;
- no cambia ningún archivo de `apps/meet-agent/`;
- S8 se entrega en un único commit y cierra los módulos S5-S8.
