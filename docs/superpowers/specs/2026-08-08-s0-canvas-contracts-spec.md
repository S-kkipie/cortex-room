# S0 - Canvas Contracts

**Fecha:** 2026-08-08  
**Estado:** Draft for review  
**Diseño padre:** `docs/superpowers/specs/2026-08-08-collaborative-canvas-design.md`  
**Estimación de implementación:** 30-45 minutos

## 1. Objetivo

Crear los contratos de dominio que usarán todas las etapas posteriores del canvas colaborativo. Al terminar S0, elementos, snapshots, comandos, resultados de mutación, eventos Portal y reglas de conflicto tendrán schemas Zod únicos, tipos inferidos y pruebas unitarias.

S0 no implementa comportamiento del canvas. Su resultado es un vocabulario compartido que impide que React Flow, Portal, Elysia y Drizzle inventen formatos incompatibles.

## 2. Resultado observable

Un desarrollador puede:

- validar un elemento persistido;
- validar un snapshot con elementos y tombstones;
- validar cada comando interno del canvas;
- validar cada preview y evento final recibido desde Portal;
- distinguir una mutación aplicada de una rechazada por LWW;
- importar todos los tipos desde `domain/types.ts` sin escribir interfaces duplicadas;
- ejecutar los tests de schemas sin necesitar base de datos, navegador ni conexión Portal.

## 3. Dependencias

S0 depende únicamente de:

- Zod 4, ya instalado;
- Vitest, ya configurado;
- decisiones aprobadas en el diseño padre.

S0 no agrega paquetes.

## 4. Archivos de implementación previstos

```text
src/core/canvas/domain/schemas.ts
src/core/canvas/domain/types.ts
src/core/canvas/domain/__tests__/schemas.test.ts
GEMINI.md
```

No se crean barrels ni re-exportaciones de conveniencia.

## 5. Convenciones obligatorias

- Zod es la única fuente de tipos.
- `schemas.ts` exporta valores Zod.
- `types.ts` exporta únicamente tipos obtenidos con `z.infer`.
- Los consumidores importan schemas desde `schemas.ts` y tipos desde `types.ts`.
- Los objetos que cruzan API o Portal son strict y rechazan campos desconocidos.
- Todos los IDs generados por este dominio usan `crypto.randomUUID()` y validan como UUID.
- `createdBy` acepta cualquier string no vacío porque el ID de Better Auth no tiene obligación de ser UUID.
- Las fechas de wire usan ISO 8601 UTC con sufijo `Z` y precisión de milisegundos.
- Las coordenadas deben ser finitas.
- Las dimensiones deben ser finitas y mayores que cero.
- El contenido tiene un máximo de 20,000 caracteres para limitar payloads y filas sin imponer reglas visuales específicas.

## 6. Constantes

`schemas.ts` exporta:

```ts
export const MAX_ELEMENT_CONTENT_LENGTH = 20_000;
export const ELEMENT_PREVIEW_THROTTLE_MS = 50;
export const CURSOR_THROTTLE_MS = 50;
export const PRESENCE_METADATA_THROTTLE_MS = 250;
export const TEXT_PREVIEW_DEBOUNCE_MS = 100;
export const TEXT_COMMIT_IDLE_MS = 500;
```

No se agregan límites de posición, ancho máximo o alto máximo en S0. S0 define frecuencias compartidas, pero su ejecución con TanStack Pacer pertenece a S6 y S7.

## 7. Contratos base

### 7.1 Tipo de elemento

```ts
export const workspaceElementTypeSchema = z.enum([
    "STICKY",
    "TEXT",
    "CARD",
    "HEADING",
]);
```

No se aceptan aliases en minúsculas ni tipos futuros.

### 7.2 Versión de operación

La versión LWW es una tupla persistible:

```ts
export const wireTimestampSchema = z.iso.datetime({ precision: 3 });

export const operationVersionSchema = z.strictObject({
    lastOperationAt: wireTimestampSchema,
    lastOperationId: z.uuid(),
});
```

