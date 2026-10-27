# Análisis OWASP Top 10:2025 - Muro Colaborativo

**Sistema analizado:** Muro Colaborativo DZ  
**Arquitectura:** frontend JavaScript desplegado en Netlify, Supabase Auth/Postgres/Realtime y modo alternativo Express + Socket.IO.  
**Fecha:** 26 de octubre de 2026  
**Alcance:** código, migraciones SQL, configuración de Netlify/Supabase y dependencias npm de esta copia del proyecto.

## Resumen ejecutivo

Los diez riesgos aplican al sistema, aunque A04, A05 y A08 ya cuentan con controles sólidos. Los riesgos de mayor prioridad son A01, A03, A06, A07, A09 y A10 porque el sistema maneja sesiones, roles por muro, contenido compartido y operaciones en tiempo real.

Durante este trabajo se corrigieron y comprobaron cinco frentes que pueden mostrarse para los puntos adicionales:

1. **A01:** el rol global `superadmin` dejó de otorgar acceso implícito al contenido de todos los muros en el modo Express.
2. **A02:** se añadieron cabeceras defensivas en Express y HSTS en Netlify.
3. **A03:** se actualizaron cinco paquetes; `npm audit` pasó de 5 avisos totales a **0 vulnerabilidades**.
4. **A07:** se endureció la configuración de Auth: 10 caracteres, complejidad, confirmación de correo, cambio seguro de contraseña, OTP de 8 dígitos por 10 minutos y menor límite de intentos.
5. **A10:** la sala y su membresía propietaria ahora se crean en una sola RPC transaccional; la inserción directa de salas está revocada y el cliente solo muestra errores normalizados.

Quedan como trabajo prioritario A06 (cuotas antiabuso) y A09 (auditoría persistente).

## Matriz de riesgos

