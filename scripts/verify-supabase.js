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
    const { error } = await services.adminClient.from('muro_usuarios').select('id').limit(1);
    schemaReady = !error;
    result.rls = schemaReady ? 'ready_for_authenticated_test' : 'migration_required';
  }

  if (process.argv.includes('--auth') && result.backendAdmin) {
    const suffix = crypto.randomUUID();
    const password = `Muro-${suffix}-9a!`;
    const temporaryUsers = [];
    try {
      const sessions = [];
      for (const label of ['owner', 'outsider']) {
        const email = `codex-${label}-${suffix}@example.invalid`;
        const { data: created, error: createError } = await services.adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name: `Temporal ${label}` }
        });
        if (createError) throw createError;
        temporaryUsers.push(created.user.id);
        const loginClient = services.createUserClient();
        const { data: login, error: loginError } = await loginClient.auth.signInWithPassword({ email, password });
        if (loginError || !login.session?.access_token) throw loginError || new Error('Supabase no devolvio una sesion.');
        const { data: verified, error: verifyError } = await services.publicClient.auth.getUser(login.session.access_token);
        if (verifyError || verified.user?.id !== created.user.id) throw verifyError || new Error('El usuario autenticado no coincide.');
        sessions.push({ id: created.user.id, token: login.session.access_token });
      }
      result.authentication = 'passed';

      if (schemaReady) {
        const [owner, outsider] = sessions;
        const ownerClient = services.createUserClient(owner.token);
        const outsiderClient = services.createUserClient(outsider.token);
        const noteId = crypto.randomUUID();
        const { data: wallId, error: wallError } = await ownerClient.rpc('muro_crear_sala', {
          nombre_nuevo: 'RLS temporal',
          descripcion_nueva: 'Verificación automática A10'
        });
        if (wallError || !wallId) throw wallError || new Error('La RPC no devolvió la sala creada.');

        const { error: directInsertError } = await ownerClient.from('muro_salas').insert({
          nombre: 'Intento directo bloqueado',
          propietario_id: owner.id
        });
        const { error: noteError } = await ownerClient.from('muro_notas').insert({
          id: noteId,
          sala_id: wallId,
          contenido: 'Nota privada temporal',
          color: 'amarillo',
          posicion_x: 20,
          posicion_y: 20,
          autor_id: owner.id,
          nombre_autor: 'Temporal owner'
        });
        if (noteError) throw noteError;

        const { data: ownerRows, error: ownerReadError } = await ownerClient.from('muro_notas').select('id').eq('id', noteId);
        const { data: hiddenRows, error: outsiderReadError } = await outsiderClient.from('muro_notas').select('id').eq('id', noteId);
        const { error: outsiderInsertError } = await outsiderClient.from('muro_notas').insert({
          sala_id: wallId,
          contenido: 'Intento bloqueado',
          color: 'rosa',
          posicion_x: 30,
          posicion_y: 30,
          autor_id: outsider.id,
          nombre_autor: 'Temporal outsider'
        });
        result.rls = Boolean(directInsertError)
          && !ownerReadError
          && ownerRows?.length === 1
          && !outsiderReadError
          && hiddenRows?.length === 0
          && Boolean(outsiderInsertError)
          ? 'passed'
          : 'failed';
      }
    } finally {
      for (const userId of temporaryUsers.reverse()) {
        await services.adminClient.auth.admin.deleteUser(userId);
      }
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
