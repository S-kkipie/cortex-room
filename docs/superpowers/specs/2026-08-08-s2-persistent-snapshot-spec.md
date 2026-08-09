# S2 - Persistent Canvas Snapshot

**Fecha:** 2026-08-08  
**Estado:** Implementada  
**Diseño padre:** `docs/superpowers/specs/2026-08-08-collaborative-canvas-design.md`  
**Dependencias:** S0 Canvas Contracts y S1 Authenticated Canvas Shell  
**Estimación original:** 90 minutos

## 1. Objetivo

Persistir el estado permanente de un canvas por proyecto y exponer una API
autenticada para cargar el snapshot, crear, actualizar, mover, redimensionar y
eliminar elementos.

Al terminar S2, un consumidor puede escribir elementos con IDs generados por el
cliente, recuperar el estado después de una recarga y resolver operaciones
fuera de orden mediante last-write-wins (LWW) sin que un evento viejo resucite
un elemento eliminado por una operación más nueva.

S2 no agrega todavía React Flow, Portal, presencia, cursores, toolbar, hooks de
cliente ni edición visual. La demostración se realiza mediante la API, los
servicios y los tests.

## 2. Resultado observable

Un usuario autenticado puede:

- solicitar el snapshot permanente de un proyecto existente;
- crear un elemento de tipo `STICKY`, `TEXT`, `CARD` o `HEADING`;
- actualizar su contenido, posición o dimensiones;
- eliminarlo y recibir un tombstone;
- repetir una operación sin crear filas duplicadas;
- enviar una operación stale y recibir el record autoritativo con
  `applied: false`;
- eliminar un ID todavía ausente y dejar un tombstone que protege contra un
  create retrasado;
- acceder al canvas de un proyecto existente sin ownership, manteniendo el
  CRUD de Project owner-only.

## 3. Dependencias y límites

S2 usa:

- los schemas Zod de `src/core/canvas/domain/`;
- Better Auth mediante `authed`;
- Drizzle ORM y PostgreSQL;
- el envelope `CommonResponse` y `AsyncAppResult`;
- las rutas y el servicio de validación de proyecto creados en S1.

S2 no modifica `package.json`, no agrega dependencias y no requiere un servicio
Portal o credenciales de realtime.

## 4. Modelo persistente

### 4.1 Tabla

La migración crea `workspace_elements` y el enum PostgreSQL
`workspace_element_type`.

| Columna | Persistencia | Regla |
|---|---|---|
| `id` | `text`, primary key | ID del elemento generado por el cliente |
| `project_id` | `text`, FK | referencia `projects.id` con `ON DELETE CASCADE` |
| `type` | enum nullable | requerido en una fila activa |
| `content` | text nullable | requerido en una fila activa |
| `x`, `y` | double precision nullable | requeridos en una fila activa |
| `width`, `height` | double precision nullable | requeridos y positivos en una fila activa |
| `created_by` | text nullable | requerido en una fila activa; no tiene FK |
| `created_at`, `updated_at` | timestamp(3) with time zone nullable | requeridos en una fila activa y asignados por el servidor |
| `last_operation_at` | timestamp(3) with time zone | versión LWW |
| `last_operation_id` | text | desempate LWW |
| `deleted_at` | timestamp(3) with time zone nullable | marca una fila tombstone |

Una tabla única permite conservar la versión de un ID eliminado. Las columnas
del payload son nullable físicamente para permitir un tombstone mínimo creado
por un delete de un ID ausente. Un check constraint exige el payload completo
cuando `deleted_at IS NULL` y dimensiones positivas para filas activas.

Los IDs son globales en la tabla. Si un ID ya pertenece a otro proyecto, la
mutación responde `409 CONFLICT` sin devolver datos de ese proyecto.

### 4.2 Tombstones