| Riesgo | ¿Aplica? | Dónde | Cómo podría explotarse | Solución definida | Estado | Prioridad | Responsable |
|---|---|---|---|---|---|---|---|
| **A01 Control de acceso roto** | Sí | `server.js`; RLS de `muro_salas`, `muro_sala_miembros`, `muro_notas` y `muro_reportes` | Cambiar/adivinar el UUID de un muro o nota para leer, editar o borrar contenido ajeno; enviar `role: superadmin` desde DevTools | Derivar la identidad de la sesión; comprobar membresía por muro; mantener RLS con `auth.uid()`; no confiar en roles enviados por el cliente; prueba IDOR automatizada | **Corregido y probado** | Alta | Backend / BD |
| **A02 Configuración de seguridad incorrecta** | Sí | `netlify.toml`, `server.js`, `.env`, `supabase/config.toml` | Clickjacking, carga de scripts no autorizados, MIME sniffing, filtración de secretos o configuración de desarrollo en producción | CSP, `frame-ancestors`, `nosniff`, COOP/CORP, Permissions Policy, Referrer Policy y HSTS; publicar solo URL y clave publicable; secretos únicamente en servidor | **Corregido; verificar en despliegue** | Media | DevOps |
| **A03 Cadena de suministro** | Sí | `package.json`, `package-lock.json`, dependencias npm | Una dependencia vulnerable permite denegación de servicio; antes del ajuste `engine.io` tenía un aviso alto y había avisos en `qs`/Express | Mantener lockfile, ejecutar `npm audit` en cada entrega, revisar nombres/propietarios de paquetes y activar Dependabot | **Corregido: 0 avisos** | Alta | Equipo / DevOps |
| **A04 Fallas criptográficas** | Sí | Supabase Auth, variables de entorno, transporte Netlify/Supabase | Robo de sesión por HTTP, secreto privado en el navegador o contraseñas manejadas por código propio | Supabase Auth administra hash y tokens; HTTPS + HSTS; solo clave publicable en frontend; nunca registrar ni versionar secretos; bloquear el modo memoria en producción | Mitigado; queda validar el modo de producción | Alta | Backend / DevOps |
| **A05 Inyección** | Sí | Notas, nombres, perfiles y filtros enviados desde `public/app.js` y `public/netlify-socket.js` | Una nota con `<img onerror=...>` intenta XSS; SQL malicioso en texto o correo | La UI usa `textContent`/`textarea`; el SDK de Supabase separa datos de consultas; restricciones SQL validan longitud, color y rol; evitar `innerHTML` y SQL dinámico | Mitigado y revisado | Media | Frontend / BD |
| **A06 Diseño inseguro** | Sí | Creación de notas, invitaciones, reportes y recuperación de acceso | Una cuenta automatizada crea miles de notas/reportes o envía invitaciones repetidas, agotando recursos | Cuota por usuario y muro, límite por minuto, límites de tamaño, CAPTCHA para registro y pruebas de casos de abuso | **Pendiente** | Alta | Backend / BD |
| **A07 Fallas de autenticación** | Sí | Supabase Auth y `supabase/config.toml` | Fuerza bruta, cuentas con claves débiles, OTP reutilizable o cambio de contraseña sin reautenticación | Mensaje genérico, 10 intentos de login/registro cada 5 minutos, contraseña robusta, correo confirmado, reautenticación para cambiar clave y OTP breve; habilitar CAPTCHA en producción | **Configuración corregida; aplicar en Supabase remoto** | Alta | Backend / DevOps |
| **A08 Integridad de software o datos** | Sí | Sesiones Supabase, `package-lock.json`, scripts locales servidos desde `/vendor` | Token alterado, paquete modificado o script externo sustituido | Supabase verifica la firma y expiración del JWT; no se usa `decode()` como autorización; scripts propios/locales bajo CSP; lockfile versionado y build reproducible | Mitigado | Media | Backend / DevOps |
| **A09 Registro y alertas** | Sí | Borrado de notas/muros, cambios de miembros y decisiones sobre reportes | Un usuario autorizado borra o cambia contenido y no queda evidencia persistente de quién, cuándo y desde dónde | Crear `muro_auditoria` de solo inserción mediante triggers/RPC; registrar actor, acción, recurso, fecha y resultado sin tokens ni contenido sensible; alertar por volumen anormal | **Pendiente** | Alta | BD / DevOps |
| **A10 Condiciones excepcionales** | Sí | RPC `muro_crear_sala`; `wall:create` en `public/netlify-socket.js` y `server.js`; manejo de errores del cliente | Antes se podía crear `muro_salas` y fallar al insertar al propietario, dejando un muro huérfano; además se podía filtrar un error interno de BD | RPC transaccional para sala + membresía; propietario derivado de `auth.uid()`; `INSERT` directo revocado; errores públicos genéricos; pruebas de contrato y backend | **Corregido y probado** | Alta | Boris / Backend / BD |

## Evidencia de revisión en el código

