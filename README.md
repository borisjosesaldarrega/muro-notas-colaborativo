# Muro colaborativo DZ

Aplicación de notas adhesivas con el lenguaje visual original de Muro DZ y una arquitectura ampliada: cuentas, perfiles, varios muros, permisos, administración y sincronización en tiempo real con Socket.io.

## Funciones

- Registro, inicio y restauración de sesión mediante Supabase Auth cuando el esquema está disponible.
- Recuperación y cambio de contraseña.
- Rol `superadmin` reservado a la cuenta propietaria y validado siempre en el backend.
- Muros independientes con permisos `propietario`, `editor` y `lector`.
- Creación atómica de cada muro y su membresía propietaria mediante la RPC transaccional `muro_crear_sala`.
- Invitaciones mediante enlace y código de un solo uso: solo se guarda SHA-256, vencen en 24 horas y la membresía se crea al aceptar.
- Consulta, rechazo, reenvío y cancelación de invitaciones sin permitir altas directas de miembros.
- Reportes privados con estados `pendiente`, `en_revision`, `resuelto` y `rechazado`, atención del superadmin y respuesta exclusiva al autor.
- Notas sincronizadas, arrastrables y disponibles en cinco colores.
- Perfil, avatar y preferencias de apariencia.
- Panel superadmin para usuarios, muros, miembros y limpieza de contenido.
- Diseño original: papel crema con puntos, morado `#6658f5`, bordes azul tinta, cintas y post-its pastel.

## Requisitos

- Node.js 20 o superior.
- npm.
- Proyecto de Supabase para persistencia remota.

## Variables de entorno

Copia `.env.example` como `.env` y completa los valores. Nunca subas `.env` al repositorio.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_PROJECT_REF=
SUPABASE_DB_PASSWORD=
SUPABASE_ACCESS_TOKEN=
DATABASE_URL=
```

Solo `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` se entregan al navegador mediante `/api/supabase/config`. `SUPABASE_SECRET_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN` y `DATABASE_URL` son exclusivamente de servidor o CLI.

## Instalar y ejecutar

```bash
npm install
npm start
```

Abre [http://localhost:3000](http://localhost:3000). El endpoint [http://localhost:3000/api/health](http://localhost:3000/api/health) indica si se está usando `supabase` o el respaldo temporal `memory`.

## Publicar en Render

El archivo `render.yaml` prepara un Web Service gratuito con `npm ci`, `npm start` y la comprobación `/api/health`. En Render, crea un Blueprint desde el repositorio y completa las variables que solicite:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (secreto; solo para el backend)

Render asignará la URL al completar el primer despliegue. Abre esa URL para probar la aplicación y añade también la URL a las Redirect URLs permitidas en la configuración de autenticación de Supabase. Después, configura `APP_URL` en Render con esa URL para los enlaces de recuperación de contraseña. No uses `localhost` como `APP_URL` en producción. No es necesario configurar `JWT_SECRET`, `FRONT_URL` ni `DATABASE_URL` para ejecutar este servicio.

## Preparar Supabase

Las migraciones versionadas están en `supabase/migrations/`. Crean y actualizan las tablas `muro_usuarios`, `muro_configuraciones_usuario`, `muro_salas`, `muro_sala_miembros`, `muro_notas`, `muro_invitaciones` y `muro_reportes`, junto con índices, funciones y políticas RLS. La migración `20261027000508_corregir_a10_creacion_atomica_muro.sql` añade la RPC transaccional de muros. `20261027002032_completar_invitaciones_y_reportes.sql` termina los flujos que habían quedado incompletos y `20261027002607_bloquear_altas_directas_de_miembros.sql` cierra el atajo que permitía crear membresías sin aceptar una invitación. El prefijo `muro_` evita colisiones con otros esquemas.

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

El CLI requiere `SUPABASE_ACCESS_TOKEN` para autenticarse y `SUPABASE_DB_PASSWORD` para enlazar/aplicar migraciones. Como alternativa, `DATABASE_URL` puede usarse con `npx supabase db push --db-url "$DATABASE_URL"`.

Después de aplicar la migración, reinicia Node.js. El servidor cargará los datos remotos y cambiará automáticamente de `memory` a `supabase`.

## Seguridad y RLS

- Perfil y configuración: cada persona modifica únicamente sus propios datos.
- Muros y miembros: solo integrantes pueden leer; propietarios administran el espacio.
- Notas: integrantes pueden leer y solo propietarios/editores pueden escribir.
- Roles globales y operaciones administrativas usan el cliente secreto exclusivamente en el backend.
- Las operaciones normales usan una sesión de usuario con clave publicable, por lo que pasan por RLS.
- El rol no se obtiene de `user_metadata`; se guarda en `muro_usuarios` y el servidor lo verifica.
- La creación de una sala no admite un propietario enviado por el navegador: la RPC toma `auth.uid()`, inserta sala y membresía en la misma transacción y revierte ambas si algo falla.
- Los errores enviados a la interfaz se normalizan; los mensajes internos de Postgres/PostgREST no se muestran a las personas usuarias.
- Los tokens y códigos de invitación nunca se guardan en texto claro; la base compara su hash y bloquea vencimiento, reutilización, destinatario incorrecto y duplicados.
- Los reportes toman el autor desde `auth.uid()` y el listado administrativo no incluye nombres de muros ni contenido de notas privadas.

## Verificación

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run check
npm run verify:supabase -- --auth
```

`verify:supabase` comprueba conexión pública, Auth, backend administrativo, RLS, invitación de un solo uso y el recorrido completo de reportes. Las cuentas temporales se eliminan al terminar. `test/a10-atomic-wall.test.js` y `test/invitations-reports-contract.test.js` revisan los contratos de seguridad y que no existan altas directas.

## Aporte de esta entrega

Responsable de la corrección y cierre del backend: **Boris Salda Vargas**. La implementación anterior dejó pendientes las invitaciones verificables y la atención de reportes; Boris completó ambos recorridos, cerró las altas directas de miembros, aplicó las migraciones y añadió las pruebas. El trabajo visual actualizado por Pierina se conservó e integró con estas funciones tanto en la aplicación principal como en la carpeta `Backend/`.

## Respaldo en memoria

Si faltan variables o la migración todavía no existe en el proyecto remoto, el servidor conserva todas las funciones en memoria y muestra `migration_required` en `/api/health`. Ese modo evita que localhost quede inutilizable durante la configuración, pero sus datos se pierden al reiniciar Node.js.

## Estructura principal

```text
lib/                     Clientes y almacenamiento de Supabase
public/                  Interfaz, estilos y cliente público
scripts/                 Build y verificación de conexión
supabase/migrations/     Esquema y políticas RLS
test/                    Pruebas de integración Socket.io
server.js                Backend Express y Socket.io
```

Las carpetas `Frontend/`, `Backend/` y `BaseDeDatos/` conservan la misma entrega organizada por áreas para la revisión académica. La raíz sigue siendo la fuente que publica Render; antes de entregar se verifican ambas rutas para que la corrección A10 no exista solamente en una copia.
