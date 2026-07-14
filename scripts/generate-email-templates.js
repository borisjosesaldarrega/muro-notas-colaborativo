const fs = require('node:fs');
const path = require('node:path');

const outputDirectory = path.join(__dirname, '..', 'supabase', 'email-templates');

const templates = {
  confirmation: {
    subject: 'Confirma tu cuenta en Muro Colaborativo',
    eyebrow: 'Te damos la bienvenida',
    title: '¡Tu muro está casi listo!',
    message: 'Confirma tu correo para empezar a crear muros, organizar ideas y colaborar con tu equipo.',
    action: ['Verificar mi cuenta', '{{ .ConfirmationURL }}'],
    code: '{{ .Token }}',
    codeLabel: 'También puedes usar este código de verificación:',
    security: 'Si no creaste una cuenta en Muro Colaborativo, puedes ignorar este correo con tranquilidad.'
  },
  invite: {
    subject: 'Te invitaron a Muro Colaborativo',
    eyebrow: 'Una idea compartida empieza aquí',
    title: 'Tienes una invitación',
    message: 'Alguien quiere colaborar contigo. Acepta la invitación para unirte y comenzar a compartir notas e ideas.',
    action: ['Aceptar invitación', '{{ .ConfirmationURL }}'],
    security: 'Si no esperabas esta invitación, puedes ignorar este correo; no se realizará ningún cambio.'
  },
  magic_link: {
    subject: 'Tu acceso seguro a Muro Colaborativo',
    eyebrow: 'Acceso sin contraseña',
    title: 'Entra con un solo clic',
    message: 'Usa el botón para iniciar sesión de forma segura. El enlace es personal, caduca pronto y solo puede utilizarse una vez.',
    action: ['Iniciar sesión', '{{ .ConfirmationURL }}'],
    code: '{{ .Token }}',
    codeLabel: 'Si la aplicación te pide un código, utiliza este:',
    security: 'Si no solicitaste este acceso, ignora el correo y no compartas el enlace ni el código.'
  },
  recovery: {
    subject: 'Restablece tu contraseña de Muro Colaborativo',
    eyebrow: 'Recuperación de cuenta',
    title: 'Crea una nueva contraseña',
    message: 'Recibimos una solicitud para recuperar tu cuenta. Continúa para elegir una contraseña nueva y segura.',
    action: ['Restablecer contraseña', '{{ .ConfirmationURL }}'],
    code: '{{ .Token }}',
    codeLabel: 'Si la aplicación solicita un código, escribe este:',
    security: 'Si no pediste restablecer tu contraseña, ignora este correo y tu cuenta permanecerá sin cambios.'
  },
  email_change: {
    subject: 'Confirma tu nuevo correo en Muro Colaborativo',
    eyebrow: 'Actualización de cuenta',
    title: 'Confirma tu nuevo correo',
    message: 'Solicitaste cambiar el correo de tu cuenta a <strong style="color:#20263a;">{{ .NewEmail }}</strong>. Confírmalo para completar el cambio.',
    action: ['Confirmar nuevo correo', '{{ .ConfirmationURL }}'],
    code: '{{ .Token }}',
    codeLabel: 'También puedes confirmar con este código:',
    security: 'Si no solicitaste este cambio, ignora el correo y revisa la seguridad de tu cuenta.'
  },
  reauthentication: {
    subject: '{{ .Token }} es tu código de verificación',
    eyebrow: 'Verificación de identidad',
    title: 'Confirma que eres tú',
    message: 'Para proteger tu cuenta antes de una acción sensible, introduce el siguiente código en Muro Colaborativo.',
    code: '{{ .Token }}',
    codeLabel: 'Tu código de verificación:',
    security: 'Nunca compartas este código. Si no solicitaste esta verificación, ignora el correo y revisa tu cuenta.'
  },
  password_changed_notification: {
    subject: 'Tu contraseña fue actualizada',
    eyebrow: 'Aviso de seguridad',
    title: 'Contraseña actualizada',
    message: 'La contraseña de tu cuenta <strong style="color:#20263a;">{{ .Email }}</strong> se cambió correctamente.',
    security: 'Si tú no hiciste este cambio, restablece tu contraseña de inmediato y revisa la seguridad de tu cuenta.'
  },
  email_changed_notification: {
    subject: 'El correo de tu cuenta fue actualizado',
    eyebrow: 'Aviso de seguridad',
    title: 'Correo actualizado',
    message: 'El correo de tu cuenta cambió de <strong style="color:#20263a;">{{ .OldEmail }}</strong> a <strong style="color:#20263a;">{{ .Email }}</strong>.',
    security: 'Si tú no realizaste este cambio, protege tu cuenta y contacta al equipo responsable de inmediato.'
  },
  phone_changed_notification: {
    subject: 'El teléfono de tu cuenta fue actualizado',
    eyebrow: 'Aviso de seguridad',
    title: 'Teléfono actualizado',
    message: 'El teléfono asociado a tu cuenta cambió de <strong style="color:#20263a;">{{ .OldPhone }}</strong> a <strong style="color:#20263a;">{{ .Phone }}</strong>.',
    security: 'Si tú no realizaste este cambio, protege tu cuenta y contacta al equipo responsable de inmediato.'
  },
  identity_linked_notification: {
    subject: 'Se vinculó un nuevo método de inicio de sesión',
    eyebrow: 'Aviso de seguridad',
    title: 'Nuevo acceso vinculado',
    message: 'Se vinculó <strong style="color:#20263a;">{{ .Provider }}</strong> como método de inicio de sesión para <strong style="color:#20263a;">{{ .Email }}</strong>.',
    security: 'Si no reconoces esta acción, revisa y protege tu cuenta de inmediato.'
  },
  identity_unlinked_notification: {
    subject: 'Se eliminó un método de inicio de sesión',
    eyebrow: 'Aviso de seguridad',
    title: 'Acceso desvinculado',
    message: 'Se eliminó <strong style="color:#20263a;">{{ .Provider }}</strong> como método de inicio de sesión para <strong style="color:#20263a;">{{ .Email }}</strong>.',
    security: 'Si no reconoces esta acción, revisa y protege tu cuenta de inmediato.'
  },
  mfa_factor_enrolled_notification: {
    subject: 'Se añadió un método de verificación',
    eyebrow: 'Aviso de seguridad',
    title: 'Verificación añadida',
    message: 'Se añadió el método <strong style="color:#20263a;">{{ .FactorType }}</strong> para proteger la cuenta <strong style="color:#20263a;">{{ .Email }}</strong>.',
    security: 'Si no reconoces esta acción, revisa y protege tu cuenta de inmediato.'
  },
  mfa_factor_unenrolled_notification: {
    subject: 'Se eliminó un método de verificación',
    eyebrow: 'Aviso de seguridad',
    title: 'Verificación eliminada',
    message: 'Se eliminó el método <strong style="color:#20263a;">{{ .FactorType }}</strong> de la cuenta <strong style="color:#20263a;">{{ .Email }}</strong>.',
    security: 'Si no reconoces esta acción, revisa y protege tu cuenta de inmediato.'
  }
};

