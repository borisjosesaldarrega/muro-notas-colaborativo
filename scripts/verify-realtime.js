'use strict';

require('dotenv').config();
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  throw new Error('Faltan las variables necesarias para verificar Supabase Realtime.');
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, secretKey, clientOptions);
const owner = createClient(url, publishableKey, clientOptions);
const collaborator = createClient(url, publishableKey, clientOptions);
const suffix = crypto.randomUUID();
const password = `Muro-${suffix}-9a!`;
const createdUsers = [];
let wallId = null;
let channel = null;

async function createTemporaryUser(label, client) {
  const email = `realtime-${label}-${suffix}@example.invalid`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: `Temporal ${label}` }
  });
  if (createError) throw createError;
  createdUsers.push(created.user.id);
  const { error: loginError } = await client.auth.signInWithPassword({ email, password });
  if (loginError) throw loginError;
  return created.user.id;
}

function waitForSubscription(target) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime no completó la suscripción.')), 12_000);
    target.subscribe((status) => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(undefined); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error(`Realtime respondió ${status}.`)); }
    });
  });
}

async function main() {
  try {
    const ownerId = await createTemporaryUser('owner', owner);
    const collaboratorId = await createTemporaryUser('collaborator', collaborator);
    wallId = crypto.randomUUID();
    const noteId = crypto.randomUUID();

    const { error: wallError } = await admin.from('muro_salas').insert({ id: wallId, nombre: 'Realtime temporal', propietario_id: ownerId });
    if (wallError) throw wallError;
    const { error: membersError } = await admin.from('muro_sala_miembros').insert([
      { sala_id: wallId, usuario_id: ownerId, rol: 'propietario' },
      { sala_id: wallId, usuario_id: collaboratorId, rol: 'editor' }
    ]);
    if (membersError) throw membersError;
    const { error: noteError } = await owner.from('muro_notas').insert({
      id: noteId,
      sala_id: wallId,
      contenido: 'Nota temporal',
      color: 'amarillo',
      posicion_x: 40,
      posicion_y: 50,
      autor_id: ownerId,
      nombre_autor: 'Temporal owner'
    });
    if (noteError) throw noteError;

    let resolveChange;
    let rejectChange;
    const changeReceived = new Promise((resolve, reject) => { resolveChange = resolve; rejectChange = reject; });
    const eventTimer = setTimeout(() => rejectChange(new Error('El segundo usuario no recibió el movimiento.')), 12_000);
    channel = collaborator
      .channel(`verificacion-${suffix}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'muro_notas', filter: `id=eq.${noteId}` }, (payload) => {
        clearTimeout(eventTimer);
        resolveChange(payload.new);
      });
    await waitForSubscription(channel);

    const { data: moved, error: moveError } = await owner
      .from('muro_notas')
      .update({ posicion_x: 315, posicion_y: 225, actualizado_en: new Date().toISOString() })
      .eq('id', noteId)
      .select('id,posicion_x,posicion_y')
      .single();
    if (moveError) throw moveError;
    const received = await changeReceived;
    if (Number(received.posicion_x) !== 315 || Number(received.posicion_y) !== 225) throw new Error('Realtime recibió coordenadas incorrectas.');

    console.log(JSON.stringify({ authentication: 'passed', rlsUpdate: moved.id === noteId ? 'passed' : 'failed', realtimeMovement: 'passed' }, null, 2));
  } finally {
    if (channel) await collaborator.removeChannel(channel);
    if (wallId) await admin.from('muro_salas').delete().eq('id', wallId);
    for (const userId of createdUsers.reverse()) await admin.auth.admin.deleteUser(userId);
    await Promise.allSettled([admin.removeAllChannels(), owner.removeAllChannels(), collaborator.removeAllChannels()]);
    admin.auth.stopAutoRefresh();
    owner.auth.stopAutoRefresh();
    collaborator.auth.stopAutoRefresh();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  });
