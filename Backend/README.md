# Backend del Muro Colaborativo

Este backend reemplaza la demostración que guardaba todo en memoria. Mantiene un modo local para pruebas, pero cuando las variables de Supabase están configuradas utiliza Auth, políticas RLS y las tablas del proyecto. Boris completó esta área después de integrar el trabajo visual de Pierina para que la misma implementación exista en la raíz y en `Backend/`.

## Funciones implementadas

- Registro, inicio, restauración y cierre de sesión.
- Recuperación y cambio de contraseña con verificación de la clave actual.
- Nombre de usuario único, cambio seguro de correo y contraseña, y preferencias de apariencia persistentes.
- Creación, edición, color, selección y eliminación sincronizada de muros; editar o eliminar queda reservado al propietario/a.
- Gestión de integrantes y permisos: propietario, editor y lector.
- Creación, edición, movimiento fluido y eliminación de notas en tiempo real sobre un lienzo común para PC y móvil.
- Panel protegido de ayuda y moderación: usuarios, reportes y medidas sobre cuentas.
- Privacidad de muros: ser superadministrador no concede acceso automático a muros ajenos.
- Persistencia en Supabase con modo en memoria para pruebas locales.
- Creación atómica de sala y membresía propietaria mediante la RPC `muro_crear_sala`.
- Un código activo por sala, alfanumérico, con hash SHA-256 y vencimiento; varias cuentas pueden usarlo para unirse.
- Alta de miembros únicamente después de usar un código válido de 8 caracteres; no se solicita correo del invitado.
- Reportes privados asociados a la cuenta reportada, recepción del superadmin, historial y medidas de advertencia, suspensión, reactivación o eliminación.

## Ejecutar

```bash
npm ci
npm start
npm run check
```

El servidor utiliza el frontend ubicado en `../Frontend`.

Para activar Supabase, copia `.env.example` como `.env` y completa las variables en tu entorno local. Nunca subas el archivo `.env` ni claves privadas.

## Cierre de invitaciones y reportes

La persona propietaria genera el código desde la interfaz y decide el rol. Quien quiera unirse escribe el código en la pestaña **Unirse**; la vista previa muestra el muro y quién generó la invitación. Un código inexistente, vencido o ya utilizado responde `Sala no encontrada` y no crea membresías.

Responsable de implementación y corrección: **Boris Salda Vargas**.

La entrega anterior había dejado estos dos módulos como pendientes. Boris terminó el contrato del backend y su interfaz: la persona propietaria genera el código, Supabase conserva únicamente el hash y cada cuenta que lo utiliza recibe su propia membresía. Al generar uno nuevo se cancela el anterior; también se controlan vencimiento, duplicados y permisos.

En reportes, el autor sale siempre de la sesión y la cuenta denunciada debe compartir el mismo muro. Cada persona ve únicamente sus solicitudes; el superadmin recibe, toma y responde sin obtener por ello acceso al contenido de muros privados. Desde el directorio puede revisar el historial y aplicar una medida proporcionada. Las pruebas cubren el recorrido correcto y los intentos no autorizados.

La propuesta visual de Pierina se conectó a estos eventos y Boris corrigió los problemas de presentación, modales, notas, responsividad y movimiento compartido. La misma versión se publica desde la raíz y queda reflejada en `Backend/`, `Frontend/` y `BaseDeDatos/` para la revisión por áreas.

La configuración separa usuario, correo, contraseña y apariencia para que un fallo no bloquee las demás opciones. El tema del sistema, claro u oscuro se aplica y persiste al elegirlo; también se puede usar notas compactas y decidir si se confirma antes de eliminar. Cuando Supabase confirma un nuevo correo, el trigger versionado mantiene el perfil público sincronizado.