Una fila eliminada se incluye en `CanvasSnapshot.tombstones` y no en
`elements`. El delete de una fila existente conserva el payload físico, pero el
mapper solo expone identidad, proyecto, versión y `deletedAt`. El delete de una
fila ausente crea una fila con payload nulo.

Un create posterior y más nuevo puede reactivar cualquier tombstone. Un
update, move o resize posterior puede reactivar un tombstone que conserva el
payload completo. Un tombstone mínimo no tiene suficiente información para
reactivarse mediante una mutación parcial y responde `404`.

## 5. Contratos de servicio y repository

### 5.1 Mapper

`src/core/canvas/server/repository/utils.ts` expone:

```ts
toCanvasRecord(row: WorkspaceElementRow): WorkspaceElement | ElementTombstone
toCanvasSnapshot(projectId: string, rows: WorkspaceElementRow[]): CanvasSnapshot
```

El mapper convierte `Date` a timestamps ISO con milisegundos, rechaza payloads
activos incompletos y valida el snapshot final con `canvasSnapshotSchema`.

### 5.2 Snapshot repository y service

`findCanvasSnapshotRows(projectId)` bloquea el proyecto dentro de una
transacción, carga filas activas y tombstones ordenadas por ID y devuelve
`project_not_found` si el proyecto desaparece antes de la lectura.

`getCanvasSnapshotService(projectId)`:

1. valida y bloquea la existencia del proyecto dentro de la transacción;
2. no filtra por `userId` ni por `status`;
3. carga las filas del proyecto en la misma transacción;
4. construye y valida `CanvasSnapshot`;
5. retorna errores esperados como `AsyncAppResult`.

### 5.3 Mutación repository

`applyCanvasCommand(command, actorId)` retorna una de estas variantes internas:

```ts
{ kind: "applied" | "stale"; row: WorkspaceElementRow }
{ kind: "not_found" }
{ kind: "conflict" }
```

La comparación LWW se hace dentro de la sentencia SQL, no mediante un
read-compare-write separado:

```text
incoming timestamp > stored timestamp
OR
incoming timestamp = stored timestamp
AND incoming eventId > stored eventId
```

Create y delete usan `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE`. Update,
move y resize usan un `UPDATE ... WHERE` condicionado por la misma tupla. Si la
sentencia no retorna una fila, el repository vuelve a leer el ID solo para
clasificar el resultado como stale, conflicto entre proyectos o not-found. Ese
flujo corre dentro de una transacción que bloquea el proyecto y reintenta una
vez un update cuando un elemento apareció entre el `UPDATE` y la clasificación.

El actor no se toma del comando: `createdBy` siempre recibe el ID de la sesión
Better Auth. `createdAt`, `updatedAt` y `deletedAt` se asignan en el servidor.

### 5.4 Mutation service

`applyCanvasCommandService(actorId, projectId, command, routeElementId?)`:

- valida que el `projectId` del body coincida con la ruta;
- valida que `elementId` coincida con la ruta en PUT y DELETE;
- valida que el proyecto exista sin ownership;
- delega el comando con el actor autenticado;
- transforma el row autoritativo a `CanvasMutationResult`;
- no revela la fila de un proyecto distinto.

## 6. API autenticada

Todas las rutas usan `.use(authed)` y `authed: true`, validan parámetros y body
con Zod, declaran schemas de respuesta y contienen metadata OpenAPI.

### 6.1 Cargar snapshot

```text
GET /api/v1/canvas/:projectId/elements
```

Respuesta exitosa:

```ts
CommonResponse.successful({ response: CanvasSnapshot })
```

Respuestas de error: `400` por parámetros inválidos, `404` si el proyecto no
existe y `500` por fallo inesperado.

### 6.2 Crear

```text
POST /api/v1/canvas/:projectId/elements
```

Body: `createElementCommandSchema`.

- operación aplicada: `201 CREATED` con `CanvasMutationResult`;
- operación stale/idempotente: `200 OK` con `applied: false`;
- errores: `400`, `404`, `409` o `500`.