`wireTimestampSchema` acepta únicamente UTC con sufijo `Z` y exactamente tres dígitos de milisegundos. Todo timestamp se normaliza con `new Date(value).toISOString()` antes de construir comandos, records o eventos.

Regla de comparación:

1. convertir `lastOperationAt` a epoch milliseconds;
2. la fecha mayor gana;
3. si las fechas son iguales, comparar `lastOperationId` como string;
4. el ID lexicográficamente mayor gana;
5. una tupla idéntica representa la misma operación y no vuelve a aplicarse.

El cliente genera `lastOperationAt` y `lastOperationId` al iniciar una operación optimista. S0 documenta la limitación de clock skew aceptada para el MVP.

### 7.3 Elemento persistido

```ts
export const workspaceElementSchema = z.strictObject({
    id: z.uuid(),
    projectId: z.uuid(),
    type: workspaceElementTypeSchema,
    content: z.string().max(MAX_ELEMENT_CONTENT_LENGTH),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    createdBy: z.string().min(1),
    createdAt: wireTimestampSchema,
    updatedAt: wireTimestampSchema,
    lastOperationAt: wireTimestampSchema,
    lastOperationId: z.uuid(),
});
```

`createdAt`, `updatedAt` y `createdBy` son autoritativos del servidor en records finales. Un cliente puede usar valores provisionales internamente, pero no puede enviarlos como parte de un comando.

### 7.4 Tombstone

```ts
export const elementTombstoneSchema = z.strictObject({
    id: z.uuid(),
    projectId: z.uuid(),
    deletedAt: wireTimestampSchema,
    lastOperationAt: wireTimestampSchema,
    lastOperationId: z.uuid(),
});
```

Un tombstone impide que un evento retrasado resucite un elemento eliminado por una operación más nueva.

### 7.5 Snapshot

```ts
export const canvasSnapshotSchema = z
    .strictObject({
        projectId: z.uuid(),
        elements: z.array(workspaceElementSchema),
        tombstones: z.array(elementTombstoneSchema),
    })
    .superRefine(validateSnapshotInvariants);
```

`validateSnapshotInvariants` agrega issues cuando:

- un record no pertenece al `projectId` del snapshot;
- un ID se repite dentro de `elements`;
- un ID se repite dentro de `tombstones`;
- un ID aparece simultáneamente en `elements` y `tombstones`.

Si una fuente externa contiene versiones repetidas, S2 debe resolver primero la ganadora por LWW y luego construir un snapshot válido.

## 8. Contratos de comandos

Los comandos representan intención local antes de obtener campos autoritativos del servidor. Nunca incluyen `actorId`, `createdBy`, `createdAt`, `updatedAt` ni `deletedAt`.

### 8.1 Metadata común

```ts
const commandMetadataSchema = z.strictObject({
    eventId: z.uuid(),
    projectId: z.uuid(),
    occurredAt: wireTimestampSchema,
});
```

### 8.2 Crear

```ts
export const createElementCommandSchema = commandMetadataSchema.extend({
    kind: z.literal("workspace.element.create"),
    element: z.strictObject({
        id: z.uuid(),
        type: workspaceElementTypeSchema,
        content: z.string().max(MAX_ELEMENT_CONTENT_LENGTH),
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().positive(),
        height: z.number().finite().positive(),
    }),
});
```

### 8.3 Actualizar contenido

```ts
export const updateElementCommandSchema = commandMetadataSchema.extend({
    kind: z.literal("workspace.element.update"),
    elementId: z.uuid(),
    content: z.string().max(MAX_ELEMENT_CONTENT_LENGTH),
});
```

### 8.4 Mover

```ts
export const moveElementCommandSchema = commandMetadataSchema.extend({
    kind: z.literal("workspace.element.move"),
    elementId: z.uuid(),
    x: z.number().finite(),
    y: z.number().finite(),
});
```

### 8.5 Redimensionar

```ts
export const resizeElementCommandSchema = commandMetadataSchema.extend({
    kind: z.literal("workspace.element.resize"),
    elementId: z.uuid(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
});
```

### 8.6 Eliminar

```ts
export const deleteElementCommandSchema = commandMetadataSchema.extend({
    kind: z.literal("workspace.element.delete"),
    elementId: z.uuid(),
});
```

