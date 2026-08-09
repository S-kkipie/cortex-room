# S4 - Local Elements and Actions

**Fecha:** 2026-08-09  
**Estado:** Aprobada para planificacion  
**Diseño padre:** `docs/superpowers/specs/2026-08-08-collaborative-canvas-design.md`  
**Dependencias:** S0 Canvas Contracts, S1 Authenticated Canvas Shell, S2 Persistent Canvas Snapshot y S3 Navigable Canvas  
**Estimacion original:** 2 horas

## 1. Objetivo

Conectar el canvas navegable de S3 con el snapshot persistente de S2 y entregar
la primera experiencia completa de elementos locales. Al terminar S4, un usuario
autenticado puede cargar los elementos de un proyecto, crear los cuatro tipos
soportados, seleccionarlos, editarlos, moverlos, redimensionarlos y eliminarlos.

Las acciones de la toolbar, los gestos de React Flow y las llamadas programaticas
usan el mismo `CanvasActions` API. Las mutaciones se aplican de forma optimista,
se persisten mediante la API existente de S2 y se reconcilian con el record
autoritativo que devuelve el servidor.

S4 es una rebanada local y persistente. No introduce Portal, presencia, cursores,
seleccion remota, retry queue ni sincronizacion realtime. S5 y S6 agregaran esas
capacidades sobre los limites de estado y acciones definidos aqui.

## 2. Resultado observable

Un usuario autenticado que abre `/projects/:projectId/canvas` puede:

- ver los elementos persistidos del proyecto despues de la carga inicial;
- crear un `STICKY`, `TEXT`, `CARD` o `HEADING` haciendo clic sobre el canvas;
- ver el nuevo elemento seleccionado y listo para editar;
- seleccionar un elemento existente en modo `Select`;
- editar su contenido y confirmar o descartar el draft;
- mover un elemento y persistir su posicion al terminar el drag;
- redimensionar un elemento seleccionado y persistir sus dimensiones al terminar;
- eliminarlo desde la toolbar o con `Delete`/`Backspace`;
- recargar y recuperar el estado persistido;
- invocar `createElement` programaticamente y obtener el mismo flujo que una
  insercion desde la toolbar;
- recibir un estado de carga, reintento o error explicito en vez de un canvas
  vacio que parezca cargado correctamente.

## 3. Dependencias y limites

S4 usa:

- los schemas y tipos de `src/core/canvas/domain/`;
- la tabla, snapshot y mutaciones de S2 sin modificar sus contratos publicos;
- React Flow, su `ReactFlowProvider`, `NodeResizer` y el viewport de S3;
- Eden/TanStack Query mediante el patron de factory hook del repositorio;
- `Button`, `Tooltip`, `Separator`, `Textarea` y `sonner` existentes;
- Lucide para los iconos de la toolbar.

S4 no agrega dependencias runtime ni modifica `package.json`.

S4 tampoco modifica:

- los schemas Zod de S0;
- las rutas, respuestas o migraciones de S2;
- la politica de acceso de Canvas;
- la autenticacion, el route group o el header de S1;
- los limites y controles de viewport de S3, salvo integrar `fitView` inicial
  cuando existan nodos.

## 4. Decision de arquitectura

### 4.1 Estado permanente

`CanvasSnapshot` es la unica fuente canonica de estado permanente en el cliente.
El snapshot se obtiene con TanStack Query y las mutaciones actualizan la misma
entrada de cache con `setQueryData` usando la respuesta autoritativa. No se crea
una coleccion paralela con `useNodesState` ni se usa React Flow como owner de los
elementos.

El snapshot conserva:

- `elements`, que producen nodos visibles;
- `tombstones`, que no producen nodos pero protegen la reconciliacion LWW.

Los nodos de React Flow se derivan de `snapshot.elements` en cada render. Cada
nodo lleva en `data` un `WorkspaceElement` del dominio, no una copia manual de
sus campos.

### 4.2 Estado efimero

El controlador mantiene estado efimero separado del snapshot permanente:

- herramienta activa;
- IDs seleccionados localmente;
- draft de texto en edicion;
- preview de posicion durante drag;
- preview de dimensiones durante resize;
- elemento en modo edicion;
- operaciones pendientes por elemento;
- si el `fitView` inicial ya fue ejecutado.

