# Backend del Muro Colaborativo

Este backend reemplaza la demostración que guardaba todo en memoria. Mantiene un modo local para pruebas, pero cuando las variables de Supabase están configuradas utiliza Auth, políticas RLS y las tablas del proyecto. Boris completó esta área después de integrar el trabajo visual de Pierina para que la misma implementación exista en la raíz y en `Backend/`.

## Funciones implementadas

- Registro, inicio, restauración y cierre de sesión.
- Recuperación y cambio de contraseña.
- Perfil y preferencias del usuario.
- Creación, edición, selección y eliminación de muros.
- Gestión de integrantes y permisos: propietario, editor y lector.
- Creación, edición, movimiento y eliminación de notas en tiempo real.
- Panel y operaciones protegidas para el superadministrador.
- Privacidad de muros: ser superadministrador no concede acceso automático a muros ajenos.
- Persistencia en Supabase con modo en memoria para pruebas locales.
- Creación atómica de sala y membresía propietaria mediante la RPC `muro_crear_sala`.
- Invitaciones con enlace y código de un solo uso, hash SHA-256, vencimiento, aceptación, rechazo, reenvío y cancelación.
- Alta de miembros únicamente después de aceptar una invitación válida.
- Reportes privados con bandeja del usuario, recepción del superadmin, toma, respuesta y notificación en tiempo real.

## Ejecutar

```bash
npm ci
npm start
npm run check
```

El servidor utiliza el frontend ubicado en `../Frontend`.

Para activar Supabase, copia `.env.example` como `.env` y completa las variables en tu entorno local. Nunca subas el archivo `.env` ni claves privadas.

## Cierre de invitaciones y reportes

Responsable de implementación y corrección: **Boris Salda Vargas**.

La entrega anterior había dejado estos dos módulos como pendientes. Boris terminó el contrato del backend y su interfaz: la persona propietaria genera enlace y código, Supabase conserva únicamente los hashes, el destinatario acepta o rechaza, y solo la aceptación crea la membresía. También quedaron disponibles consulta, reenvío y cancelación, con controles de destinatario, duplicados, vencimiento y reutilización.

En reportes, el autor sale siempre de la sesión. Cada persona ve únicamente sus solicitudes; el superadmin recibe, toma y responde sin obtener por ello acceso al contenido de muros privados. La respuesta vuelve solamente a la persona que creó el reporte. Las pruebas cubren el recorrido correcto y los intentos no autorizados.

La actualización visual de Pierina se mantuvo intacta y se conectó a estos eventos. La misma versión se publica desde la raíz y queda reflejada en `Backend/`, `Frontend/` y `BaseDeDatos/` para la revisión por áreas.
