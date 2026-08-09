# S1 - Authenticated Canvas Shell

**Fecha:** 2026-08-08  
**Estado:** Draft for review  
**Diseno padre:** `docs/superpowers/specs/2026-08-08-collaborative-canvas-design.md`  
**Dependencia:** S0 completada  
**Estimacion de implementacion:** 45-60 minutos

## 1. Objetivo

Crear el punto de entrada autenticado y full-screen del canvas colaborativo. Al terminar S1, un usuario puede abrir un canvas desde la tabla de proyectos o mediante un deep link, autenticarse si es necesario y regresar al mismo canvas.

S1 valida la existencia del proyecto con la politica compartida aprobada para Canvas: cualquier usuario autenticado puede abrir un proyecto existente, incluso si no es su propietario o esta archivado. La excepcion queda aislada del CRUD owner-only de Project.

S1 entrega el shell y sus estados de ruta, pero no implementa React Flow, elementos, persistencia del canvas ni Portal.

## 2. Resultado observable

Un usuario puede:

- elegir `Open canvas` desde una fila de `/projects`;
- abrir `/projects/[projectId]/canvas` en un viewport dedicado;
- iniciar sesion o registrarse desde un deep link y volver al canvas original;
- ver el nombre del proyecto, su identidad, una accion para cerrar sesion y una accion para volver a proyectos;
- abrir mediante URL el canvas de otro usuario autenticado;
- abrir normalmente un proyecto archivado;
- recibir un 404 especifico cuando el proyecto no existe;
- reintentar o volver a proyectos cuando ocurre un error inesperado.

## 3. Dependencias

S1 depende de:

- los contratos y la excepcion de acceso documentados en S0;
- Better Auth y los componentes de autenticacion existentes;
- Next.js App Router;
- Drizzle y la tabla `projects` existente;
- los componentes shadcn/ui y Lucide ya instalados.

S1 no modifica `package.json`. React Flow se instala en S3 y Portal en S5.

## 4. Archivos de implementacion previstos

```text
src/app/(workspace)/projects/[projectId]/canvas/page.tsx
src/app/(workspace)/projects/[projectId]/canvas/loading.tsx
src/app/(workspace)/projects/[projectId]/canvas/error.tsx
src/app/(workspace)/projects/[projectId]/canvas/not-found.tsx
src/core/canvas/client/ui/canvas-shell.tsx
src/core/canvas/server/repository/find-project-for-canvas-by-id.ts
src/core/canvas/server/services/get-canvas-project-service.ts
src/core/canvas/server/services/__tests__/get-canvas-project-service.test.ts
src/frontend/components/auth/auth.tsx
src/frontend/components/auth/sign-in.tsx
src/frontend/components/auth/sign-up.tsx
src/frontend/components/auth/return-to.ts
src/frontend/components/auth/__tests__/return-to.test.ts
src/core/project/client/ui/table/columns.tsx
src/server/auth/require-auth.ts
```

La implementacion puede ajustar nombres menores, pero debe conservar los limites descritos en esta spec. No se crea una ruta Elysia en S1.

## 5. Arquitectura de ruta

La ruta vive en un route group de presentacion separado:

```text
src/app/
|-- (app)/projects/page.tsx
`-- (workspace)/projects/[projectId]/canvas/
    |-- page.tsx
    |-- loading.tsx
    |-- error.tsx
    `-- not-found.tsx
```

El route group `(workspace)` no crea otra aplicacion, otro deployment ni otro conjunto de providers, y tampoco cambia la URL publica. La ruta sigue heredando el root layout y sus providers globales. El grupo separa unicamente la presentacion para impedir que el header administrativo de `(app)` reduzca el area util del editor.

El nombre `workspace` describe el tipo de shell full-screen, no un dominio. Otros modulos inmersivos de la misma herramienta pueden reutilizarlo en el futuro sin convertir Canvas en una aplicacion separada.

Flujo de `page.tsx`:

1. resolver `projectId` desde `params`;
2. construir el path canonico `/projects/{projectId}/canvas`;
3. exigir autenticacion y usar ese path como retorno;
4. ejecutar `getCanvasProjectService(projectId)`;
5. convertir `NotFoundError` en `notFound()`;
6. convertir `UnexpectedError` en una excepcion para `error.tsx`;
7. renderizar `CanvasShell` con el proyecto y el usuario autenticado.