El estado efimero puede cambiar a alta frecuencia y nunca se envia a PostgreSQL.
Los previews se combinan con los elementos canonicos solo en el adaptador de
renderizado. Al terminar una interaccion, la accion correspondiente actualiza el
snapshot y elimina su preview.

### 4.3 Componentes

```text
CanvasPage
    -> CanvasShell(projectId, userId, ...)
        -> NavigableCanvas
            -> CanvasControllerProvider
                -> CanvasToolbar
                -> ReactFlow
                    -> WorkspaceElementNode
                        -> WorkspaceElementEditor
                -> CanvasViewportControls
```

`CanvasShell` sigue siendo Server Component. `NavigableCanvas` y sus descendientes
son la isla cliente. El controlador conoce el proyecto, el usuario autenticado,
el transporte de S2 y el estado del canvas, pero los nodos y la toolbar solo
conocen el `CanvasActions` API.

### 4.4 Archivos previstos

Los nombres pueden ajustarse durante la implementacion sin cambiar los limites:

```text
src/app/(workspace)/projects/[projectId]/canvas/page.tsx
src/core/canvas/client/hooks.ts
src/core/canvas/client/controller/canvas-controller.ts
src/core/canvas/client/controller/reconcile-canvas-record.ts
src/core/canvas/client/controller/element-defaults.ts
src/core/canvas/client/controller/to-react-flow-nodes.ts
src/core/canvas/domain/operation-version.ts
src/core/canvas/client/ui/canvas-shell.tsx
src/core/canvas/client/ui/navigable-canvas.tsx
src/core/canvas/client/ui/canvas-editor.tsx
src/core/canvas/client/ui/canvas-toolbar.tsx
src/core/canvas/client/ui/workspace-element-node.tsx
src/core/canvas/client/ui/workspace-element-editor.tsx
src/core/canvas/client/**/__tests__/*
```

El comparador LWW usado por el cliente y el repository de S2 vive en
`src/core/canvas/domain/operation-version.ts`, un modulo puro y seguro para
cliente y servidor. El helper actual de S2 se adapta a esa implementacion sin
cambiar su API publica ni importar `src/core/canvas/server/repository/*` desde el
cliente.

## 5. Snapshot y transporte

### 5.1 Carga inicial

`CanvasShell` recibe `projectId` y `userId` desde la pagina autenticada. La pagina
continua validando proyecto y sesion en servidor; no se hace una segunda consulta
de ownership desde el cliente.

El factory hook del dominio enlaza una sola vez el proxy `useElysia().canvas` y
`queryClient`. Expone como minimo una consulta de snapshot y las operaciones de
mutacion necesarias. Los consumidores leen siempre `data.response`; no acceden
al envelope completo como si fuera el snapshot.

La consulta usa la opcion generada por Eden para
`GET /api/v1/canvas/:projectId/elements`. No se construyen manualmente
`queryKey`, `queryFn` ni `apiClient` dentro de componentes.

Estados de la consulta:

- `pending`: toolbar y nodos deshabilitados; se muestra `Loading canvas`;
- `error`: se muestra `Unable to load canvas` y una accion `Retry`;
- `success`: se instala el snapshot y se habilitan las acciones.

La respuesta exitosa con arrays vacios es un canvas valido y no se confunde con
el estado de carga.

### 5.2 Mutaciones

Se reutilizan exactamente estas rutas de S2:

```text
POST   /api/v1/canvas/:projectId/elements
PUT    /api/v1/canvas/:projectId/elements/:elementId
DELETE /api/v1/canvas/:projectId/elements/:elementId
```

El transporte envia comandos validados por los schemas existentes. Nunca envia
`actorId`, `createdBy`, `createdAt`, `updatedAt` ni `deletedAt` como autoridad del
cliente. El servidor sigue tomando el actor de Better Auth y asignando las
fechas de auditoria.

No se invalida y vuelve a cargar el snapshot despues de cada mutacion exitosa.
La respuesta `CanvasMutationResult` es la fuente de reconciliacion inmediata.
Una recarga posterior sigue siendo la verificacion de persistencia definitiva.

