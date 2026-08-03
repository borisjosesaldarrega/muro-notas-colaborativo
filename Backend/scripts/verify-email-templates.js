const fs = require('node:fs');
const path = require('node:path');

const directory = path.join(__dirname, '..', '..', 'BaseDeDatos', 'supabase', 'email-templates');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const expectedVariables = {
  confirmation: ['{{ .ConfirmationURL }}', '{{ .Token }}'],
  invite: ['{{ .ConfirmationURL }}'],
  magic_link: ['{{ .ConfirmationURL }}', '{{ .Token }}'],
  recovery: ['{{ .ConfirmationURL }}', '{{ .Token }}'],
  email_change: ['{{ .ConfirmationURL }}', '{{ .Token }}', '{{ .NewEmail }}'],
  reauthentication: ['{{ .Token }}'],
  password_changed_notification: ['{{ .Email }}'],
  email_changed_notification: ['{{ .OldEmail }}', '{{ .Email }}'],
  phone_changed_notification: ['{{ .OldPhone }}', '{{ .Phone }}'],
  identity_linked_notification: ['{{ .Provider }}', '{{ .Email }}'],
  identity_unlinked_notification: ['{{ .Provider }}', '{{ .Email }}'],
  mfa_factor_enrolled_notification: ['{{ .FactorType }}', '{{ .Email }}'],
  mfa_factor_unenrolled_notification: ['{{ .FactorType }}', '{{ .Email }}']
};

for (const [name, variables] of Object.entries(expectedVariables)) {
  if (!manifest[name]?.subject) throw new Error(`Falta el asunto de ${name}`);
  const html = fs.readFileSync(path.join(directory, `${name}.html`), 'utf8');
  for (const variable of variables) {
    if (!html.includes(variable)) throw new Error(`${name} no conserva ${variable}`);
  }
  if (!html.includes('<table role="presentation"') || !html.includes('style="')) throw new Error(`${name} no usa estructura de correo compatible`);
  if (/<script\b/i.test(html) || /supabase/i.test(html)) throw new Error(`${name} contiene contenido no permitido`);
}
console.log(`Verificadas ${Object.keys(expectedVariables).length} plantillas y sus variables dinámicas.`);