La autenticacion ocurre antes de consultar el proyecto. Un visitante anonimo no puede usar esta ruta para comprobar si un `projectId` existe.

## 6. Contrato de autenticacion y retorno

### 6.1 Redireccion desde el canvas

Un visitante sin sesion que abre:

```text
/projects/550e8400-e29b-41d4-a716-446655440000/canvas
```

es redirigido a:

```text
/auth/sign-in?returnTo=%2Fprojects%2F550e8400-e29b-41d4-a716-446655440000%2Fcanvas
```

`requireAuth` acepta un destino opcional. Cuando no recibe destino conserva el comportamiento actual de redirigir a `/auth/sign-in`. Cuando lo recibe, genera la query con `URLSearchParams`; no concatena valores sin codificar.

### 6.2 Sanitizacion

`return-to.ts` expone una funcion pura con este contrato conceptual:

```ts
sanitizeReturnTo(value: string | string[] | undefined): string;
```

La funcion:

- devuelve `/projects` para valores ausentes, arrays o strings vacios;
- exige que el valor comience con exactamente un `/`;
- rechaza valores que comiencen con `//`;
- rechaza cualquier backslash;
- rechaza URLs absolutas y esquemas como `https:`, `javascript:` o `data:`;
- recibe el valor ya decodificado por App Router y no ejecuta `decodeURIComponent` otra vez;
- devuelve la ruta interna sin transformarla cuando es valida.

Estas reglas evitan open redirects y ambiguedades entre parsers de URL.

### 6.3 Sign-in y sign-up

La pagina `auth/[path]` lee `searchParams.returnTo`, lo sanitiza en servidor y pasa el destino seguro a `Auth`.

`Auth`, `SignIn` y `SignUp` aceptan el destino como una prop explicita. Para estas dos vistas, la prop reemplaza el `redirectTo="/projects"` global despues de una autenticacion exitosa.

Los enlaces internos entre sign-in y sign-up preservan la query mediante `URLSearchParams`. El flujo de recuperacion de contrasena conserva su comportamiento actual y no promete regresar al canvas.

Si la query falta o es invalida, sign-in y sign-up terminan en `/projects`.

## 7. Politica de acceso Canvas

La lectura de proyecto para Canvas sigue este flujo:

```text
Canvas page
    -> getCanvasProjectService(projectId)
        -> findProjectForCanvasById(projectId)
            -> projects.id = projectId
```

### 7.1 Repository

`findProjectForCanvasById`:

- es server-only;
- consulta la tabla `projects` por `id`;
- no recibe ni filtra por `userId`;
- no filtra por `status`;
- retorna una fila o `null`;
- no modifica ni reemplaza `findProjectById` del dominio Project.

La ausencia deliberada de `userId` representa la politica de Canvas aprobada, no una omision accidental.

### 7.2 Service

`getCanvasProjectService` retorna `AsyncAppResult<Project>` y reutiliza el schema, tipo y conversion de Project existentes. No crea una interfaz duplicada para el shell.

Resultados:

- fila encontrada: `ok(project)`;
- fila ausente: `err(AppErrors.notFound({ targets: ["projectId"] }))`;
- excepcion de infraestructura: `err(AppErrors.unexpected(cause))`.

Los errores esperados siguen siendo valores dentro del service. La pagina es el limite que traduce `NotFoundError` a `notFound()` y envuelve la causa de `UnexpectedError` en un `Error` para activar el error boundary.

### 7.3 Limite de la excepcion

S1 no agrega flags como `skipOwnership` o `shared` a repositories o services de Project. Las pantallas y APIs de Project continuan siendo owner-only. Solo las operaciones bajo el dominio Canvas pueden usar la consulta sin ownership.

## 8. Canvas shell

`CanvasShell` ocupa `min-h-svh` y se divide en:

- una barra superior compacta;
- una region principal flexible reservada para S3.

La barra superior incluye:

- enlace o boton para volver a `/projects`;
- nombre truncable del proyecto;
- nombre, email o identidad disponible del usuario;
- accion de cierre de sesion.

La region principal muestra un estado neutral que comunica que el workspace esta disponible. No representa herramientas, controles de zoom ni interacciones que aun no existen.

Requisitos de presentacion:

- el shell no hereda el header de `(app)`;
- no produce scroll vertical por sumar headers al viewport;
- el nombre del proyecto se trunca antes de desplazar acciones esenciales;
- las acciones con icono tienen nombre accesible;
- en pantallas estrechas la identidad secundaria puede compactarse, pero volver y cerrar sesion permanecen disponibles;
- el area principal puede ser sustituida por React Flow en S3 sin rehacer la autenticacion ni el header.

## 9. Estados de ruta

### 9.1 Loading

`loading.tsx` muestra una estructura ligera del shell con skeletons para la barra superior y el area principal. No presenta un canvas vacio como si la carga hubiera terminado correctamente.

### 9.2 Not found

`not-found.tsx` muestra:

- el mensaje `Canvas not found`;
- una explicacion breve que no revela datos de otro proyecto;
- una accion para volver a `/projects`.

Se usa tanto para un UUID inexistente como para cualquier `projectId` que no produzca un proyecto valido. No se redirige silenciosamente.

### 9.3 Unexpected error

`error.tsx` es un Client Component y muestra:

- un mensaje de error no tecnico;
- `Retry`, que llama a `reset()`;
- `Back to projects`.

No imprime credenciales, queries ni la causa interna. El error original puede registrarse mediante la infraestructura existente.

## 10. Entrada desde la tabla de proyectos

El menu de acciones de cada fila agrega `Open canvas` como primer item. El item usa un `Link` hacia:

```text
/projects/{project.id}/canvas
```

La accion:

- esta disponible para proyectos activos y archivados;
- no abre un modal;
- no usa `DataTableRowAction`;
- conserva `Edit` y `Delete` sin cambiar su comportamiento;
- no agrega una columna nueva.

## 11. Criterios de aceptacion

### AC-01 Deep link anonimo

Given un visitante sin sesion y un path de canvas  
When abre el deep link  
Then es redirigido a sign-in con el path completo en una query `returnTo` codificada.

### AC-02 Retorno despues de sign-in

Given un `returnTo` de canvas valido  
When el usuario completa sign-in correctamente  
Then navega al mismo canvas y no a `/projects`.

### AC-03 Retorno despues de sign-up

Given un usuario que pasa de sign-in a sign-up conservando `returnTo`  
When completa sign-up sin verificacion adicional  
Then navega al mismo canvas.

### AC-04 Fallback seguro

Given un `returnTo` ausente, externo, protocol-relative, con backslash o con multiples valores  
When se resuelve el destino  
Then el resultado es `/projects`.

### AC-05 Proyecto propio

Given un usuario autenticado y uno de sus proyectos existentes  
When abre el canvas  
Then ve el shell con el nombre del proyecto.

### AC-06 Proyecto de otro usuario

Given un usuario autenticado con el URL valido de un proyecto ajeno  
When abre el canvas  
Then ve el mismo shell sin recibir un error de ownership.

### AC-07 Proyecto archivado

Given un proyecto archivado existente  
When un usuario autenticado abre su canvas  
Then el shell se renderiza normalmente y no activa modo de solo lectura.

### AC-08 Proyecto inexistente

Given un usuario autenticado y un `projectId` inexistente  
When abre el canvas  
Then Next renderiza el estado `Canvas not found` con regreso a proyectos.

### AC-09 Fallo inesperado

Given un fallo de infraestructura al consultar el proyecto  
When la pagina resuelve el service  
Then muestra el error boundary con acciones para reintentar y volver.

### AC-10 Entrada desde Projects

Given una fila en la tabla de proyectos  
When el usuario selecciona `Open canvas`  
Then navega al path de canvas correspondiente sin abrir un modal.

### AC-11 Shell responsive

Given un viewport de escritorio o movil  
When el shell se renderiza  
Then ocupa el alto disponible, mantiene accesibles las acciones esenciales y no desborda por el nombre del proyecto.

