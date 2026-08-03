require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');

const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!projectRef || !accessToken) {
  throw new Error('Configura SUPABASE_PROJECT_REF y SUPABASE_ACCESS_TOKEN en .env antes de aplicar las plantillas.');
}

const directory = path.join(__dirname, '..', 'supabase', 'email-templates');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const apiNames = {
  confirmation: 'confirmation', invite: 'invite', magic_link: 'magic_link', recovery: 'recovery',
  email_change: 'email_change', reauthentication: 'reauthentication',
  password_changed_notification: 'password_changed_notification',
  email_changed_notification: 'email_changed_notification',
  phone_changed_notification: 'phone_changed_notification',
  identity_linked_notification: 'identity_linked_notification',
  identity_unlinked_notification: 'identity_unlinked_notification',
  mfa_factor_enrolled_notification: 'mfa_factor_enrolled_notification',
  mfa_factor_unenrolled_notification: 'mfa_factor_unenrolled_notification'
};
const notificationNames = ['password_changed', 'email_changed', 'phone_changed', 'identity_linked', 'identity_unlinked', 'mfa_factor_enrolled', 'mfa_factor_unenrolled'];
const payload = {};
for (const [name, apiName] of Object.entries(apiNames)) {
  payload[`mailer_subjects_${apiName}`] = manifest[name].subject;
  payload[`mailer_templates_${apiName}_content`] = fs.readFileSync(path.join(directory, `${name}.html`), 'utf8');
}
for (const name of notificationNames) payload[`mailer_notifications_${name}_enabled`] = true;

async function main() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/config/auth`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 400 && /free tier|default email provider/i.test(detail)) {
      throw new Error('Supabase bloqueó la modificación: en el plan gratuito primero debes configurar un proveedor SMTP propio o actualizar el plan. Los archivos locales ya están listos y no requieren cambios.');
    }
    throw new Error(`No se pudieron aplicar las plantillas (HTTP ${response.status}).`);
  }
  const result = await response.json();
  for (const key of Object.keys(payload).filter((key) => key.startsWith('mailer_subjects_'))) {
    if (result[key] !== payload[key]) throw new Error(`La API no confirmó ${key}`);
  }
  console.log(`Aplicadas y confirmadas ${Object.keys(apiNames).length} plantillas en el proyecto ${projectRef}.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
