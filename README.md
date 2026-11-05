# Muro colaborativo DZ

Aplicación de notas adhesivas con el lenguaje visual original de Muro DZ y una arquitectura ampliada: cuentas, perfiles, varios muros, permisos, administración y sincronización en tiempo real con Socket.io.

## Funciones

- Registro, inicio y restauración de sesión mediante Supabase Auth cuando el esquema está disponible.
- Sesión persistente al recargar, configuración de perfil y apariencia (sistema, claro u oscuro), y cambio de correo o contraseña con verificación de la clave actual.
- Recuperación y cambio de contraseña.
- Rol `superadmin` reservado a la cuenta propietaria y validado siempre en el backend.
- Muros independientes con permisos `propietario`, `editor` y `lector`.
- Creación atómica de cada muro y su membresía propietaria mediante la RPC transaccional `muro_crear_sala`.
- Un código activo por sala, reutilizable por varias cuentas: solo se guarda SHA-256, vence en 24 horas y cada usuario obtiene su propia membresía al unirse.
- Códigos de invitación alfanuméricos de 8 caracteres, vista previa de la sala y alta de membresía únicamente al usarlos.
- Reportes privados dirigidos a una cuenta que comparte el muro, con historial para advertencias, suspensiones, reactivación o eliminación.
- Notas sincronizadas, arrastrables, con tamaño automático según el contenido y movimiento remoto fluido sin guardar cada fotograma.
- Perfil, avatar y preferencias de apariencia.
- Panel superadmin centrado en ayuda, usuarios y reportes; no abre muros ni notas privadas.
- Diseño animado y amable: mascota circular, fondos pastel, cintas, botones redondeados y post-its adaptables.
- Lienzo lógico compartido de `1800 × 1200`: en móvil se puede alejar, acercar y recorrer las mismas coordenadas que en PC.

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

Las migraciones versionadas están en `supabase/migrations/`. Crean y actualizan las tablas `muro_usuarios`, `muro_configuraciones_usuario`, `muro_salas`, `muro_sala_miembros`, `muro_notas`, `muro_invitaciones`, `muro_reportes` y `muro_sanciones`, junto con índices, funciones y políticas RLS. La migración `20261027000508_corregir_a10_creacion_atomica_muro.sql` añade la RPC transaccional de muros. `20261027002032_completar_invitaciones_y_reportes.sql` termina los flujos que habían quedado incompletos, `20261027002607_bloquear_altas_directas_de_miembros.sql` cierra el atajo que permitía crear membresías sin aceptar una invitación, `20261105040901_reportes_por_usuario_y_sanciones.sql` relaciona cada denuncia con la cuenta reportada y conserva el historial de moderación, y `20261105045727_sincronizar_cambio_correo_usuario.sql` mantiene el correo público alineado con Auth después de confirmarlo. El prefijo `muro_` evita colisiones con otros esquemas.

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
- Los tokens y códigos de invitación nunca se guardan en texto claro; la base compara su hash, bloquea códigos vencidos y evita que una misma cuenta se una dos veces. El código se genera desde la interfaz, no requiere indicar un correo y puede incorporar a varias personas.
- Los reportes toman el autor desde `auth.uid()`, solo permiten denunciar a alguien que comparte el muro y el listado administrativo no incluye contenido de notas privadas.
- Las sanciones se ejecutan exclusivamente en el servidor; la clave administrativa de Supabase nunca llega al navegador.

## Verificación

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run check
npm run verify:supabase -- --auth
```

`verify:supabase` comprueba conexión pública, Auth, backend administrativo, RLS, unión de varias cuentas mediante el mismo código y el recorrido completo de reportes. Las cuentas temporales se eliminan al terminar. `test/a10-atomic-wall.test.js` y `test/invitations-reports-contract.test.js` revisan los contratos de seguridad y que no existan altas directas.

## Aporte de esta entrega

Responsable de la corrección y cierre del backend: **Boris Salda Vargas**. Boris completó las invitaciones verificables, la atención de reportes, el historial de sanciones, el lienzo adaptable y la sincronización fluida; también cerró las altas directas de miembros, aplicó las migraciones y añadió las pruebas. En la interfaz corrigió la persistencia de sesión, la configuración de cuenta, los temas, el modal de invitación, la revisión de usuarios y la presentación cartoon basada en Figma. La propuesta visual de Pierina se integró y se ajustaron los problemas de presentación, modales, tamaños de notas y adaptación móvil tanto en la aplicación principal como en la carpeta `Backend/`.

## Respaldo en memoria

Si faltan variables o la migración todavía no existe en el proyecto remoto, el servidor conserva todas las funciones en memoria y muestra `migration_required` en `/api/health`. Ese modo evita que localhost quede inutilizable durante la configuración, pero sus datos se pierden al reiniciar Node.js.

## Estructura principal

```text
lib/                     Clientes y almacenamiento de Supabase
public/                  Interfaz, estilos y cliente público
Frontend/                Interfaz visual integrada de Pierina que publica Render
scripts/                 Build y verificación de conexión
supabase/migrations/     Esquema y políticas RLS
test/                    Pruebas de integración Socket.io
server.js                Backend Express y Socket.io
```

Las carpetas `Frontend/`, `Backend/` y `BaseDeDatos/` conservan la misma entrega organizada por áreas para la revisión académica. La raíz sigue siendo la fuente que publica Render; antes de entregar se verifican ambas rutas para que la corrección A10 no exista solamente en una copia.

## Monitor de disponibilidad

`.github/workflows/supabase-uptime.yml` consulta cada seis horas `/api/health`. Esa ruta realiza una consulta real a PostgreSQL mediante Supabase, no solo una comprobación del proceso de Render. Si Render o la base no responden, el workflow falla y GitHub registra la alerta; también puede ejecutarse manualmente desde Actions. El workflow queda activo en la rama predeterminada del repositorio.

Render tiene `Auto-Deploy: On Commit` y `render.yaml` conserva `autoDeploy: true`. El servicio sigue `agent/completar-muro-colaborativo`: cuando el frontend de Pierina se integra en esa rama mediante PR, Render lo publica sin despliegue manual y mantiene las conexiones del backend.

Como respaldo del webhook nativo, `.github/workflows/render-frontend-auto-deploy.yml` escucha únicamente cambios en `Frontend/**` sobre esa rama y solicita el despliegue mediante el secreto `RENDER_DEPLOY_HOOK_URL`. Así una actualización visual integrada no requiere abrir el panel de Render.