- Las tablas expuestas tienen RLS y políticas de lectura/escritura por `auth.uid()` y rol del muro en `supabase/migrations/20260805022759_secure_wall_privacy_and_realtime.sql`.
- Las funciones `SECURITY DEFINER` fijan `search_path = ''`, califican las tablas con `public.` y revocan ejecución a `public`/`anon`.
- El navegador recibe únicamente `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; la prueba correspondiente está en `test/supabase-config.test.js`.
- La interfaz coloca texto del usuario con `textContent` o en un `textarea`, no con `innerHTML`, en `public/app.js`.
- Netlify aplica CSP y otras cabeceras desde `netlify.toml`; Express replica esos controles desde `server.js`.
- El lockfile está presente y, después de la actualización, `npm audit` informa 0 vulnerabilidades.
- `supabase/migrations/20261027000508_corregir_a10_creacion_atomica_muro.sql` crea `muro_crear_sala`, valida `auth.uid()`, inserta la sala y la membresía en la misma transacción, restringe `EXECUTE` a `authenticated` y revoca el `INSERT` directo sobre `muro_salas`.
- `public/netlify-socket.js` y `lib/supabase-store.js` llaman `rpc('muro_crear_sala', ...)`; `server.js` ya no ejecuta dos escrituras ni una compensación manual.
- `test/a10-atomic-wall.test.js` comprueba el contrato de la migración, el uso de RPC y que los detalles internos no lleguen al error público.

## Corrección probada: A10 y creación atómica

**Escenario anterior:** `wall:create` insertaba primero en `muro_salas` y después en `muro_sala_miembros`. Si la segunda escritura fallaba, quedaba una sala sin membresía propietaria. El backend Express intentaba borrarla como compensación, pero esa tercera operación también podía fallar.

**Control aplicado:** `muro_crear_sala(nombre_nuevo, descripcion_nueva)` deriva la identidad con `auth.uid()` y realiza ambas inserciones dentro de una sola función PostgreSQL. Una excepción cancela toda la llamada. Al revocar `INSERT` de `authenticated` sobre `muro_salas`, los clientes no pueden volver al flujo inseguro de dos pasos.

**Manejo público:** los códigos conocidos se traducen a mensajes breves y los fallos inesperados devuelven “No se pudo completar la operación”. La interfaz nunca concatena `details`, `hint`, consultas ni restricciones de Postgres.

**Comando reproducible:**

```powershell
node --test test/a10-atomic-wall.test.js test/supabase-config.test.js
```

## Ataque probado: IDOR contra un muro privado

**Objetivo:** comprobar si una cuenta que conoce el UUID de un muro ajeno puede acceder a él.

**Preparación:** una usuaria crea el muro privado “Privado de Brenda”. La cuenta atacante tiene sesión válida y rol global `superadmin`, pero no pertenece a ese muro.

**Intentos realizados con el UUID real del recurso:**

1. `wall:select` para leerlo.
2. `wall:update` para cambiar su nombre a “Tomado”.
3. `wall:delete` para borrarlo.

**Resultado esperado y obtenido:** los tres intentos devuelven `ok: false`; el nombre permanece intacto. La prueba está en `test/server.test.js` con el nombre `bloquea un IDOR aunque el atacante tenga rol global de superadmin`.

**Comando reproducible:**

```powershell
node --test --test-name-pattern "IDOR" test/server.test.js
```

**Conclusión:** ocultar botones no interviene en la defensa. El control efectivo está en el servidor/RLS y comprueba la membresía sobre el recurso solicitado.

## Guion para la exposición (máximo 5 minutos)

### 0:00-0:40 - Sistema y superficie de ataque

“Nuestro sistema es un muro colaborativo con autenticación, roles propietario/editor/lector, notas en tiempo real y un panel administrativo. El navegador se conecta a Supabase y existe un modo Express alternativo. Revisamos frontend, backend, RLS, configuración y dependencias.”

### 0:40-1:20 - Resultado general

“Los diez riesgos pueden afectar al sistema. Ya tenemos controles fuertes en criptografía, inyección e integridad, pero priorizamos acceso, dependencias, abuso, autenticación, auditoría y fallos parciales. Corregimos también A10 y dejamos dos mejoras prioritarias.”

### 1:20-2:25 - A01 y demostración IDOR

“El mayor riesgo era confiar en un rol global para acceder al contenido privado. Creamos dos cuentas y un muro privado; la atacante usó el UUID real e intentó leer, editar y borrar. Los tres intentos fueron rechazados. Corregimos `wallRole` para que solo la membresía del muro otorgue acceso. La misma idea está en RLS: el token identifica a la persona y la política compara `auth.uid()`.”

### 2:25-3:20 - A03 y A07

“En cadena de suministro, `npm audit` encontró cinco avisos, incluido uno alto en Engine.IO. Actualizamos cinco paquetes y ahora hay cero vulnerabilidades reportadas. En autenticación elevamos la contraseña a diez caracteres con complejidad, redujimos intentos, activamos confirmación de correo y reautenticación para cambiar la clave, y acortamos la vigencia del OTP.”

### 3:20-4:20 - A10 y riesgos pendientes

“En A10 reemplacé dos escrituras independientes por una RPC de PostgreSQL: si falla la sala o su propietario, todo se revierte. También cerré la inserción directa y normalicé los errores de la interfaz. A06 todavía requiere cuotas para evitar miles de notas o reportes y A09 necesita una tabla de auditoría para atribuir borrados y cambios de permisos.”

### 4:20-5:00 - Cierre

“La lección principal es que login no equivale a autorización. La seguridad está en varias capas: Supabase Auth identifica, RLS autoriza cada fila, la transacción evita estados parciales, el servidor valida el recurso, CSP limita el navegador y las pruebas reproducen el abuso. Nuestros siguientes cambios serán cuotas y auditoría.”

## Respuestas breves para posibles preguntas

**¿Autenticación y autorización son lo mismo?** No. Autenticación confirma quién soy; autorización decide si esa identidad puede actuar sobre este muro concreto.

**¿Por qué no basta ocultar el botón?** Porque DevTools, una llamada REST o un cliente propio pueden enviar la misma operación. El servidor y RLS deben negarla.

**¿La clave publicable de Supabase es un secreto?** No; está diseñada para el navegador. La protección real es el token del usuario, los privilegios SQL y RLS. La clave secreta/service role nunca debe llegar al cliente.

**¿Cómo evitan XSS en las notas?** El contenido se coloca como texto mediante `textContent`/`textarea`; no se interpreta como HTML. CSP añade una segunda capa.

**¿Qué demuestra `npm audit`?** Detecta vulnerabilidades conocidas en el árbol instalado; no garantiza que no existan fallas desconocidas ni reemplaza la revisión del código.

**¿Qué harían primero de lo pendiente?** A09 para tener trazabilidad persistente y A06 para controlar abuso por volumen. A10 ya quedó resuelto mediante la RPC transaccional.

## Plan de commits para los puntos adicionales

La carpeta `.git` de esta copia está vacía, por lo que aquí no se pudieron crear commits conservando el historial original. Después de recuperar o volver a clonar el repositorio, separar los cambios así:

```text
fix(A01): exigir membresía del muro y probar intento IDOR
fix(A02): aplicar cabeceras de seguridad en Express y Netlify
fix(A03): actualizar dependencias vulnerables y dejar audit en cero
fix(A07): endurecer contraseñas OTP y límites de autenticación
fix(A10): crear sala y propietario mediante RPC transaccional
docs(security): agregar matriz OWASP y guion de exposición
```

No conviene hacer un solo commit: en la exposición debe poder mostrarse qué riesgo resolvió cada cambio.

## Verificación ejecutada

```text
npm test       -> 16/16 pruebas aprobadas en la copia completa
npm test       -> 11/11 pruebas aprobadas en la rama de despliegue
npm audit      -> 0 vulnerabilidades
npm run check  -> debe ejecutarse antes de publicar o entregar
npm run verify:supabase -- --auth
               -> conexión pública, Auth, RPC A10, RLS y backend aprobados
supabase db lint --linked --schema public
               -> sin errores de esquema
```

La migración `20261027000508_corregir_a10_creacion_atomica_muro.sql` figura aplicada en el historial remoto. El asesor de seguridad mantiene una advertencia esperada por las funciones `SECURITY DEFINER` invocables por cuentas autenticadas. En `muro_crear_sala` esa exposición es intencional: comprueba `auth.uid()`, no recibe un propietario desde el cliente, limita los campos modificados, fija `search_path = ''` y niega ejecución a `public` y `anon`.

## Fuentes

- Lectura “OWASP Top 10:2025 - Semana 13”, Ing. Julio Vásconez.
- OWASP Top 10:2025 y OWASP Cheat Sheet Series.
- Documentación oficial de Supabase: Row Level Security y configuración segura de productos.