### 6.3 Actualizar, mover o redimensionar

```text
PUT /api/v1/canvas/:projectId/elements/:elementId
```

Body: unión discriminada de `updateElementCommandSchema`,
`moveElementCommandSchema` y `resizeElementCommandSchema`.

La respuesta exitosa siempre usa `200 OK` y contiene
`CanvasMutationResult`. Una operación stale conserva HTTP 200 y devuelve
`applied: false` con el record ganador.

### 6.4 Eliminar

```text
DELETE /api/v1/canvas/:projectId/elements/:elementId
```

Body: `deleteElementCommandSchema`.

La respuesta exitosa usa `200 OK`. El delete de un ID ausente también es una
operación aplicada y devuelve el tombstone creado.

## 7. Criterios de aceptación

### AC-01 Snapshot vacío

Given un proyecto existente sin elementos  
When un usuario autenticado solicita el snapshot  
Then recibe `200`, `response.projectId` correcto y arrays vacíos.

### AC-02 Snapshot persistido

Given filas activas y tombstones del mismo proyecto  
When se solicita el snapshot  
Then los elementos activos aparecen en `elements` y los eliminados en
`tombstones`.

### AC-03 Create

Given un comando create válido  
When se envía a POST  
Then se crea una fila activa con el ID del comando y `createdBy` de la sesión.

### AC-04 Mutaciones parciales

Given un elemento activo  
When se envía update, move o resize con una versión nueva  
Then solo cambia el payload correspondiente, se actualiza la versión y el
resultado es `applied: true`.

### AC-05 Delete existente

Given un elemento activo  
When se envía delete  
Then deja de aparecer en `elements`, aparece en `tombstones` y no se elimina la
fila física.

### AC-06 Delete ausente

Given un ID sin fila  
When se envía delete  
Then se crea un tombstone y se responde `applied: true`.

### AC-07 LWW stale

Given una fila con una versión más nueva  
When llega una operación con timestamp menor o mismo timestamp e ID menor  
Then no se modifica la fila, se devuelve el estado autoritativo y
`applied: false`.

### AC-08 LWW tie-break

Given dos operaciones con el mismo timestamp  
When sus IDs difieren  
Then gana lexicográficamente el ID mayor.

### AC-09 Reintento idéntico

Given una operación ya aplicada  
When se repite con la misma tupla  
Then no se crea una fila adicional y se devuelve el estado actual como stale.

### AC-10 Protección de tombstone

Given un tombstone con una versión nueva  
When llega un create, update o evento viejo  
Then el evento viejo no resucita el elemento y el snapshot conserva el
tombstone.

### AC-11 Acceso compartido

Given un usuario autenticado que no es owner  
When solicita o muta el canvas de un proyecto existente  
Then la operación se permite; el CRUD de Project permanece owner-only.

### AC-12 Colisión entre proyectos

Given un `elementId` que pertenece a otro proyecto  
When se intenta mutar desde el proyecto solicitado  
Then responde `409 CONFLICT` sin exponer el record ajeno.

### AC-13 Validación de ruta

Given un body cuyo `projectId` o `elementId` contradice la URL  
When se envía la mutación  
Then responde `400 INVALID_BODY` y no escribe en PostgreSQL.

## 8. Casos de error y límites

- Un visitante anónimo recibe `401` desde `authed`.
- Un proyecto inexistente produce `404`, no un snapshot vacío.
- Un ID de elemento ausente produce `404` para update, move y resize, pero
  delete crea tombstone.
- Un tombstone mínimo no puede reactivarse con una mutación parcial.
- Una colisión global de ID produce `409` sin filtrar datos.
- Los campos `actorId`, `createdBy` y timestamps de auditoría del cliente no
  controlan la identidad ni la auditoría del record final.
