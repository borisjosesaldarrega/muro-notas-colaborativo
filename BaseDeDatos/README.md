# Base de datos

La carpeta `supabase/` contiene las migraciones, políticas RLS, configuración local y plantillas de correo versionadas.

Ejecuta Supabase CLI desde la raíz indicando este directorio de trabajo:

```bash
npx supabase --workdir BaseDeDatos db push --dry-run
```

Las credenciales se leen desde variables de entorno y nunca deben incorporarse al repositorio.