## 6. Canvas Actions API

El controlador expone una API estable para la toolbar, nodos, teclado y futuras
herramientas AI. La UI no llama directamente a Eden, repositorios o Portal.

```ts
createElement(input)
updateElement(elementId, changes)
moveElement(elementId, position)
resizeElement(elementId, dimensions)
deleteElement(elementId)
selectElements(elementIds)
getElement(elementId)
getElements()
getSelectedElements()
```

Las formas de `input`, `changes`, `position` y `dimensions` se derivan de los
tipos inferidos de `domain/types.ts` o de `Pick`/`Omit` de esos tipos. No se
escriben interfaces manuales que dupliquen un schema de dominio.

### 6.1 Crear

`createElement` recibe tipo, contenido, posicion y dimensiones. Genera:

- `id` del elemento;
- `eventId` de la operacion;
- `occurredAt` con `new Date().toISOString()`.

La operacion optimista crea un `WorkspaceElement` local usando `userId` para
`createdBy` y timestamps provisionales. El servidor reemplaza esos campos con
los valores autoritativos. El elemento queda seleccionado y entra en edicion.

### 6.2 Actualizar contenido

La edicion de texto usa un draft efimero. Escribir no envia una mutacion por
tecla. Blur o `Ctrl/Cmd + Enter` confirma mediante `updateElement`; `Escape`
descarta el draft y restaura el contenido canonico.

S4 no publica previews de texto ni implementa debounce de Portal. La constante
de debounce de S0 queda para la integracion realtime posterior.

### 6.3 Mover y redimensionar

Durante drag o resize, React Flow muestra el preview local. No se envia una
peticion por cada evento de pointer. Al terminar:

1. se crea un comando `move` o `resize` nuevo;
2. se aplica optimistamente al elemento canonico;
3. se envia una sola mutacion a S2;
4. se reemplaza el record con la respuesta autoritativa;
5. se limpia el preview y el estado pendiente.

### 6.4 Eliminar

`deleteElement` crea optimistamente un tombstone y elimina el nodo visible. Si
la operacion falla, restaura el record anterior solo si ninguna operacion local
posterior lo reemplazo.

## 7. Reconciliacion optimista y LWW

Cada mutacion local registra una entrada pendiente por elemento con:

- `eventId` y `occurredAt` de la operacion;
- version anterior;
- record optimista;
- preimagen necesaria para rollback.

La reconciliacion compara `(lastOperationAt, lastOperationId)` con la misma regla
de S0 y S2:

1. timestamp mas nuevo gana;
2. para timestamps iguales, gana el ID lexicograficamente mayor;
3. una tupla identica es idempotente.

Reglas de respuesta:

- `applied: true` reemplaza el record local si la version actual no es mas nueva;
- `applied: false` instala el record autoritativo stale winner si no existe una
  operacion local posterior;
- una respuesta cuya version es mas vieja que el record actual se ignora;
- una respuesta vieja nunca resucita un elemento cuyo tombstone es mas nuevo;
- un error solo hace rollback si el record actual sigue teniendo la version de
  la operacion que fallo;
- si ya existe una operacion local posterior, el error o response anterior no
  puede deshacerla.

Las mutaciones del mismo elemento se mantienen en orden de envio. Mutaciones de
elementos distintos pueden ejecutarse en paralelo. S4 no conserva operaciones
pendientes despues de cerrar el navegador y no crea una cola de reintento; esa
durabilidad pertenece a S8.

El comparador debe ser probado en el limite cliente y mantener la semantica de
la comparacion del repository de S2. No se importa codigo desde una carpeta
`server` a un componente cliente.

## 8. Elementos y presentacion

Todos los tipos usan `content` como string. El `CARD` interpreta la primera linea
no vacia como titulo opcional y las lineas restantes como descripcion, siguiendo
el diseño padre. No se agregan columnas de base de datos ni un union de contenido.

| Tipo | Tamano inicial | Tamano minimo | Presentacion |
|---|---:|---:|---|
| `STICKY` | 240 x 180 | 160 x 100 | fondo calido y contenido multilinea |
| `TEXT` | 280 x 120 | 160 x 64 | superficie minima y texto normal |
| `CARD` | 320 x 200 | 220 x 120 | borde, titulo y descripcion |
| `HEADING` | 360 x 96 | 200 x 64 | tipografia grande y semibold |