function renderTemplate(template) {
  const action = template.action ? `
    <tr><td align="center" style="padding:8px 36px 26px 36px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#6658f5" style="border:2px solid #20263a;border-radius:10px;">
        <a href="${template.action[1]}" style="display:inline-block;padding:14px 24px;color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:700;text-decoration:none;">${template.action[0]}</a>
      </td></tr></table>
    </td></tr>` : '';
  const code = template.code ? `
    <tr><td style="padding:0 36px 24px 36px;">
      <p style="margin:0 0 10px 0;color:#687186;font-family:Arial,sans-serif;font-size:13px;line-height:20px;text-align:center;">${template.codeLabel}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#fffdf6" class="email-code" style="padding:16px;border:2px solid #20263a;border-radius:10px;color:#20263a;font-family:'Courier New',monospace;font-size:28px;font-weight:700;letter-spacing:7px;">${template.code}</td></tr></table>
    </td></tr>` : '';

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>Muro Colaborativo</title><style>@media(prefers-color-scheme:dark){.email-bg{background:#171a26!important}.email-card{background:#222638!important}.email-title,.email-copy{color:#f3f4f8!important}.email-muted{color:#b8becc!important}.email-security{background:#29443e!important;color:#e9ebf5!important}.email-code{background:#2b2f42!important;color:#ffffff!important}}</style></head>
<body class="email-bg" style="margin:0;padding:0;background-color:#f7f5ef;word-spacing:normal;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${template.title} · Muro Colaborativo</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f7f5ef" class="email-bg" style="width:100%;background-color:#f7f5ef;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" class="email-card" style="width:100%;max-width:600px;background:#ffffff;border:2px solid #20263a;border-radius:22px;overflow:hidden;">
  <tr><td align="center" style="height:10px;line-height:10px;"><span style="display:inline-block;width:72px;height:11px;margin-top:-2px;border:2px solid #20263a;border-radius:3px;background:#ffffff;font-size:1px;line-height:1px;">&nbsp;</span></td></tr>
  <tr><td align="center" style="padding:24px 24px 18px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#6658f5" style="width:42px;height:42px;border:2px solid #20263a;border-radius:11px;color:#ffffff;font-family:Arial,sans-serif;font-size:24px;font-weight:800;">✦</td><td style="padding-left:13px;color:#20263a;font-family:Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:.4px;">MURO <span style="font-weight:500;">COLABORATIVO</span></td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:32px 36px 8px 36px;">
    <p style="margin:0 0 10px;color:#6658f5;font-family:Arial,sans-serif;font-size:12px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;">${template.eyebrow}</p>
    <h1 class="email-title" style="margin:0;color:#20263a;font-family:Arial,sans-serif;font-size:28px;line-height:36px;">${template.title}</h1>
  </td></tr>
  <tr><td style="padding:8px 36px 22px 36px;"><p class="email-copy" style="margin:0;color:#3d455b;font-family:Arial,sans-serif;font-size:16px;line-height:25px;text-align:center;">${template.message}</p></td></tr>${action}${code}
  <tr><td style="padding:0 36px 28px 36px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td class="email-security" bgcolor="#aeebd8" style="padding:15px 17px;border:1px solid #20263a;border-radius:10px;background:#aeebd8;color:#354854;font-family:Arial,sans-serif;font-size:13px;line-height:20px;"><strong>Nota de seguridad:</strong> ${template.security}</td></tr></table></td></tr>
  <tr><td align="center" style="padding:20px 28px;border-top:1px solid #e2dfd6;"><p class="email-muted" style="margin:0;color:#687186;font-family:Arial,sans-serif;font-size:12px;line-height:18px;">Ideas visibles, trabajo compartido.<br>Este es un mensaje automático de Muro Colaborativo.</p></td></tr>
</table></td></tr></table></body></html>`;
}

fs.mkdirSync(outputDirectory, { recursive: true });
for (const [name, template] of Object.entries(templates)) {
  fs.writeFileSync(path.join(outputDirectory, `${name}.html`), renderTemplate(template), 'utf8');
}
fs.writeFileSync(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(Object.fromEntries(Object.entries(templates).map(([name, template]) => [name, { subject: template.subject }])), null, 2)}\n`, 'utf8');
console.log(`Generadas ${Object.keys(templates).length} plantillas en ${outputDirectory}`);
