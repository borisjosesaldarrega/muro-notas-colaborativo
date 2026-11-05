'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261027002032_completar_invitaciones_y_reportes.sql'), 'utf8');
const codeMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261104221056_codigo_invitacion_8_y_vista_previa.sql'), 'utf8');
const reusableMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261104221929_codigo_sala_reutilizable.sql'), 'utf8');
const persistentCodeMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261105223133_conservar_codigo_invitacion_activo.sql'), 'utf8');
const moderationMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261105040901_reportes_por_usuario_y_sanciones.sql'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'public', 'netlify-socket.js'), 'utf8');

test('los códigos guardan hashes y crean una membresía por cada cuenta que se une', () => {
  assert.match(migration, /token_hash text not null unique/);
  assert.match(migration, /codigo_hash text not null unique/);
  assert.match(migration, /create or replace function public\.muro_responder_invitacion/);
  const responseFunction = reusableMigration.split('create or replace function public.muro_responder_invitacion')[1];
  assert.match(responseFunction, /insert into public\.muro_sala_miembros/);
  assert.match(responseFunction, /invitacion\.estado <> 'pendiente'/);
  assert.doesNotMatch(responseFunction, /set estado = 'aceptada'/);
  const creationFunction = codeMigration.split('create or replace function public.muro_crear_invitacion_codigo')[1].split('create or replace function')[0];
  assert.doesNotMatch(creationFunction, /insert into public\.muro_sala_miembros/);
  assert.match(codeMigration, /create or replace function public\.muro_inspeccionar_invitacion/);
  assert.match(codeMigration, /invitacion\.estado <> 'pendiente'/);
});

test('el frontend usa RPC para invitaciones y reportes sin exponer service role', () => {
  for (const name of ['muro_crear_invitacion_codigo', 'muro_inspeccionar_invitacion', 'muro_responder_invitacion', 'muro_crear_reporte', 'muro_reportar_usuario', 'muro_responder_reporte']) assert.match(adapter, new RegExp(`rpc\\('${name}'`));
  assert.doesNotMatch(adapter, /service[_-]?role/i);
});

test('el propietario recupera el código activo y gestiona permisos mediante RPC protegidas', () => {
  assert.match(persistentCodeMigration, /add column if not exists codigo_visible/);
  assert.match(persistentCodeMigration, /then i\.codigo_visible/);
  assert.match(persistentCodeMigration, /muro_cambiar_permiso_miembro/);
  assert.match(persistentCodeMigration, /muro_revocar_miembro/);
  assert.match(persistentCodeMigration, /usuario_objetivo = propietario/);
  assert.match(persistentCodeMigration, /revoke update, delete on public\.muro_sala_miembros from authenticated/);
  assert.match(adapter, /codigo_visible_nuevo: secrets\.code/);
  assert.match(adapter, /rpc\('muro_cambiar_permiso_miembro'/);
  assert.match(adapter, /rpc\('muro_revocar_miembro'/);
  assert.doesNotMatch(adapter, /from\('muro_sala_miembros'\)\.update/);
  assert.doesNotMatch(adapter, /from\('muro_sala_miembros'\)\.delete/);
});

test('los reportes apuntan a usuarios compartidos y las sanciones quedan protegidas', () => {
  assert.match(moderationMigration, /add column if not exists reportado_id/);
  assert.match(moderationMigration, /origen\.usuario_id = solicitante/);
  assert.match(moderationMigration, /destino\.usuario_id = usuario_objetivo/);
  assert.match(moderationMigration, /create table if not exists public\.muro_sanciones/);
  assert.match(moderationMigration, /alter table public\.muro_sanciones enable row level security/);
  assert.match(moderationMigration, /revoke insert, update, delete on public\.muro_sanciones from authenticated/);
});

test('reportes derivan el autor de auth.uid y no devuelven contenido privado del muro', () => {
  const createReport = migration.split('create or replace function public.muro_crear_reporte')[1].split('create or replace function')[0];
  assert.match(createReport, /solicitante uuid := \(select auth\.uid\(\)\)/);
  const adminReports = migration.split('create or replace function public.muro_reportes_administracion')[1].split('create or replace function')[0];
  assert.doesNotMatch(adminReports, /muro_notas|contenido|sala_nombre/);
  assert.match(migration, /estado in \('pendiente', 'en_revision', 'resuelto', 'rechazado'\)/);
});