### AC-12 Aislamiento de Project

Given el CRUD y las APIs existentes de Project  
When S1 termina  
Then sus lecturas y mutaciones siguen filtrando por `userId`.

## 12. Casos de error y limites

- Un visitante anonimo se redirige antes de consultar existencia del proyecto.
- Un `returnTo` invalido nunca se navega ni se refleja como URL de destino.
- App Router entrega `searchParams` decodificados; una segunda decodificacion esta prohibida.
- Un proyecto inexistente produce 404, no un canvas vacio.
- Un fallo de base de datos produce el error boundary, no un falso 404.
- Un proyecto archivado no es un error.
- Un proyecto de otro propietario no es un error dentro de Canvas.
- Cerrar sesion desde el shell usa el comportamiento existente y termina en sign-in.
- S1 no persiste operaciones ni necesita credenciales Portal.

## 13. Plan de pruebas TDD

### 13.1 Sanitizacion y URLs

Crear primero `return-to.test.ts` con casos que fallen por ausencia del helper:

1. acepta `/projects`;
2. acepta un path de canvas con UUID;
3. conserva query y fragment internos validos;
4. usa `/projects` para `undefined` y string vacio;
5. usa `/projects` para arrays;
6. rechaza `https://evil.example`;
7. rechaza `//evil.example`;
8. rechaza backslashes;
9. rechaza esquemas no HTTP como `javascript:`;
10. construye la URL de sign-in con `URLSearchParams`.

### 13.2 Service Canvas

Crear primero `get-canvas-project-service.test.ts` con un repository simulado:

1. retorna `ok(project)` para un proyecto activo;
2. retorna `ok(project)` para un proyecto archivado;
3. no exige que el usuario autenticado sea el propietario;
4. retorna `NotFoundError` para `null`;
5. convierte una excepcion del repository en `UnexpectedError`.

### 13.3 Verificacion manual

Vitest usa entorno Node y el repositorio no tiene un setup de browser tests. S1 no introduce Playwright ni Testing Library solo para este slice. Los limites de App Router y la navegacion se verifican manualmente:

1. tabla -> `Open canvas` -> shell;
2. deep link anonimo -> sign-in -> mismo canvas;
3. sign-in -> sign-up -> mismo canvas;
4. return malicioso -> `/projects`;
5. proyecto ajeno -> shell;
6. proyecto archivado -> shell;
7. ID inexistente -> 404;
8. inspeccion responsive en desktop y movil.

El ciclo requerido es:

```text
RED: tests fallan porque helpers y service no existen
GREEN: implementar el comportamiento minimo
REFACTOR: eliminar duplicacion sin ampliar el alcance
```

## 14. No objetivos

S1 no implementa:

- React Flow, pan, zoom o fit view;
- toolbar o herramientas de insercion;
- elementos de workspace;
- canvas actions;
- tabla o migracion de elementos;
- API de snapshot o mutaciones;
- Portal, tokens, channels, presencia o realtime;
- loading de snapshots;
- permisos, membresias o invitaciones;
- modo de solo lectura para proyectos archivados;
- redisenos generales de autenticacion o Projects;
- nuevos paquetes.

## 15. Definition of Done

S1 esta implementada cuando:

- existe el route group `(workspace)` para experiencias full-screen de la misma aplicacion;
- un deep link anonimo regresa al mismo canvas despues de sign-in o sign-up;
- `returnTo` se valida con una funcion pura y probada;
- cualquier usuario autenticado puede abrir cualquier proyecto existente;
- Project conserva su politica owner-only;
- proyectos archivados abren normalmente;
- loading, 404 y error inesperado tienen estados diferenciados;
- la tabla incluye `Open canvas`;
- el shell funciona en desktop y movil;
- no se agregaron dependencias, React Flow, Portal ni persistencia;
- pasan los siguientes comandos:

```bash
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

## 16. Salida para S2 y S3

S2 puede reutilizar la ruta autenticada y `getCanvasProjectService` antes de cargar el snapshot persistido. S3 puede sustituir la region principal de `CanvasShell` por React Flow sin modificar deep links, autenticacion, politica de acceso ni estados de ruta.
