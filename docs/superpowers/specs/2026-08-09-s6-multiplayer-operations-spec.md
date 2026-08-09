# S6 - Operaciones multiplayer del canvas

**Fecha:** 2026-08-09  
**Estado:** Implementada  
**Dependencias:** S0 contratos Canvas, S4 acciones locales y S5 canal Portal autenticado

## 1. Objetivo

Completar el flujo colaborativo de elementos sobre el canal Portal de S5. Cada
acción local debe seguir siendo inmediata, persistirse por el API del canvas y,
cuando la API la acepte, publicarse como evento final persistente. Los demás
clientes deben validar, deduplicar y aplicar esos eventos al mismo snapshot
canónico usando la misma regla LWW del servidor.

## 2. Resultado observable

- Crear, editar, mover, redimensionar y eliminar un elemento se refleja primero
  localmente, persiste por Eden y se replica a los demás clientes.
- Los eventos finales sólo se publican después de una respuesta
  `applied: true`; una respuesta `applied: false` instala el registro ganador y
  no publica el intento rechazado.
- Los ecos propios y eventos repetidos se ignoran sin duplicar elementos.
- Un evento con una versión anterior nunca pisa un registro o tombstone más
  nuevo y una eliminación más nueva nunca permite resucitar el elemento.
- Los movimientos y redimensiones muestran previews remotos efímeros
  throttled; la edición de texto muestra previews efímeros debounced y sólo el
  valor final llega al API.

## 3. Alcance y límites

Incluye:

- adaptador de mensajes final y preview basado en los schemas S0;
- publicación persistente después de persistencia autorizada;
- aplicación remota en `CanvasSnapshot` mediante `reconcileCanvasRecord`;
- deduplicación acotada por `eventId` y exclusión de eventos propios;
- previews de move, resize y texto sin persistencia;
- pruebas unitarias de mapping, dedupe, LWW y temporización.

No incluye:

- presencia nativa, cursores o selección remota visual (S7);
- buffer de eventos antes del snapshot, retry queue o indicador unsynced (S8);
- cambios en `apps/meet-agent/`;
- undo/redo, CRDT, revisiones históricas o cambios de viewport.

## 4. Contratos

### 4.1 Eventos finales

El envelope es `CanvasPortalMessage`, validado por
`canvasPortalMessageSchema`. El campo `senderId` enviado por el originador es
informativo; al recibir se sustituye por `message.sender.id` verificado por
Portal.

| Comando aceptado | `type` | `kind` | contenido |
| --- | --- | --- | --- |
| create | `workspace.element.created` | `workspace.element.created.final` | `element` activo autoritativo |
| update | `workspace.element.updated` | `workspace.element.updated.final` | `element` activo autoritativo |
| move | `workspace.element.moved` | `workspace.element.moved.final` | `element` activo autoritativo |
| resize | `workspace.element.resized` | `workspace.element.resized.final` | `element` activo autoritativo |
| delete | `workspace.element.deleted` | `workspace.element.deleted.final` | `tombstone` autoritativo |

El `eventId`, `projectId` y `occurredAt` del evento se toman del registro
autoritativo (`lastOperationId`, `projectId`, `lastOperationAt`) para satisfacer
la misma versión que usa PostgreSQL.

### 4.2 Previews

Los previews usan el mismo envelope con `ephemeral: true`:

- `workspace.element.moved.preview` con `elementId`, `x`, `y`;
- `workspace.element.resized.preview` con `elementId`, `width`, `height`;
- `workspace.element.updated.preview` con `elementId`, `content`.

Move/resize publican como máximo un preview cada `50 ms`, conservando el último
valor. Texto publica después de `100 ms` sin cambios y confirma la persistencia
después de `500 ms` de idle o cuando termina la edición. Ningún preview llama
al API ni muta el snapshot permanente.

### 4.3 Aplicación remota

El adaptador entrega únicamente mensajes ya validados y del `projectId` actual.
El controller vuelve a validar el evento en su frontera, registra el
`eventId` en una caché FIFO acotada y aplica sólo eventos finales. Los previews
se mantienen en un mapa efímero separado del snapshot.

La comparación de registros usa `(lastOperationAt, lastOperationId)`, timestamp
primero y UUID en minúsculas como desempate. Un evento igual o anterior es no-op.

## 5. Criterios de aceptación

### AC-01 Persistencia antes de publicación

Given una acción local válida  
When el API responde `applied: true`  
Then se publica exactamente un mensaje final persistente con el registro
autoritativo.

Given el API responde `applied: false` o falla  
When termina la acción  
Then no se publica un final rechazado y el estado sigue la política de S4/S8.

### AC-02 Replicación y LWW

Given un mensaje final válido de otro usuario  
When llega al canal  
Then el snapshot del cliente remoto refleja el registro o tombstone.

Given un evento viejo, duplicado o un eco propio  
When se aplica  
Then no cambia el snapshot ni crea duplicados.

### AC-03 Previews

Given otro usuario arrastra o redimensiona  
When publica previews  
Then el canvas remoto muestra el último valor efímero sin modificar el registro
persistente ni emitir una mutación por cada frame.

Given otro usuario edita texto  
When escribe continuamente  
Then el contenido remoto se actualiza con debounce y la persistencia ocurre una
sola vez al completar o quedar idle.

### AC-04 Aislamiento

Given un mensaje con schema inválido, `projectId` incorrecto o variante
desconocida  
When llega al adaptador/controller  
Then se descarta sin lanzar al render ni tocar otro proyecto.

### AC-05 Integración UI

Given cualquier interacción de React Flow  
When se publica o aplica una operación  
Then la UI llama acciones/contexto de Canva; ningún nodo, toolbar o editor
importa Portal ni construye claves Eden.

## 6. Pruebas y definición de terminado

- schemas: cada variante final/preview y reglas `type`/`ephemeral`;
- mapping: todos los comandos aceptados, `applied: false` y tombstones;
- controller: publicación posterior, dedupe, self-echo, stale LWW y delete;
- UI/contexto: previews locales siguen siendo instantáneos y se publican con
  throttle/debounce controlado;
- `pnpm test`, `pnpm typecheck`, Biome enfocado y `pnpm build` pasan;
- cada tarea termina con revisión de `docs/code-review/` y sus correcciones;
- ningún archivo de `apps/meet-agent/` cambia;
- S6 se entrega en un único commit después de todas las tareas.
