# Backend del Muro Colaborativo

Este backend reemplaza la demostración que guardaba todo en memoria. Mantiene un modo local para pruebas, pero cuando las variables de Supabase están configuradas utiliza Auth, políticas RLS y las tablas del proyecto.

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

## Ejecutar

```bash
npm install
npm start
```

El servidor utiliza el frontend ubicado en `../Frontend`.

Para activar Supabase, copia `.env.example` como `.env` y completa las variables en tu entorno local. Nunca subas el archivo `.env` ni claves privadas.

## Pendiente para Steven: invitaciones y reportes

Responsable propuesto: **Steven León — @stevenleonb2**

### 1. Validación de invitaciones

El evento `wall:invite` actualmente agrega directamente a una cuenta registrada. Falta convertirlo en un flujo de invitación verificable:

1. Definir si la invitación se aceptará mediante enlace, código o ambos.
2. Generar un token o código aleatorio, de un solo uso y con fecha de expiración.
3. Guardar solamente el hash del token o código.
4. Crear los eventos para enviar, consultar, aceptar, rechazar, reenviar y cancelar invitaciones.
5. Agregar al usuario a `muro_sala_miembros` únicamente después de validar la invitación.
6. Impedir que un lector invite personas o modifique permisos.
7. Rechazar invitaciones vencidas, usadas, canceladas o dirigidas a otro usuario.
8. Evitar invitaciones duplicadas para la misma sala y el mismo correo.
9. Añadir pruebas automáticas del flujo correcto y de los casos de error.
10. Documentar los eventos y las respuestas que consumirá el frontend.

La integración con correo puede conectarse después; la validación del backend no debe depender de que el correo ya esté configurado.

### 2. Flujo de reportes y respuestas

Las migraciones ya contemplan la tabla de reportes, pero falta terminar su API y su comunicación en tiempo real:

1. Permitir que un usuario autenticado cree un reporte con categoría, motivo y descripción validados.
2. Guardar cada reporte en Supabase con estado `pendiente`, autor y fecha.
3. Enviar el nuevo reporte en tiempo real únicamente a las cuentas superadministradoras.
4. Permitir que solo un superadministrador consulte, tome, revise y responda reportes.
5. Guardar quién revisó el reporte, la respuesta, la decisión y la fecha de revisión.
6. Manejar estados definidos: `pendiente`, `en_revision`, `resuelto` y `rechazado`.
7. Enviar la respuesta en tiempo real únicamente al usuario que creó el reporte.
8. Permitir que cada usuario consulte solo sus propios reportes y respuestas.
9. Evitar que el identificador enviado por el navegador suplante al autor; el autor debe salir de la sesión autenticada.
10. No mostrar el contenido de muros privados al superadministrador por el solo hecho de recibir un reporte.
11. Validar longitudes, estados y transiciones para impedir respuestas vacías o cambios inválidos.
12. Añadir pruebas de creación, recepción, autorización, respuesta y privacidad.

Se considera terminado cuando las pruebas demuestren el recorrido completo: usuario crea el reporte, superadministrador lo recibe y responde, y el mismo usuario recibe la respuesta.
