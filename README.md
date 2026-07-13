# Muro colaborativo DZ

Aplicación de notas adhesivas con el lenguaje visual original de Muro DZ y una arquitectura ampliada: cuentas, perfiles, varios muros, permisos, administración y sincronización en tiempo real con Socket.io.

## Funciones

- Registro, inicio y restauración de sesión mediante Supabase Auth cuando el esquema está disponible.
- Recuperación y cambio de contraseña.
- Primera cuenta con rol `superadmin`, validado siempre en el backend.
- Muros independientes con permisos `propietario`, `editor` y `lector`.
- Notas sincronizadas, arrastrables y disponibles en cinco colores.
- Perfil, avatar y preferencias de apariencia.
- Panel administrativo para usuarios, roles, muros, miembros y limpieza de contenido.
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

## Preparar Supabase

La migración versionada está en `supabase/migrations/20260713200000_create_muro_schema.sql`. Crea `profiles`, `user_settings`, `walls`, `wall_members` y `notes`, junto con índices, disparadores y políticas RLS.

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
- El rol no se obtiene de `user_metadata`; se guarda en `profiles` y el servidor lo verifica.

## Verificación

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run check
npm run verify:supabase -- --auth
```

`verify:supabase` comprueba conexión pública, Auth y backend administrativo. Con la migración aplicada también comprueba una consulta autenticada bajo RLS. La cuenta temporal de verificación se elimina al terminar.

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
