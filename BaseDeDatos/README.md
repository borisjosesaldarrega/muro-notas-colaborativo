# Base de datos

Las migraciones de Supabase están en `supabase/migrations` y crean las tablas, relaciones, restricciones, políticas RLS y configuración de tiempo real utilizadas por el backend.

La migración `20261027000508_corregir_a10_creacion_atomica_muro.sql` resuelve OWASP A10 mediante la RPC transaccional `muro_crear_sala`. Este historial coincide con las migraciones aplicadas en el proyecto remoto.

La migración `20261105045727_sincronizar_cambio_correo_usuario.sql` agrega un trigger restringido que sincroniza `muro_usuarios.correo` cuando Supabase Auth confirma un cambio de dirección. La aplicación exige la contraseña actual antes de solicitar el cambio.

La migración `20261105143627_nombres_usuario_unicos.sql` crea un índice insensible a mayúsculas para impedir nombres repetidos durante el registro o al editar el perfil. `20261105144717_retirar_consulta_publica_nombres.sql` retira la comprobación pública de disponibilidad y evita que se utilice para enumerar nombres.

La migración `20261105150734_agregar_color_a_muros.sql` guarda un color propio por muro y amplía `muro_crear_sala` para crear en una sola transacción la sala coloreada y su membresía propietaria. Las claves foráneas con `ON DELETE CASCADE` retiran membresías, notas, invitaciones y reportes asociados cuando el propietario elimina un muro.

La migración `20261105040901_reportes_por_usuario_y_sanciones.sql` enlaza cada reporte con la cuenta denunciada, comprueba que ambas personas compartan un muro y crea el historial protegido `muro_sanciones`. Solo el backend administrativo puede escribir medidas; cada usuario únicamente puede consultar las propias.

Las migraciones deben ejecutarse en orden. Para vincular Supabase CLI se requieren variables privadas configuradas únicamente en el entorno local; ninguna contraseña, token o `service_role` debe subirse al repositorio.

El backend conserva un modo en memoria para ejecutar las pruebas sin credenciales. La persistencia real se activa cuando se configuran las variables indicadas en `Backend/.env.example`.
