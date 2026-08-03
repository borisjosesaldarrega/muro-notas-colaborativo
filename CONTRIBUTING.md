# Cómo colaborar

Cada cambio debe realizarse en una rama propia. Así cada integrante puede trabajar en su área sin modificar accidentalmente el trabajo de otra persona.

## Flujo recomendado

```bash
git switch main
git pull
git switch -c frontend/nombre-del-cambio
```

Usa un prefijo según el área: `frontend/`, `backend/`, `base-datos/` o `pruebas/`. Después de comprobar el cambio:

```bash
git add Frontend
git commit -m "Mejorar formulario de registro"
git push -u origin frontend/nombre-del-cambio
```

Abre un pull request y pide revisión antes de unirlo a `main`. Incluye solamente los archivos relacionados con tu tarea.

## Responsabilidad de cada carpeta

- `Frontend/`: pantallas, estilos y comportamiento del navegador.
- `Backend/`: servidor, Socket.io, validaciones y acceso administrativo.
- `BaseDeDatos/`: migraciones, políticas RLS y configuración versionada de Supabase.
- `Pruebas/`: pruebas automatizadas.

Los archivos de configuración compartidos de la raíz se cambian únicamente cuando una tarea realmente lo requiera. Nunca subas `.env`, contraseñas, tokens ni claves privadas.

Si más adelante se crean colecciones reales de Postman, deben guardarse en una carpeta `Postman/`; no se mantiene una carpeta vacía.
