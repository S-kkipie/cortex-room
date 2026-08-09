# S3 - Navigable Canvas

**Fecha:** 2026-08-08\
**Estado:** Aprobada para planificacion\
**Diseno padre:** `docs/superpowers/specs/2026-08-08-collaborative-canvas-design.md`\
**Dependencias:** S0 Canvas Contracts, S1 Authenticated Canvas Shell y S2 Persistent Canvas Snapshot\
**Estimacion original:** 60 minutos

## 1. Objetivo

Sustituir el placeholder central del shell autenticado por un canvas infinito y
navegable construido con React Flow. Al terminar S3, un usuario puede desplazar
el viewport, hacer zoom mediante gestos o controles visibles y restablecer la
vista al origen.

S3 entrega exclusivamente la navegacion local del canvas. No carga el snapshot
de S2, no muestra elementos y no adelanta las acciones de S4. El estado
permanente del canvas continua separado de la camara local de cada usuario.

## 2. Resultado observable

Un usuario autenticado que abre `/projects/:projectId/canvas` ve:

- el header de S1 sin cambios funcionales;
- una superficie React Flow que ocupa todo el espacio restante del viewport;
- un patron de puntos sutiles que permite percibir desplazamiento y escala;
- desplazamiento al arrastrar el fondo;
- zoom mediante rueda del mouse o gesto pinch;
- controles shadcn de zoom en la esquina inferior derecha;
- el porcentaje de zoom actual;
- una accion que restablece posicion y zoom.

El canvas comienza vacio aunque S2 contenga elementos persistidos. La carga y
representacion de esos elementos pertenece integramente a S4.

## 3. Dependencias y limites

S3 usa:

- el route shell y los estados de ruta entregados por S1;
- React 19 y Next.js 16;
- `@xyflow/react` como motor de viewport;
- los componentes shadcn `Button` y `Tooltip` existentes;
- Lucide para los iconos de los controles;
- Vitest y `happy-dom` para pruebas del limite cliente.

S3 agrega `@xyflow/react` como unica dependencia nueva. Sus estilos oficiales
se importan una sola vez desde el arbol global de estilos de la aplicacion.

S3 no consume la API ni los contratos persistentes creados en S2. Tampoco
agrega Portal, otro gestor de estado o nuevas librerias de testing.

## 4. Arquitectura de componentes

### 4.1 `CanvasShell`

`CanvasShell` permanece como componente de servidor y conserva:

- regreso a `/projects`;
- nombre truncable del proyecto;
- identidad disponible del usuario;
- cierre de sesion;
- altura completa sin heredar el header del layout de aplicacion.

Su placeholder se reemplaza por una region `flex-1 min-h-0` que renderiza
`NavigableCanvas`. El shell no conoce la instancia de React Flow ni mantiene
estado del viewport.

### 4.2 `NavigableCanvas`

`NavigableCanvas` es la unica isla cliente nueva de S3. Encapsula:

- `ReactFlowProvider`;
- un componente `ReactFlow` sin nodes ni edges;
- `Background` con variante de puntos;
- los limites y el estado del viewport;
- `CanvasViewportControls`.

El provider queda en este limite para que los controles de S3 y las futuras
acciones de S4 usen una misma instancia sin convertir el shell completo en un
Client Component.

El contenedor de React Flow siempre tiene ancho y alto disponibles. La region
principal usa `min-h-0` y oculta overflow para que React Flow no introduzca
scroll de pagina.

### 4.3 `CanvasViewportControls`

`CanvasViewportControls` vive dentro del provider y usa la API de React Flow.
Renderiza un grupo shadcn superpuesto en la esquina inferior derecha, separado
de los bordes por un espacio apto para desktop y movil.

El grupo contiene, en este orden:

1. zoom out;
2. porcentaje actual;
3. zoom in;
4. reset viewport.

El componente solo conoce operaciones y valores de viewport. No recibe
`projectId`, snapshots, elementos ni datos de usuario.

## 5. Contrato del viewport

### 5.1 Estado inicial y limites

El viewport inicial es:

```ts
{ x: 0, y: 0, zoom: 1 }
```

Los limites son:

```text
minZoom = 0.25
maxZoom = 2
```

El porcentaje visible se deriva del zoom actual como un entero redondeado. No
existe una segunda fuente de verdad para la camara.

### 5.2 Gestos nativos

S3 conserva la interaccion nativa de React Flow:

- arrastrar una zona vacia desplaza el viewport;
- la rueda hace zoom;
- pinch hace zoom en dispositivos compatibles;
- los eventos permanecen contenidos en la superficie del canvas.

No se implementan todavia modos Select o Hand, barra espaciadora para pan ni
atajos de herramientas. S4 definira como conviven las herramientas con estos
gestos.

### 5.3 Controles

Zoom in y zoom out usan las operaciones de la instancia React Flow con una
transicion corta de 200 ms. Los botones se deshabilitan al alcanzar 200% y 25%,
respectivamente.

Reset usa `setViewport` para animar durante 200 ms hacia:

```ts
{ x: 0, y: 0, zoom: 1 }
```

En S3 reset no ejecuta `fitView`: al no existir nodos, un ajuste a contenido no
tiene resultado util. S4 puede agregar fit-to-content como una accion distinta
cuando existan elementos.

## 6. Estado local y flujo de datos

La camara es local y efimera porque representa donde esta mirando cada usuario,
no el contenido compartido del canvas.

Flujo:

1. React Flow monta el viewport en origen y zoom 1.
2. Un gesto o control cambia la transformacion local.
3. `onViewportChange` entrega la transformacion actual.
4. Los controles derivan y muestran el nuevo porcentaje.
5. Una recarga descarta la transformacion y vuelve al estado inicial.

El viewport no se:

- envia a Elysia;
- guarda en PostgreSQL;
- publica por Portal;
- almacena en query params o `localStorage`;
- comparte entre usuarios.

Esta regla evita que la navegacion de un colaborador mueva la camara de otro y
preserva la separacion entre estado permanente, realtime y presentacion local.

## 7. Presentacion y accesibilidad

- El patron de puntos usa colores sutiles compatibles con tema claro y oscuro.
- Los puntos se transforman junto con el viewport para evidenciar pan y zoom.
- Los controles tienen contraste, borde y fondo suficientes sobre el canvas.
- Cada boton de icono tiene nombre accesible y tooltip visible.
- El grupo tiene el nombre accesible `Canvas zoom controls`.
- El porcentaje tiene un nombre accesible que incluye el valor actual y no es
  editable.
- Los controles mantienen un area de interaccion adecuada para tactil.
- El header y sus acciones esenciales permanecen accesibles en pantallas
  estrechas.
- No se oculta atribucion requerida por React Flow mediante una configuracion
  incompatible con su licencia.

## 8. Criterios de aceptacion

### AC-01 Canvas reemplaza el placeholder

Given un usuario autenticado y un proyecto existente\
When abre el route de canvas\
Then ve una superficie React Flow que ocupa la region principal y ya no ve el
mensaje `Workspace ready`.

### AC-02 Canvas vacio

Given que el proyecto tiene o no elementos persistidos en S2\
When S3 renderiza el canvas\
Then React Flow recibe colecciones vacias de nodes y edges y no consulta el
snapshot.

### AC-03 Pan local

Given el canvas montado\
When el usuario arrastra una zona vacia\
Then cambia la posicion del viewport y el patron de puntos se desplaza sin
producir scroll de pagina.

### AC-04 Zoom por gesto

Given el canvas montado\
When el usuario usa rueda o pinch sobre la superficie\
Then cambia el zoom dentro del rango de 25% a 200% y el porcentaje visible se
actualiza.

### AC-05 Zoom por controles

Given un zoom que no esta en un limite\
When el usuario activa zoom in o zoom out\
Then React Flow anima el cambio correspondiente y actualiza el porcentaje.

### AC-06 Limites de zoom

Given que el viewport esta en 25% o 200%\
When se muestran los controles\
Then el boton que excederia ese limite esta deshabilitado y el viewport no sale
del rango.

### AC-07 Reset

Given un viewport desplazado o con zoom distinto de 100%\
When el usuario activa reset\
Then el viewport anima a `x: 0`, `y: 0`, `zoom: 1` y muestra 100%.

### AC-08 Estado efimero

Given que el usuario modifico posicion y zoom\
When recarga el route\
Then el viewport vuelve al origen al 100% y no se realiza ninguna escritura de
persistencia o realtime.

### AC-09 Accesibilidad

Given navegacion mediante tecnologia asistiva\
When el usuario recorre los controles\
Then identifica el grupo, el proposito de cada boton y el porcentaje actual.

### AC-10 Shell responsive