Reglas:

- el clic de insercion define el centro del elemento;
- la posicion se calcula con `screenToFlowPosition` y resta la mitad de las
  dimensiones iniciales;
- el contenido inicial es vacio y el elemento entra en edicion;
- un contenido vacio es valido segun S0;
- `NodeResizer` respeta dimensiones minimas por tipo;
- el nodo usa `data.element` para acceder al `WorkspaceElement` completo;
- los cuatro tipos comparten el editor basico y solo cambian presentacion,
  dimensiones y reglas de titulo de `CARD`;
- los nodos no tienen handles ni edges en S4.

## 9. Herramientas e interaccion

### 9.1 Toolbar

La toolbar es flotante, compacta y accesible, posicionada en la parte superior
central del canvas. Usa `Button`, `Tooltip`, `Separator` e iconos Lucide.

Herramientas, en este orden:

```text
Select | Hand | Sticky | Text | Card | Heading | Delete
```

`Select` es la herramienta inicial. La herramienta activa tiene un estado visual
claro y un nombre accesible.

Las herramientas de insercion son de un solo uso: despues de crear un elemento,
la herramienta vuelve a `Select`. Mientras una herramienta de insercion esta
activa, hacer clic sobre un nodo no lo edita; hacer clic sobre el fondo crea el
elemento.

### 9.2 Select y Hand

En `Select`:

- un clic sobre un nodo lo selecciona;
- el fondo puede desplazarse como en S3;
- un nodo seleccionado puede moverse;
- doble clic inicia edicion.

En `Hand`:

- el fondo puede desplazarse;
- los nodos no se arrastran ni se editan;
- la seleccion queda bloqueada mientras la herramienta esta activa.

La seleccion local se mantiene fuera del snapshot. S4 admite un solo elemento
visible en la UI, aunque `selectElements` y el schema de S0 conservan arrays para
S7.

### 9.3 Delete y teclado

La herramienta `Delete` elimina el elemento seleccionado y vuelve a `Select`.
Las teclas `Delete` y `Backspace` hacen lo mismo cuando el foco no esta dentro de
`input`, `textarea` o un editor activo. Mientras se edita texto, esas teclas solo
modifican el contenido.

Eliminar limpia seleccion, draft, modo edicion, preview y estado pendiente
asociado cuando la operacion termina.

### 9.4 Viewport

S3 conserva sus limites `0.25` a `2`, sus controles y su viewport local. Cuando
la carga inicial termina con elementos:

- se ejecuta `fitView` una sola vez;
- el zoom maximo de ese ajuste es `1`;
- el padding es `0.2`;
- el ajuste es local y no se persiste.

Un snapshot vacio conserva el origen de S3. Mutaciones posteriores no vuelven a
ejecutar `fitView` automaticamente. `Reset viewport` mantiene el comportamiento
de S3 y vuelve a `{ x: 0, y: 0, zoom: 1 }`.

## 10. Casos de error y limites operativos

- Un visitante anonimo sigue siendo rechazado por la autenticacion de S1.
- Un proyecto inexistente sigue produciendo el estado `not-found` de S1.
- Un snapshot fallido no se representa como un canvas vacio exitoso.
- Un body invalido sigue siendo rechazado por los schemas strict de S2.
- Una operacion stale no muestra un toast de error: instala el record ganador.
- Un fallo de red revierte solo su propia operacion vigente y muestra un mensaje
  accionable.
- Un fallo de create no deja un nodo optimista huerfano.
- Un fallo de update, move o resize restaura el record anterior solo cuando no
  hay una operacion posterior para ese elemento.
- Un fallo de delete restaura el elemento solo bajo la misma regla de version.
- Un error de transporte se trata como no confirmado: S4 revierte la operacion
  local y permite reintentar manualmente la carga; no intenta resolver si el
  servidor alcanzo a confirmar la escritura.
- Una respuesta atrasada no sobreescribe un record local mas nuevo.
- S4 no reintenta automaticamente despues de cerrar el navegador.
- S4 no conecta Portal ni publica mensajes efimeros o finales.
- El viewport, la seleccion, los drafts, la toolbar y los previews nunca se
  guardan en PostgreSQL.