- Los campos desconocidos del body fallan mediante los schemas strict de S0.
- Los payloads no finitos o dimensiones no positivas fallan antes del service.
- `occurredAt` admite clock skew de hasta cinco minutos hacia el futuro; fechas
  posteriores se rechazan con `400 INVALID_BODY`. Las fechas antiguas siguen
  siendo válidas para clasificar operaciones stale.
- Los tombstones no se compactan en S2: cualquier retención requiere una
  política compatible con la ventana de history de Portal y no se puede elegir
  arbitrariamente sin riesgo de resucitar operaciones antiguas.
- S2 no implementa reintentos de Portal, buffers de history ni cola de
  operaciones pendientes.
- S2 no puede comprobar concurrencia real sin PostgreSQL; la sentencia SQL
  mantiene la atomicidad y la migración se verifica manualmente en una base
  configurada.

## 9. Tests

La cobertura automatizada incluye:

- mapeo de filas activas a `WorkspaceElement`;
- mapeo de tombstones mínimos a `ElementTombstone`;
- separación y validación del snapshot;
- comparación LWW por timestamp e ID;
- rechazo de timestamps futuros fuera de la ventana de clock skew;
- snapshot exitoso, proyecto inexistente y error de repository;
- identidad autenticada entregada al repository;
- resultado aplicado y stale;
- mismatch de IDs de ruta/body;
- conflicto entre proyectos;
- elemento ausente.
- registro de rutas y respuesta `401` para solicitudes anónimas;

La verificación manual de PostgreSQL consiste en aplicar la migración, ejecutar
create/update/delete mediante una sesión autenticada, consultar el snapshot y
enviar operaciones nuevas y stale en orden inverso.

La prueba de integración opt-in automatiza ese flujo cuando
`CANVAS_TEST_DATABASE_URL` apunta a una base PostgreSQL desechable:

```text
CANVAS_TEST_DATABASE_URL=postgres://... pnpm test:canvas:integration
```

Sin esa variable, la prueba queda omitida para que `pnpm test` siga siendo
unitario y no dependa de infraestructura externa.

## 10. Archivos implementados

```text
src/server/drizzle/schemas/workspace-element-schema.ts
src/server/drizzle/schemas/index.ts
drizzle/0001_peaceful_blonde_phantom.sql
drizzle/meta/0001_snapshot.json
src/core/canvas/server/repository/utils.ts
src/core/canvas/server/repository/lww.ts
src/core/canvas/server/repository/find-canvas-snapshot-rows.ts
src/core/canvas/server/repository/apply-canvas-command.ts
src/core/canvas/server/repository/__tests__/apply-canvas-command.integration.test.ts
src/core/canvas/server/api/__tests__/router.test.ts
src/core/canvas/server/services/get-canvas-snapshot-service.ts
src/core/canvas/server/services/apply-canvas-command-service.ts
src/core/canvas/server/services/operation-time.ts
src/core/canvas/server/api/schemas.ts
src/core/canvas/server/api/routes/get-canvas-elements.route.ts
src/core/canvas/server/api/routes/create-canvas-element.route.ts
src/core/canvas/server/api/routes/update-canvas-element.route.ts
src/core/canvas/server/api/routes/delete-canvas-element.route.ts
src/core/canvas/server/api/router.ts
src/server/router.ts
```

## 11. Definition of Done

- La tabla y la migración `workspace_elements` existen.
- La FK de proyecto usa `ON DELETE CASCADE`.
- El snapshot separa elementos activos y tombstones.
- Las mutaciones usan comparación LWW atómica en PostgreSQL.
- Delete ausente crea tombstone.
- Las rutas están registradas bajo `/api/v1/canvas` y protegidas por Better Auth.
- Las respuestas usan `CommonResponse`.
- No se agregaron React Flow, Portal, hooks de cliente ni UI de elementos.
- `pnpm test` pasa con la suite completa.
- `pnpm typecheck` pasa.
- `pnpm check` pasa sin diagnósticos.
- `pnpm build` pasa con las variables de entorno requeridas.