### 8.7 Unión de comandos

```ts
export const canvasCommandSchema = z.discriminatedUnion("kind", [
    createElementCommandSchema,
    updateElementCommandSchema,
    moveElementCommandSchema,
    resizeElementCommandSchema,
    deleteElementCommandSchema,
]);
```

## 9. Resultado de mutación

```ts
export const canvasMutationResultSchema = z.discriminatedUnion("applied", [
    z.strictObject({
        applied: z.literal(true),
        record: z.union([workspaceElementSchema, elementTombstoneSchema]),
    }),
    z.strictObject({
        applied: z.literal(false),
        record: z.union([workspaceElementSchema, elementTombstoneSchema]),
    }),
]);
```

Semántica:

- `applied: true`: el servidor aceptó la operación y `record` contiene el estado autoritativo que puede publicarse en Portal;
- `applied: false`: la operación era stale y `record` contiene el estado autoritativo con el que el cliente debe reconciliarse;
- una operación con `applied: false` nunca se publica como evento final.

## 10. Contratos Portal

### 10.1 Decisión de discriminación

El contenido Portal se discrimina con `kind`. El campo `type` propio de Portal conserva el nombre conceptual sin sufijo:

| `kind` del contenido | `type` de Portal | Modo |
|---|---|---|
| `workspace.element.created.final` | `workspace.element.created` | persistente |
| `workspace.element.updated.preview` | `workspace.element.updated` | efímero |
| `workspace.element.updated.final` | `workspace.element.updated` | persistente |
| `workspace.element.moved.preview` | `workspace.element.moved` | efímero |
| `workspace.element.moved.final` | `workspace.element.moved` | persistente |
| `workspace.element.resized.preview` | `workspace.element.resized` | efímero |
| `workspace.element.resized.final` | `workspace.element.resized` | persistente |
| `workspace.element.deleted.final` | `workspace.element.deleted` | persistente |
| `participant.cursor.moved` | `participant.cursor.moved` | efímero |
| `participant.selection.changed` | `participant.selection.changed` | efímero |

El receptor valida ambas cosas: `message.type` debe corresponder al `content.kind` y el flag `message.ephemeral` debe corresponder al modo de la tabla. Los mensajes inconsistentes se ignoran y registran.

### 10.2 Metadata común de evento

```ts
const portalEventMetadataSchema = z.strictObject({
    eventId: z.uuid(),
    projectId: z.uuid(),
    occurredAt: wireTimestampSchema,
});
```

No existe `actorId` en el contenido. El actor siempre proviene de `message.sender.id`, validado por Portal.

### 10.3 Eventos finales

Create, update, move y resize finales transportan el elemento autoritativo completo:

```ts
const createdFinalEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.created.final"),
    element: workspaceElementSchema,
});

const updatedFinalEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.updated.final"),
    element: workspaceElementSchema,
});

const movedFinalEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.moved.final"),
    element: workspaceElementSchema,
});

const resizedFinalEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.resized.final"),
    element: workspaceElementSchema,
});

const deletedFinalEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.deleted.final"),
    tombstone: elementTombstoneSchema,
});
```

Para eventos finales se exige:

- `eventId === element.lastOperationId` o `eventId === tombstone.lastOperationId`;
- `occurredAt === element.lastOperationAt` o `occurredAt === tombstone.lastOperationAt`;
- el `projectId` del evento coincide con el record.

`validateFinalEventInvariants` convierte estas comparaciones en invariantes de la unión pública. Un evento final contradictorio se rechaza antes de llegar al controller.

### 10.4 Previews de elemento

```ts
const updatedPreviewEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.updated.preview"),
    elementId: z.uuid(),
    content: z.string().max(MAX_ELEMENT_CONTENT_LENGTH),
});

const movedPreviewEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.moved.preview"),
    elementId: z.uuid(),
    x: z.number().finite(),
    y: z.number().finite(),
});

const resizedPreviewEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("workspace.element.resized.preview"),
    elementId: z.uuid(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
});
```