## 11. Criterios de aceptacion

### AC-01 Snapshot cargado

Given un proyecto existente con elementos persistidos  
When el usuario abre el canvas  
Then ve un nodo por cada elemento activo y ningun nodo por tombstones.

### AC-02 Snapshot vacio

Given un proyecto existente sin elementos  
When termina la carga  
Then ve el canvas navegable de S3 sin error y con la vista inicial.

### AC-03 Estado de carga y error

Given una consulta pendiente o fallida  
When el canvas se renderiza  
Then muestra el estado correspondiente, bloquea acciones y ofrece `Retry` para
un error.

### AC-04 Crear cuatro tipos

Given una herramienta de insercion activa y un clic en el fondo  
When se crea un elemento  
Then aparece el tipo correcto en la coordenada flow correspondiente, queda
seleccionado, entra en edicion y se envia un comando valido a S2.

### AC-05 Crear programatico

Given una llamada a `createElement`  
When el controlador procesa la accion  
Then usa el mismo estado optimista, transporte, reconciliacion y resultado que
la toolbar.

### AC-06 Seleccion

Given un canvas cargado en modo `Select`  
When el usuario hace clic sobre un nodo  
Then el nodo queda seleccionado y la seleccion no altera el snapshot persistente.

### AC-07 Edicion confirmada

Given un elemento en modo edicion  
When el usuario confirma con blur o `Ctrl/Cmd + Enter`  
Then cambia el contenido, se envia una sola mutacion final y el editor sale del
modo edicion.

### AC-08 Edicion descartada

Given un draft de texto modificado  
When el usuario pulsa `Escape`  
Then se descarta el draft y se conserva el contenido canonico sin mutacion.

### AC-09 Movimiento

Given un elemento seleccionado  
When el usuario lo arrastra y suelta  
Then ve el movimiento local continuo y se persiste una sola posicion final.

### AC-10 Resize

Given un elemento seleccionado  
When el usuario arrastra un handle de `NodeResizer`  
Then ve el resize local continuo, respeta el minimo del tipo y persiste una sola
dimension final.

### AC-11 Delete

Given un elemento seleccionado  
When el usuario usa la toolbar o `Delete`  
Then el nodo desaparece optimistamente, se persiste un tombstone y la seleccion
se limpia.

### AC-12 Reconciliacion aplicada

Given una mutacion optimista y una respuesta `applied: true`  
When la respuesta contiene el record autoritativo  
Then reemplaza los campos provisionales sin crear un segundo nodo.

### AC-13 Reconciliacion stale

Given una respuesta `applied: false` con un record ganador  
When el controlador la recibe  
Then instala el record ganador y no publica ni vuelve a enviar la operacion
rechazada.

### AC-14 Respuesta atrasada

Given una operacion local posterior para el mismo elemento  
When llega la respuesta o error de una operacion anterior  
Then la respuesta anterior no sobrescribe ni revierte la operacion posterior.

### AC-15 Persistencia despues de reload

Given acciones confirmadas y una recarga completa  
When vuelve a cargar el snapshot  
Then los elementos conservan contenido, posiciones, dimensiones y tombstones
persistidos.

### AC-16 Herramientas

Given la toolbar visible  
When el usuario cambia entre `Select`, `Hand` y herramientas de insercion  
Then el estado activo es accesible, `Hand` bloquea drag/edicion y las herramientas
de insercion vuelven a `Select` despues de crear.

### AC-17 Fit inicial

Given un snapshot con elementos  
When la carga inicial termina  
Then se ejecuta un unico `fitView` local con zoom maximo de 100%.

### AC-18 Aislamiento realtime

Given un canvas S4 abierto  
When el usuario crea o edita elementos  
Then no se crea conexion Portal ni se publican eventos realtime.

## 12. Pruebas

### 12.1 TDD y funciones puras

Crear primero tests que fallen para:

1. dimensiones iniciales y minimas por tipo;
2. conversion de elemento de dominio a nodo React Flow;
3. conversion de punto de pantalla a posicion flow;
4. parseo de contenido de `CARD`;
5. comparacion de versiones LWW en el limite cliente;
6. aplicacion de records activos y tombstones;
7. ignorar records con version anterior;
8. rollback condicionado por la version actual;
9. creacion de comandos con UUID y timestamp ISO;
10. limpieza de seleccion y previews al eliminar.

### 12.2 Controlador y transporte

Usar un transporte falso y un `QueryClient` aislado para probar:

1. carga exitosa, snapshot vacio y error de carga;
2. create optimista y reconciliacion aplicada;
3. update, move, resize y delete optimistas;
4. respuesta stale con record autoritativo;
5. respuesta atrasada que no pisa una operacion posterior;
6. rollback de create, update, move, resize y delete;
7. rollback que no pisa una operacion posterior;
8. `createElement` programatico usando la misma accion que la UI.

### 12.3 Componentes

Con el patron existente de Vitest y `happy-dom`, y mocks controlados de React
Flow, probar:

1. toolbar con nombres accesibles y herramienta activa;
2. insercion de cada tipo con un clic sobre el fondo;
3. modo `Hand` sin seleccion ni drag de nodos;
4. render de los cuatro tipos y `NodeResizer` solo cuando corresponde;
5. confirmacion y cancelacion de edicion;
6. delete por boton y teclado;
7. loading, error y retry;
8. `fitView` una sola vez cuando hay elementos;
9. preservacion de los controles y header de S3.

No se agrega una libreria de browser testing. Gestos reales, layout, pointer
coordinates y `ResizeObserver` se verifican manualmente.

### 12.4 Verificacion manual

En un proyecto existente:

1. abrir el canvas y esperar el snapshot;
2. crear Sticky, Text, Card y Heading;
3. editar, mover y redimensionar cada tipo;
4. comprobar que Card separa titulo y descripcion por lineas;
5. eliminar por toolbar y teclado;
6. recargar y comprobar persistencia;
7. probar `Select`, `Hand`, zoom y reset en desktop y movil;
8. simular fallo de red y confirmar rollback y toast;
9. confirmar que DevTools no muestra requests Portal ni eventos realtime.

### 12.5 Comandos de calidad

```text
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

## 13. No objetivos

S4 no implementa:

- Portal, tokens, channels o presencia;
- cursores o seleccion remota;
- previews realtime o deduplicacion de eventos Portal;
- retry queue, offline durable o reconnect hardening;
- seleccion multiple o rectangular en la UI;
- undo/redo;
- comentarios, edges o conexiones;
- rich text, markdown o estilos configurables;
- editores especializados complejos por tipo;
- cambios a la tabla o API de S2;
- persistencia del viewport, seleccion, drafts o herramienta activa;
- fitView automatico despues de cada mutacion.

## 14. Definition of Done

S4 esta implementada cuando:

- el snapshot de S2 carga en el canvas de S3;
- los cuatro tipos tienen nodos renderizables y dimensiones iniciales/minimas;
- `CanvasActions` es la unica via de mutacion para toolbar, nodos y teclado;
- crear, editar, mover, redimensionar y eliminar funcionan localmente;
- las mutaciones usan la API de S2 y sustituyen el estado optimista por records
  autoritativos;
- tombstones y respuestas stale se reconcilian con LWW;
- una respuesta o error atrasado no pisa una accion local posterior;
- loading, error, retry y rollback tienen cobertura;
- reload recupera el estado persistido;
- el viewport y el estado efimero no se persisten;
- no se agrego Portal ni una dependencia nueva;
- pasan `pnpm test`, `pnpm typecheck`, `pnpm check` y `pnpm build`;
- se completa la verificacion manual de los cuatro tipos y la persistencia.

## 15. Salida para S5 y S6

S5 puede envolver el controlador con un canal Portal autenticado sin cambiar la
API publica de acciones ni la fuente canonica de elementos.

S6 puede conectar previews y eventos finales a los puntos ya definidos:

- previews efimeros durante drag, resize y edicion;
- persistencia final antes de publicar;
- deduplicacion por `eventId`;
- aplicacion de eventos remotos mediante la misma reconciliacion LWW.

La toolbar y los nodos no necesitan conocer el transporte realtime para adoptar
esas capacidades.