Given un viewport desktop o movil\
When se renderizan shell, canvas y controles\
Then no aparece scroll vertical por la composicion, el nombre del proyecto se
trunca y las acciones esenciales permanecen disponibles.

### AC-11 Aislamiento

Given dos usuarios en el mismo proyecto\
When uno desplaza o amplia su viewport\
Then la camara del otro usuario y el estado permanente del canvas no cambian.

## 9. Casos de error y limites operativos

- S3 no realiza requests, por lo que no introduce estados propios de loading,
  offline o error de red.
- Un error inesperado de render se delega al `error.tsx` existente del route.
- React Flow no debe montar dentro de un contenedor sin dimensiones; el layout
  flexible garantiza altura y ancho disponibles.
- Los controles no permiten sobrepasar los limites aunque se activen varias
  veces durante una animacion.
- La ausencia de nodes no se presenta como error ni como estado vacio de datos;
  es el resultado intencional de este slice.
- La navegacion tactil depende de soporte pointer/pinch del navegador y se
  verifica manualmente en un dispositivo compatible cuando este disponible.

## 10. Tests y verificacion

### 10.1 Cobertura automatizada

Vitest usa `happy-dom` para el limite cliente y mocks controlados de
`@xyflow/react`. Las pruebas observan contratos publicos y comportamiento, no
detalles internos de la libreria.

La cobertura incluye:

- renderizado de React Flow, fondo y controles;
- nodes y edges vacios;
- porcentaje inicial de 100%;
- actualizacion del porcentaje al cambiar el viewport;
- invocacion de zoom in y zoom out;
- reset exacto al origen y zoom 1;
- estado disabled de zoom out al 25%;
- estado disabled de zoom in al 200%;
- nombres accesibles del grupo y sus acciones;
- preservacion del header de `CanvasShell`.

No se agrega una libreria de browser tests para S3. Los gestos reales, calculos
de layout y comportamiento visual de React Flow se cubren mediante verificacion
manual porque un mock de DOM no reproduce fielmente `ResizeObserver`, wheel y
pinch.

### 10.2 Verificacion manual

En un proyecto existente:

1. abrir el canvas en desktop y confirmar que ocupa el alto disponible;
2. arrastrar el fondo y comprobar el movimiento del patron;
3. usar rueda y controles hasta ambos limites;
4. desplazar y ampliar, ejecutar reset y comprobar origen al 100%;
5. recargar y confirmar que la vista vuelve al estado inicial;
6. repetir en un viewport movil y probar pinch cuando haya dispositivo
   compatible;
7. confirmar que no hay requests de snapshot ni escrituras de canvas;
8. confirmar que Projects, identidad y sign-out siguen accesibles.

### 10.3 Comandos de calidad

S3 se considera verificable cuando pasan:

```text
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

## 11. Non-goals

S3 no implementa:

- carga o renderizado del snapshot de S2;
- nodes, edges o custom node types;
- creacion, seleccion, movimiento, resize, edicion o eliminacion de elementos;
- toolbar de herramientas;
- minimap o fit-to-content;
- seleccion rectangular o atajos de herramientas;
- persistencia o sincronizacion del viewport;
- Portal, presencia, cursores o estado de conexion;
- estados de carga de datos, retries u offline;
- cambios a autenticacion, acceso compartido o CRUD de Project.

## 12. Salida para S4

S4 puede montar los elementos derivados del snapshot dentro de
`NavigableCanvas`, registrar custom node types y despachar acciones sin cambiar
el route, el shell, el provider ni los controles de viewport. La camara continua
siendo local mientras los elementos pasan a usar la fuente de estado canonica y
el action API definidos por el diseno padre.

## 13. Definicion de terminado

S3 esta implementada cuando:

- `@xyflow/react` es la unica dependencia nueva;
- el placeholder de S1 fue sustituido por un React Flow vacio y navegable;
- pan, wheel, pinch, zoom in, zoom out y reset funcionan localmente;
- el porcentaje refleja la transformacion actual entre 25% y 200%;
- reset vuelve al origen al 100%;
- el patron de puntos y los controles son legibles en ambos temas;
- shell y canvas no producen scroll vertical accidental;
- no se consulta S2 ni se introduce estado permanente o realtime;
- las pruebas automatizadas y la verificacion manual descritas se completan;
- `pnpm test`, `pnpm typecheck`, `pnpm check` y `pnpm build` pasan.
