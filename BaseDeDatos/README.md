# Base de datos

Las migraciones de Supabase están en `supabase/migrations` y crean las tablas, relaciones, restricciones, políticas RLS y configuración de tiempo real utilizadas por el backend.

Las migraciones deben ejecutarse en orden. Para vincular Supabase CLI se requieren variables privadas configuradas únicamente en el entorno local; ninguna contraseña, token o `service_role` debe subirse al repositorio.

El backend conserva un modo en memoria para ejecutar las pruebas sin credenciales. La persistencia real se activa cuando se configuran las variables indicadas en `Backend/.env.example`.
