# Plantillas de correo de Muro Colaborativo

Este directorio contiene el asunto y el HTML completo de todos los correos de Supabase Auth. Cada archivo `.html` está listo para copiar y pegar en **Authentication → Emails** del panel de Supabase. El archivo `manifest.json` reúne los asuntos exactos.

## Plantillas de autenticación

| Plantilla del panel | Asunto | Archivo | Variables conservadas |
| --- | --- | --- | --- |
| Confirm signup | Confirma tu cuenta en Muro Colaborativo | `confirmation.html` | `{{ .ConfirmationURL }}`, `{{ .Token }}` |
| Invite user | Te invitaron a Muro Colaborativo | `invite.html` | `{{ .ConfirmationURL }}` |
| Magic link | Tu acceso seguro a Muro Colaborativo | `magic_link.html` | `{{ .ConfirmationURL }}`, `{{ .Token }}` |
| Reset password | Restablece tu contraseña de Muro Colaborativo | `recovery.html` | `{{ .ConfirmationURL }}`, `{{ .Token }}` |
| Change email address | Confirma tu nuevo correo en Muro Colaborativo | `email_change.html` | `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .NewEmail }}` |
| Reauthentication | `{{ .Token }} es tu código de verificación` | `reauthentication.html` | `{{ .Token }}` |

## Avisos de seguridad

| Plantilla del panel | Asunto | Archivo | Variables conservadas |
| --- | --- | --- | --- |
| Password changed | Tu contraseña fue actualizada | `password_changed_notification.html` | `{{ .Email }}` |
| Email changed | El correo de tu cuenta fue actualizado | `email_changed_notification.html` | `{{ .OldEmail }}`, `{{ .Email }}` |
| Phone changed | El teléfono de tu cuenta fue actualizado | `phone_changed_notification.html` | `{{ .OldPhone }}`, `{{ .Phone }}` |
| Identity linked | Se vinculó un nuevo método de inicio de sesión | `identity_linked_notification.html` | `{{ .Provider }}`, `{{ .Email }}` |
| Identity unlinked | Se eliminó un método de inicio de sesión | `identity_unlinked_notification.html` | `{{ .Provider }}`, `{{ .Email }}` |
| MFA factor enrolled | Se añadió un método de verificación | `mfa_factor_enrolled_notification.html` | `{{ .FactorType }}`, `{{ .Email }}` |
| MFA factor unenrolled | Se eliminó un método de verificación | `mfa_factor_unenrolled_notification.html` | `{{ .FactorType }}`, `{{ .Email }}` |

## Uso

- Regenerar archivos: `npm run generate:emails`
- Verificar estructura y variables: `npm run verify:emails`
- Aplicar al proyecto alojado: `npm run apply:emails`

El último comando lee únicamente `SUPABASE_PROJECT_REF` y `SUPABASE_ACCESS_TOKEN` desde `.env`. Ninguna credencial se guarda en los HTML, el manifiesto ni la configuración versionada.

> Estado del proyecto alojado: Supabase no permite modificar plantillas en el plan gratuito mientras se use su proveedor de correo predeterminado. Configura un SMTP propio en **Project Settings → Authentication → SMTP Settings** o actualiza el plan y vuelve a ejecutar `npm run apply:emails`. No es necesario editar de nuevo los HTML.

El diseño se contrastó con las 28 pantallas del PDF exportado desde Figma. Usa los colores exactos del documento: morado `#6658f5`, papel `#f7f5ef`, tinta `#20263a`, nota amarilla `#ffe58f` y menta `#aeebd8`. También reproduce el logotipo morado con destello, la tarjeta blanca de bordes oscuros, la pestaña superior y los botones del flujo de acceso. La estructura se basa en tablas, mantiene estilos esenciales en línea, no usa JavaScript ni imágenes externas y añade una adaptación discreta para modo oscuro.
