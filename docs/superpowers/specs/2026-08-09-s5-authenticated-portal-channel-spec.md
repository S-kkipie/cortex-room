# S5 - Canal Portal autenticado

**Fecha:** 2026-08-09  
**Estado:** Implementada  
**Diseño padre:** `docs/superpowers/specs/2026-08-08-collaborative-canvas-design.md`  
**Dependencias:** S0 Canvas Contracts, S1 Authenticated Canvas Shell, S2 Persistent Canvas Snapshot, S3 Navigable Canvas y S4 Local Elements and Actions

## 1. Objetivo

Conectar cada canvas autenticado al canal Portal identificado y limitado al
proyecto actual. Al terminar S5, el usuario puede ver si el canal está conectado,
reconectando, degradado o bloqueado, sin que una incidencia de Portal impida
cargar ni editar localmente el canvas.

S5 entrega únicamente el transporte autenticado y su estado observable. S6 usará
el adaptador para publicar/aplicar operaciones; S7 usará sus metadatos de
presencia; S8 usará el buffer de history y el estado de reconexión.

## 2. Resultado observable

- Un usuario autenticado que abre `/projects/:projectId/canvas` obtiene un token
  Portal sólo para `room-${projectId}`.
- El navegador nunca recibe `PORTAL_SECRET_KEY` ni puede pedir un token para un
  proyecto inexistente.
- El canal usa identidad identificada (`user.id`) y un nombre legible derivado
  de `user.name` o `user.email`.
- El cliente solicita `history: 200`, conecta antes de instalar el snapshot y
  expone el estado `Live`, `Connecting`, `Reconnecting`, `Degraded`, `Blocked` o
  `Unavailable`.
- Si faltan credenciales de Portal o el servicio falla, el canvas muestra el
  estado no disponible y conserva las funciones locales de S4.

## 3. Alcance y límites

Incluye:

- `@portalsdk/core`, `@portalsdk/react` y configuración local de Portal;
- variables de entorno tipadas para la clave pública y secreta;
- endpoint autenticado de token room-scoped;
- provider/adaptador client-only del canal Canva;
- estado de conexión accesible para S6–S8 y su indicador en el canvas;
- pruebas de autorización, envelope, normalización de estado y render.

No incluye:

- publicación o aplicación de eventos de elementos (S6);
- cursores, selección remota o roster visual (S7);
- retry queue, backfill/replay reducer o unsynced feedback (S8);
- cambios en `apps/meet-agent/`;
- persistencia de presencia, cursor, viewport o selección;
- authz de negocio en Portal más allá de `anonymous: false` y el token por room.

## 4. Contratos

### 4.1 Variables de entorno

`PORTAL_SECRET_KEY` es server-only, se valida como una clave `sk_...` cuando se
configura y se usa exclusivamente para llamar a Portal.  
`NEXT_PUBLIC_PORTAL_API_KEY` es browser-safe, se valida como `pk_...` cuando se
configura y sólo sirve para construir el cliente Portal.

Ambas son opcionales para que los entornos sin Portal sigan siendo ejecutables:
sin clave pública no se crea conexión y se muestra `Unavailable`; si falta sólo
la clave secreta, el token falla de forma controlada y el canal queda
`Blocked`/`Degraded` sin romper build, SSR ni el fallback local.

### 4.2 Endpoint de token

```text
GET /api/v1/portal/token?projectId=<uuid>
```

Requiere Better Auth y valida que el proyecto exista. Responde con el envelope
común:

```ts
{
  response: {
    token: string,
    channelId: `room-${projectId}`,
    expiresAt: string,
  },
  code: "OK",
  status: 200,
}
```

El servicio solicita a `POST https://api.useportal.co/v1/tokens` una credencial
de una hora para la identidad autenticada y las capacidades
`{ [channelId]: ["connect", "publish"] }`. El parser de respuesta valida que el
token sea no vacío y que `expiresAt` sea ISO; una respuesta externa inválida se
convierte en error interno sin filtrar el body remoto.

### 4.3 Adaptador client-side

`CanvasPortalProvider({ projectId, children })` crea un único cliente Portal por
módulo, usa un callback de token con
`credentials: "include"`, y monta `useChannel<CanvasPortalMessage>` con:

- `channelId: room-${projectId}`;
- `history: 200`;
- `metadata: { selectedElementIds: [] }`;
- `anonymous: false` en `portal.config.ts`.

El provider expone `useCanvasPortal()` con `status`, `historyReady`, `messages`,
`presence`, `me`, `sendPersistent`, `sendEphemeral`, `setMetadata` y un estado
`configured`. El SDK no se importa desde toolbar, nodos ni controller UI.

Los mensajes se normalizan antes de salir del adaptador: el `senderId` del
envelope se sustituye por el ID verificado por Portal, nunca por un campo de
contenido recibido. Payloads inválidos se descartan de forma segura sin romper
el render.

### 4.4 Ciclo de carga

El provider se monta y comienza a bufferizar history antes de que el controller
habilite la consulta del snapshot. `historyReady` es verdadero cuando la primera
conexión deja de estar en `idle/connecting`, incluso si Portal termina en
`blocked` o `degraded`; en ese caso el snapshot sigue siendo cargable y S8
mostrará el estado de sincronización correspondiente.

## 5. Criterios de aceptación

### AC-01 Token autenticado y limitado

Given un usuario autenticado y un proyecto válido  
When solicita el endpoint  
Then recibe un token para una sola room y nunca se incluye la clave secreta.

### AC-02 Rechazos

Given una petición sin sesión o con proyecto inexistente  
When solicita el endpoint  
Then recibe 401/404 con envelope común y no se llama a Portal.

### AC-03 Configuración segura

Given un entorno sin `NEXT_PUBLIC_PORTAL_API_KEY`  
When se inicia el canvas  
Then no se abre un WebSocket, se muestra `Unavailable` y S4 sigue operativa.

Given existe la clave pública pero falta `PORTAL_SECRET_KEY`  
When Portal solicita el token autenticado  
Then la conexión queda `Blocked` o `Degraded`, el snapshot sigue siendo
cargable y S4 conserva sus funciones locales.

### AC-04 Canal identificado

Given credenciales Portal válidas  
When se monta un canvas  
Then conecta a `room-${projectId}` usando `user.id`, `userLabel`, `history: 200`
y `anonymous: false`.

### AC-05 Renovación

Given una reconexión o expiración del token  
When Portal invoca el callback  
Then el callback vuelve a pedir el token con cookies de sesión.

### AC-06 Estado visible

Given cualquier transición de Portal  
When cambia `status`  
Then el canvas refleja el estado sin bloquear las acciones locales salvo durante
la carga inicial del snapshot.

### AC-07 Mensaje inválido

Given un mensaje Portal con envelope o evento inválido  
When llega al adaptador  
Then se ignora, se registra y no cambia el snapshot ni desmonta el canvas.

### AC-08 Integridad de scope

Given un token emitido para `room-A`  
When el cliente intenta usarlo en `room-B`  
Then el diseño del cliente no permite cambiar el `channelId` del provider y el
servidor sólo emite el scope solicitado para el proyecto autenticado.

## 6. Pruebas

- Servicio: proyecto inexistente, sesión autenticada, secreto ausente, respuesta
  válida, respuesta externa inválida y error HTTP remoto.
- Ruta: schema de query, `authed: true`, envelopes 200/401/404/500 y ausencia de
  secreto en cualquier respuesta.
- Adaptador: channel ID, `history: 200`, token callback, estado de conexión,
  fallback `Unavailable`, normalización de sender y descarte de payload inválido.
- UI: indicador accesible y canvas local usable mientras Portal está bloqueado.

Comandos mínimos por tarea: el test enfocado, `pnpm typecheck`, `pnpm check` y
los tests existentes afectados. Antes del commit de S5: `pnpm test` y
`pnpm build`.

## 7. Definition of Done

- La ruta de token está autenticada, validada, testeada y montada en el router.
- El secreto sólo se lee en server y el cliente sólo recibe token room-scoped.
- Portal se integra detrás de `CanvasPortalProvider` con history 200 y estado
  visible.
- La ausencia/falla de Portal no rompe la experiencia local de S4.
- `apps/meet-agent/` no cambia.
- Cada tarea tiene revisión con `docs/code-review/` y sus hallazgos corregidos.
- Existe un único commit de S5 que contiene únicamente S5 y su documentación.