Los previews no incluyen records autoritativos ni se agregan al snapshot.

### 10.5 Awareness

```ts
export const cursorPositionSchema = z.strictObject({
    x: z.number().finite(),
    y: z.number().finite(),
});

const cursorMovedEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("participant.cursor.moved"),
    cursor: cursorPositionSchema,
});

const selectionChangedEventSchema = portalEventMetadataSchema.extend({
    kind: z.literal("participant.selection.changed"),
    elementIds: z.array(z.uuid()),
});

export const participantPresenceMetadataSchema = z.strictObject({
    cursor: cursorPositionSchema.optional(),
    selectedElementIds: z.array(z.uuid()).default([]),
});
```

El nombre y avatar no forman parte de esta metadata; provienen de los claims verificados de Portal.

### 10.6 Unión de eventos

```ts
export const canvasPortalEventSchema = z
    .discriminatedUnion("kind", [
        createdFinalEventSchema,
        updatedPreviewEventSchema,
        updatedFinalEventSchema,
        movedPreviewEventSchema,
        movedFinalEventSchema,
        resizedPreviewEventSchema,
        resizedFinalEventSchema,
        deletedFinalEventSchema,
        cursorMovedEventSchema,
        selectionChangedEventSchema,
    ])
    .superRefine(validateFinalEventInvariants);
```

Todos los schemas concretos de eventos se exportan para permitir construcción y tests específicos. Todo mensaje recibido usa siempre `canvasPortalEventSchema`, que agrega las invariantes entre metadata y record.

### 10.7 Envelope Portal normalizado

S0 no intenta replicar todos los campos internos del SDK de Portal. El adapter proyecta cada mensaje recibido a este envelope antes de validarlo:

```ts
export const portalMessageTypeSchema = z.enum([
    "workspace.element.created",
    "workspace.element.updated",
    "workspace.element.moved",
    "workspace.element.resized",
    "workspace.element.deleted",
    "participant.cursor.moved",
    "participant.selection.changed",
]);

export const canvasPortalMessageSchema = z
    .strictObject({
        type: portalMessageTypeSchema,
        ephemeral: z.boolean(),
        senderId: z.string().min(1),
        content: canvasPortalEventSchema,
    })
    .superRefine(validatePortalMessageMode);
```

`validatePortalMessageMode` usa una tabla constante `PORTAL_EVENT_RULES` para exigir la combinación exacta de `content.kind`, `type` y `ephemeral` definida en 10.1. El adapter toma `senderId` de `message.sender.id`; nunca del contenido.

La tabla es parte del contrato exportado:

```ts
export const PORTAL_EVENT_RULES = {
    "workspace.element.created.final": { type: "workspace.element.created", ephemeral: false },
    "workspace.element.updated.preview": { type: "workspace.element.updated", ephemeral: true },
    "workspace.element.updated.final": { type: "workspace.element.updated", ephemeral: false },
    "workspace.element.moved.preview": { type: "workspace.element.moved", ephemeral: true },
    "workspace.element.moved.final": { type: "workspace.element.moved", ephemeral: false },
    "workspace.element.resized.preview": { type: "workspace.element.resized", ephemeral: true },
    "workspace.element.resized.final": { type: "workspace.element.resized", ephemeral: false },
    "workspace.element.deleted.final": { type: "workspace.element.deleted", ephemeral: false },
    "participant.cursor.moved": { type: "participant.cursor.moved", ephemeral: true },
    "participant.selection.changed": { type: "participant.selection.changed", ephemeral: true },
} as const;
```

## 11. Tipos inferidos

`types.ts` define, como mínimo:

```ts
export type WorkspaceElementType = z.infer<typeof workspaceElementTypeSchema>;
export type WireTimestamp = z.infer<typeof wireTimestampSchema>;
export type OperationVersion = z.infer<typeof operationVersionSchema>;
export type WorkspaceElement = z.infer<typeof workspaceElementSchema>;
export type ElementTombstone = z.infer<typeof elementTombstoneSchema>;
export type CanvasSnapshot = z.infer<typeof canvasSnapshotSchema>;
export type CreateElementCommand = z.infer<typeof createElementCommandSchema>;
export type UpdateElementCommand = z.infer<typeof updateElementCommandSchema>;
export type MoveElementCommand = z.infer<typeof moveElementCommandSchema>;
export type ResizeElementCommand = z.infer<typeof resizeElementCommandSchema>;
export type DeleteElementCommand = z.infer<typeof deleteElementCommandSchema>;
export type CanvasCommand = z.infer<typeof canvasCommandSchema>;
export type CanvasMutationResult = z.infer<typeof canvasMutationResultSchema>;
export type CursorPosition = z.infer<typeof cursorPositionSchema>;
export type ParticipantPresenceMetadata = z.infer<typeof participantPresenceMetadataSchema>;
export type CanvasPortalEvent = z.infer<typeof canvasPortalEventSchema>;
export type PortalMessageType = z.infer<typeof portalMessageTypeSchema>;
export type CanvasPortalMessage = z.infer<typeof canvasPortalMessageSchema>;
```

No se escriben interfaces manuales equivalentes.

## 12. Excepción de acceso Canvas

S0 modifica `GEMINI.md` para registrar la decisión aprobada:

```md
### Excepción Canvas colaborativo

Las rutas y servicios del dominio Canvas siguen requiriendo autenticación, pero
validan existencia del proyecto en lugar de ownership. Cualquier usuario
autenticado con un `projectId` válido puede leer y mutar ese canvas y solicitar
un token Portal limitado a su channel. Esta excepción no aplica al CRUD de
Project ni a otros dominios.
```

Esta edición evita que futuras etapas implementen accidentalmente el canvas con ownership exclusivo o extiendan el acceso compartido a otros dominios.

## 13. Criterios de aceptación

### AC-01 Elementos válidos

Given un objeto con UUIDs, tipo soportado, coordenadas finitas, dimensiones positivas y timestamps `YYYY-MM-DDTHH:mm:ss.SSSZ`  
When se parsea con `workspaceElementSchema`  
Then el parse es exitoso y conserva todos los campos.

### AC-02 Elementos inválidos

Given un elemento con tipo desconocido, `NaN`, `Infinity`, dimensión cero/negativa, timestamp inválido o contenido mayor a 20,000 caracteres  
When se valida  
Then el schema lo rechaza.

### AC-03 Campos autoritativos

Given un comando de creación que incluye `createdBy`, `createdAt` o `updatedAt`  
When se valida  
Then el comando strict lo rechaza.

### AC-04 Snapshot

Given un snapshot con elementos activos y tombstones válidos  
When se valida  
Then el resultado conserva ambos conjuntos y su `projectId`.

El schema rechaza project IDs cruzados, IDs duplicados y cualquier ID presente a la vez como elemento activo y tombstone.

### AC-05 Unión de comandos

Given cada uno de los cinco comandos soportados  
When se valida con `canvasCommandSchema`  
Then se obtiene la variante correspondiente por `kind`.

### AC-06 Resultado aplicado

Given respuestas con `applied: true` y `applied: false`  
When se validan con `canvasMutationResultSchema`  
Then ambas aceptan un elemento o tombstone autoritativo y rechazan records inválidos.

### AC-07 Eventos finales

Given cada operación final con un record autoritativo  
When se valida con `canvasPortalEventSchema`  
Then se acepta por su `kind` exacto.

El schema rechaza un evento final cuando `eventId`, `occurredAt` o `projectId` no coincide con su record.

### AC-08 Eventos efímeros

Given previews de update, move y resize, además de cursor y selección  
When se validan  
Then aceptan únicamente payloads finitos y tipos conocidos.

### AC-09 Actor no falsificable

Given cualquier comando o evento con `actorId`  
When se valida  
Then el objeto strict se rechaza.

### AC-09b Envelope Portal coherente

Given un mensaje Portal normalizado  
When `type`, `ephemeral` y `content.kind` corresponden según `PORTAL_EVENT_RULES`  
Then `canvasPortalMessageSchema` lo acepta.

When cualquiera de los tres contradice la tabla  
Then el schema lo rechaza.

### AC-10 Tipos derivados

