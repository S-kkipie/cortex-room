# S7 - Presencia y awareness del canvas

**Fecha:** 2026-08-09
**Estado:** Implementada
**Dependencias:** S0 contratos Canvas, S4 acciones locales, S5 canal Portal autenticado y S6 operaciones multiplayer

## 1. Objetivo

Completar la capa de colaboración visual del canvas. Las personas conectadas
deben verse como participantes presentes, compartir su cursor y comunicar su
selección sin convertir esos datos transitorios en registros persistentes.
La solución debe seguir funcionando cuando Portal esté desconfigurado o cuando
un cliente entre tarde al canal, dejando S8 la recuperación de operaciones y
los estados de sincronización pendientes.

## 2. Resultado observable

- El canal Portal muestra join/leave mediante su presencia nativa y la UI
  indica cuántos colaboradores están conectados.
- El movimiento del cursor local se convierte de coordenadas de pantalla a
  coordenadas del canvas y se publica como `participant.cursor.moved` efímero,
  throttled a 50 ms.
- La selección local se publica como `participant.selection.changed` efímera;
  la metadata de presencia conserva el último cursor, selección y preview
  activo con un throttle real de 50 ms para que nuevos participantes puedan
  recuperarlos y la colaboración siga visible aunque el SDK no modele los
  mensajes efímeros en `messages`.
- Los cursores remotos se pintan dentro del viewport de React Flow, por lo que
  cada cliente puede hacer pan/zoom sin desalinear el cursor de los elementos.
- Las selecciones remotas se muestran como un overlay visual sobre los nodos,
  con identidad legible del participante y sin activar el `NodeResizer` local.
- Un participante que abandona el canal deja de aparecer en cursores,
  selecciones y contador de awareness.
- Mensajes inválidos, de otro proyecto o con sender no verificable se ignoran
  sin lanzar errores en render ni mutar el snapshot canónico.

## 3. Alcance y límites

Incluye:

- adaptadores de publicación para cursor y selección usando los builders y
  `CanvasRealtimePort` de S6;
- throttling de cursor y metadata de presencia a 50 ms;
- normalización de participantes nativos de Portal y fallback desde su
  metadata validada;
- overlays de cursor/selección integrados con React Flow;
- limpieza de awareness al recibir cambios de presencia y al desmontar;
- pruebas de publicación, conversión de coordenadas, aislamiento de proyecto,
  identidad, fallback de metadata y render de overlays.

No incluye:

- persistencia de cursores, selección, viewport o presencia en PostgreSQL;
- eventos persistentes de dominio o cambios a la regla LWW de S6;
- retry queue, buffer previo al snapshot, indicador `unsynced` o replay de
  operaciones (S8);
- colaboración sobre `apps/meet-agent/`, Figma, comentarios o edición
  multiusuario por caracteres;
- cambios de permisos Portal fuera del canal `room-{projectId}`.

## 4. Contratos

### 4.1 Presencia nativa

`CanvasPortalProvider` conserva `presence`, `me` y `setMetadata` del SDK. El
metadata de cada participante se acepta únicamente mediante
`participantPresenceMetadataSchema` y tiene esta forma:

```ts
{
  cursor?: { x: number; y: number },
  selectedElementIds: string[],
  preview?:
    | { kind: "move", elementId: string, x: number, y: number }
    | { kind: "resize", elementId: string, width: number, height: number }
    | { kind: "text", elementId: string, content: string }
}
```

El `id` y el `username` se toman del participante que Portal verifica. No se
usa `senderId` del payload como identidad visual. Si Portal sólo entrega un
aggregate, se muestra el contador disponible y no se inventan identidades.

### 4.2 Awareness efímero

Los mensajes usan `CanvasPortalMessage` y `canvasPortalMessageSchema`:

| Acción | `type` | `kind` | `ephemeral` | contenido adicional |
| --- | --- | --- | --- | --- |
| cursor | `participant.cursor.moved` | `participant.cursor.moved` | `true` | `cursor: {x,y}` |
| selección | `participant.selection.changed` | `participant.selection.changed` | `true` | `elementIds: uuid[]` |

Los campos `eventId`, `projectId` y `occurredAt` se construyen en el cliente;
`senderId` se usa sólo al publicar. Al recibir, el adaptador lo reemplaza por
`message.sender.id`, igual que en S6, y descarta mensajes que fallen Zod o no
pertenezcan al proyecto actual.

Portal Core 0.1.5 descarta los frames efímeros entrantes y su `setMetadata`
no propaga actualizaciones entre sesiones en el servicio actual. Mientras esa
limitación exista, los eventos siguen siendo semánticamente efímeros pero se
envían por el transporte fiable. `onMessage` los captura en un buffer local de
200 eventos y middleware de `portal.config.ts` los retracta después de la
entrega, por lo que no quedan en history ni se escriben en PostgreSQL.

### 4.3 Coordenadas y overlays

- El evento de puntero se transforma con `screenToFlowPosition`.
- El cursor remoto se posiciona con `ViewportPortal` en coordenadas de flow;
  no se calcula manualmente el transform ni se guarda el viewport remoto.
- La selección remota es una decoración de nodo. Sólo `selected` local controla
  `NodeResizer` y acciones destructivas.
- Un overlay nunca modifica `CanvasSnapshot`, dispara una mutación Eden ni
  crea un evento persistente.

## 5. Criterios de aceptación

### AC-01 Presencia y salida

Given dos clientes autenticados en el mismo `room-{projectId}`
When uno entra o abandona
Then el otro refleja el contador/participante disponible desde Portal y limpia
su cursor y selección cuando desaparece de presence.

### AC-02 Cursor

Given el usuario mueve el puntero sobre el canvas
When hay movimiento continuo
Then se publica como máximo un cursor efímero cada 50 ms, usando coordenadas de
flow, sin llamadas al API del canvas.

### AC-03 Selección y fallback

Given el usuario cambia la selección local
When se actualiza el controller
Then se publica un evento efímero y se actualiza metadata como máximo cada
50 ms. Un usuario que llega tarde puede obtener el último estado desde
presence metadata. El throttle no se reinicia con cada movimiento continuo.

### AC-04 Render independiente

Given un cursor o selección remotos válidos
When el cliente hace pan o zoom
Then el cursor sigue anclado al mismo punto del canvas y el nodo seleccionado
mantiene su overlay, sin alterar el estado local ni activar controles locales.

### AC-05 Seguridad y aislamiento

Given un mensaje inválido, otro `projectId`, un participante no presente o un
eco propio
When se normaliza awareness
Then se ignora y no aparece en la UI.

### AC-06 Integración y límites

Given Portal no está configurado o está reconectando
When el canvas se renderiza
Then el editor sigue siendo usable, los publishers son no-op seguros y ningún
componente de UI importa el SDK Portal directamente.

## 6. Pruebas y definición de terminado

- builders: cursor y selección producen mensajes efímeros válidos;
- controller/provider: throttle de cursor, metadata throttle, identidad y
  limpieza al salir;
- normalización: presencia detailed/aggregate, metadata inválida, scope y
  self-echo;
- UI: coordenadas de pantalla a flow, `ViewportPortal`, overlay de selección y
  contador de participantes;
- `pnpm test`, `pnpm typecheck`, Biome enfocado de Canva y `pnpm build` pasan;
- cada tarea termina con revisión de `docs/code-review/README.md` y las guías
  aplicables; cualquier hallazgo se corrige en la misma tarea;
- no cambia ningún archivo de `apps/meet-agent/`;
- S7 se entrega en un único commit antes de comenzar S8.
