# S9 - Aceptacion y demo del canvas colaborativo

**Fecha:** 2026-08-09
**Estado:** Aprobada para planificacion
**Dependencias:** S0-S8 implementadas, PostgreSQL de pruebas aislado y credenciales funcionales de Portal

## 1. Objetivo

Cerrar el canvas colaborativo como una compuerta de release. S9 completa la
cobertura automatizada del flujo permanente, ejecuta las verificaciones de
calidad y demuestra el PRD con dos sesiones autenticadas sobre un mismo
proyecto. No introduce nuevas capacidades de producto.

## 2. Resultado observable

- Dos controllers colaboran mediante los mismos puertos de acciones,
  persistencia y realtime que usa la aplicacion.
- Crear, editar, mover, redimensionar y eliminar recorren el pipeline local,
  persistente y remoto, y un reload reconstruye el estado final.
- La integracion PostgreSQL verifica el ciclo permanente y la regla LWW contra
  una base de pruebas aislada.
- Las compuertas propias del canvas pasan antes de iniciar la demostracion.
- Dos usuarios autenticados completan el recorrido colaborativo del PRD en
  navegadores independientes.
- Los defectos que bloqueen un criterio P0 o una compuerta Canvas se corrigen en
  S9; los hallazgos no bloqueantes se reportan sin ampliar el alcance.

## 3. Alcance y limites

Incluye:

- matriz de criterios del PRD frente a cobertura automatizada y manual;
- test de aceptacion del controller con adapters en memoria;
- ampliacion del test de integracion PostgreSQL existente;
- ejecucion de tests, typecheck, build y Biome enfocado en Canvas;
- demostracion manual real con dos sesiones autenticadas;
- correccion de defectos bloqueantes descubiertos durante la aceptacion.

No incluye:

- Playwright u otra infraestructura E2E;
- nuevas features, contratos o cambios de arquitectura;
- capturas, videos o documentos permanentes con evidencia de la ejecucion;
- refactors o pulido que no sean necesarios para cumplir un criterio P0;
- cambios en `apps/meet-agent/`;
- uso de una base de produccion para tests.

## 4. Cobertura automatizada

### 4.1 Aceptacion del controller

Un test de aceptacion crea dos instancias reales de `createCanvasActions`. Los
adapters en memoria representan persistencia y Portal, pero no duplican las
reglas del controller. El flujo bajo prueba es:

```text
accion en A -> persistencia -> respuesta autoritativa -> evento final -> aplicacion en B
```

El escenario cubre:

- creacion programatica;
- edicion de contenido;
- movimiento;
- resize;
- eliminacion;
- reconstruccion de un tercer controller desde el snapshot persistido;
- ausencia de cursor, seleccion, viewport y previews en el snapshot permanente.

Cada final se publica solo despues de una respuesta `applied: true`. El test no
reimplementa Portal, PostgreSQL, LWW ni el reducer; conecta los puertos reales
del controller con fakes observables y entrega los mensajes publicados al otro
controller.

### 4.2 Integracion PostgreSQL

El test existente de `applyCanvasCommand` se amplia para ejecutar create,
update, move, resize y delete sobre PostgreSQL. Tambien verifica:

- rechazo de una operacion stale;
- snapshot activo antes del delete;
- tombstone despues del delete;
- imposibilidad de resurreccion por una operacion anterior.

La prueba requiere `CANVAS_TEST_DATABASE_URL`. Esta variable debe apuntar a una
base aislada de pruebas, puede usar el mismo servidor PostgreSQL que desarrollo,
pero nunca la misma base de la aplicacion ni produccion. La aplicacion desplegada
no necesita esta variable. Si no existe, Vitest omite la integracion; S9 no puede
cerrarse mientras siga omitida en la ejecucion de aceptacion.

### 4.3 Cobertura reutilizada

S9 conserva y reutiliza la cobertura existente de:

- schemas de elementos, comandos, snapshots y mensajes Portal;
- reconciliacion, LWW, tombstones, dedupe y self-echo;
- throttle y debounce de previews y awareness;
- buffer previo al snapshot, outbox, retry y cleanup;
- presencia, cursores, seleccion remota y estados de conexion;
- contratos de servicios, rutas autenticadas y UI.

No se agregan pruebas duplicadas. Solo se escribe un test nuevo cuando la matriz
muestre que un criterio observable no esta cubierto por el escenario de
aceptacion ni por una prueba existente.

## 5. Compuertas de calidad

Antes de la demo deben pasar:

```text
pnpm test
pnpm test:canvas:integration
pnpm typecheck
pnpm build
pnpm exec biome check src/core/canvas
```

`pnpm test:canvas:integration` se ejecuta con `CANVAS_TEST_DATABASE_URL`
disponible y debe reportar la prueba ejecutada, no omitida.

El `pnpm check` global tambien se ejecuta para conocer el estado del repositorio.
Actualmente falla por formato preexistente en `apps/meet-agent/`. Ese fallo se
reporta como deuda fuera de S9 y no autoriza cambios en dicho modulo. Cualquier
diagnostico nuevo dentro de Canvas si bloquea el cierre.

## 6. Demostracion manual

La demo usa dos navegadores o perfiles independientes, dos cuentas autenticadas
y la misma URL `/projects/{projectId}/canvas`.

1. Ambos usuarios abren el canvas y aparecen en presencia.
2. Cada usuario ve el cursor del otro en la posicion correcta pese a tener un
   viewport local distinto.
3. A crea una sticky y B la recibe sin refresh.
4. B mueve la sticky; A ve preview y posicion final.
5. A edita el texto y B recibe el cambio final.
6. B selecciona y redimensiona; A ve seleccion y resize.
7. A elimina el elemento y desaparece en ambas sesiones.
8. Ambos recargan y reciben el ultimo snapshot persistido.
9. Una sesion se desconecta, mantiene interaccion local, muestra estado no live,
   reconecta y sincroniza sus finales pendientes.
10. Se invoca `createElement` programaticamente y el elemento aparece localmente,
    en la otra sesion y despues de reload.

La ejecucion no agrega capturas ni un reporte versionado. El cierre de la tarea
informa los pasos completados y cualquier desviacion observada.

## 7. Manejo de fallos

- Un criterio P0 fallido bloquea S9 y se corrige antes de repetir la demo.
- Un fallo en tests Canvas, integracion PostgreSQL, typecheck o build bloquea S9.
- Un fallo de credenciales, red o servicio externo se diagnostica y se informa;
  nunca se convierte en una aceptacion simulada.
- Una respuesta `applied: false` esperada no es un error si instala el ganador
  autoritativo y evita publicar el final rechazado.
- Los defectos no bloqueantes se reportan sin incorporar nuevas features o
  refactors a S9.
- S9 no modifica archivos de `apps/meet-agent/` para hacer pasar el check global.

## 8. Criterios de aceptacion

### AC-01 Pipeline permanente completo

Given dos controllers conectados por adapters observables
When A crea, edita, mueve, redimensiona y elimina un elemento
Then cada operacion se persiste antes de publicarse, B aplica el final y ambos
convergen al mismo snapshot.

### AC-02 Reload determinista

Given el flujo permanente termino
When un controller nuevo se construye desde el snapshot persistido
Then reconstruye los elementos y tombstones finales sin estado efimero.

### AC-03 Persistencia real

Given una base PostgreSQL de pruebas aislada y migrada
When se ejecuta el ciclo completo de comandos
Then update, move y resize quedan en el snapshot, delete deja tombstone y una
operacion stale no sobrescribe ni resucita el estado mas nuevo.

### AC-04 Compuertas

Given el candidato S9
When se ejecutan las verificaciones de calidad
Then tests, integracion Canvas, typecheck, build y Biome de Canvas pasan sin tests
omitidos en la integracion.

### AC-05 Colaboracion real

Given dos usuarios autenticados en el mismo canvas
When completan los diez pasos de la demo
Then presencia, awareness, operaciones, reload, reconexion y creacion
programatica funcionan sin refresh adicional ni divergencia permanente.

### AC-06 Aislamiento

Given un hallazgo fuera de Canvas o una mejora no bloqueante
When se evalua durante S9
Then se reporta sin modificar `apps/meet-agent/` ni ampliar el producto.

## 9. Definicion de terminado

- La matriz PRD no contiene criterios P0 sin cobertura automatizada o manual.
- El test de aceptacion del controller cubre el pipeline completo entre dos
  clientes y reload.
- La integracion PostgreSQL se ejecuta, no se omite, y pasa contra una base
  aislada.
- Las compuertas propias de Canvas, typecheck y build pasan.
- El estado del check global queda informado sin cambios fuera de alcance.
- La demo de diez pasos termina con dos sesiones reales.
- No quedan defectos bloqueantes conocidos.
- No se agrega Playwright, evidencia binaria ni cambios en `apps/meet-agent/`.
