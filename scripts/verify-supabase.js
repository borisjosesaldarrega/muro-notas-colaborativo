'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createSupabaseServices, environmentStatus } = require('../lib/supabase');
const { SupabaseStore } = require('../lib/supabase-store');

async function main() {
  const services = createSupabaseServices();
  const environment = environmentStatus();
  const result = {
    publicConnection: false,
    authentication: 'not_run',
    rls: 'migration_required',
    backendAdmin: false,
    migrationFile: fs.existsSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260713200000_create_muro_schema.sql')),
    migrationCredentials: environment.missingPrivate.filter((key) => ['SUPABASE_DB_PASSWORD', 'SUPABASE_ACCESS_TOKEN', 'DATABASE_URL'].includes(key))
  };
  if (!services.publicConfigured) throw new Error('Faltan las variables públicas de Supabase.');

  const store = new SupabaseStore(services);
  result.publicConnection = (await store.checkPublicConnection()).ok;
  result.backendAdmin = (await store.checkAdminConnection()).ok;

  let schemaReady = false;
  if (result.backendAdmin) {
    const { error } = await services.adminClient.from('profiles').select('id').limit(1);
    schemaReady = !error;
    result.rls = schemaReady ? 'ready_for_authenticated_test' : 'migration_required';
  }

  if (process.argv.includes('--auth') && result.backendAdmin) {
    const suffix = crypto.randomUUID();
    const email = `codex-verification-${suffix}@example.invalid`;
    const password = `Muro-${suffix}-9a!`;
    let userId = '';
    try {
      const { data: created, error: createError } = await services.adminClient.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: 'Verificación temporal' } });
      if (createError) throw createError;
      userId = created.user.id;
      const { data: login, error: loginError } = await services.publicClient.auth.signInWithPassword({ email, password });
      if (loginError || !login.session?.access_token) throw loginError || new Error('Supabase no devolvió una sesión.');
      const { data: verified, error: verifyError } = await services.createUserClient(login.session.access_token).auth.getUser(login.session.access_token);
      if (verifyError || verified.user?.id !== userId) throw verifyError || new Error('El usuario autenticado no coincide.');
      result.authentication = 'passed';
      if (schemaReady) {
        const userClient = services.createUserClient(login.session.access_token);
        const { data: ownRows, error: ownError } = await userClient.from('profiles').select('id').eq('id', userId);
        result.rls = !ownError && ownRows?.length === 1 ? 'passed' : 'failed';
      }
    } finally {
      if (userId) await services.adminClient.auth.admin.deleteUser(userId);
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