Given `domain/types.ts`  
When se revisa  
Then todos los tipos públicos usan `z.infer` y no existen interfaces duplicadas.

### AC-11 Regla de acceso documentada

Given `GEMINI.md`  
When finaliza S0  
Then contiene la excepción Canvas y mantiene owner-only para Project y los demás dominios.

## 14. Casos de error y límites

- Un payload desconocido falla cerrado; no se convierte a un tipo por defecto.
- Un campo adicional en contratos externos causa rechazo.
- Un timestamp sin timezone se rechaza.
- Un timestamp con offset distinto de `Z` o precisión distinta de tres milisegundos se rechaza.
- `NaN`, `Infinity` y `-Infinity` se rechazan.
- Una dimensión igual o menor que cero se rechaza.
- El contenido vacío es válido para todos los tipos del MVP.
- Una selección vacía representa deselección.
- S0 no limita selección a un solo ID aunque la primera UI sea de selección individual.
- S0 no deduplica arrays; el controller de S7 normaliza `selectedElementIds`.
- `canvasSnapshotSchema` sí compara pertenencia y unicidad entre los records de un mismo snapshot. Otras reglas que requieran estado externo, como existencia real del proyecto o comparación contra una fila de base de datos, pertenecen al servicio o controller.

## 15. Plan de pruebas TDD para implementación

Crear primero `src/core/canvas/domain/__tests__/schemas.test.ts` con tests que fallen por ausencia de los schemas.

Cobertura mínima:

1. acepta cada `WorkspaceElementType`;
2. rechaza un tipo desconocido;
3. acepta un elemento completo;
4. rechaza coordenadas no finitas;
5. rechaza dimensiones no positivas;
6. rechaza contenido mayor al límite;
7. acepta timestamps UTC `Z` con tres milisegundos y rechaza timestamps sin timezone, con offset distinto de `Z` o con precisión diferente;
8. acepta un tombstone;
9. acepta un snapshot;
10. acepta cada comando individual y la unión;
11. rechaza campos de actor/auditoría en comandos;
12. acepta ambos resultados de mutación;
13. acepta cada variante Portal;
14. rechaza un `kind` desconocido;
15. rechaza eventos finales cuyo metadata contradice el record;
16. acepta envelopes Portal coherentes;
17. rechaza combinaciones incorrectas de `type`, `ephemeral` y `kind`;
18. rechaza `actorId` en eventos;
19. acepta metadata de presencia vacía y aplica `selectedElementIds: []`;
20. rechaza campos desconocidos en contratos externos;
21. rechaza snapshots con project IDs cruzados o IDs duplicados/contradictorios.

El ciclo exigido es:

```text
RED: tests fallan porque los contratos no existen
GREEN: implementar schemas y tipos mínimos
REFACTOR: eliminar duplicación sin cambiar contratos
```

## 16. No objetivos

S0 no implementa:

- tabla Drizzle ni migración;
- repositories, services o rutas Elysia;
- React Flow;
- canvas actions ejecutables;
- comparación LWW como helper;
- conexión o configuración de Portal;
- ejecución de throttling, debounce o retry queues;
- persistencia de snapshots;
- UI shadcn;
- tests de componentes o integración.

## 17. Definition of Done

S0 está implementada cuando:

- existen `schemas.ts`, `types.ts` y `schemas.test.ts` en el dominio Canvas;
- todos los contratos descritos están exportados;
- todos los tipos públicos provienen de `z.infer`;
- los contratos externos son strict;
- la suite cubre los 21 grupos mínimos de pruebas;
- `GEMINI.md` contiene la excepción Canvas aprobada;
- no se agregó lógica de infraestructura o UI;
- pasan los siguientes comandos:

```bash
pnpm test -- src/core/canvas/domain/__tests__/schemas.test.ts
pnpm typecheck
pnpm check
```

## 18. Salida para S1 y S2

S1 puede consumir los schemas de snapshot y eventos para tipar el shell y providers sin inventar modelos. S2 puede consumir comandos, snapshots y mutation results para definir Drizzle, repositories, services y rutas con los mismos contratos.
