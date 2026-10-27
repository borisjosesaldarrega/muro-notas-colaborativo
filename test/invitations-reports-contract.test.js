'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261027002032_completar_invitaciones_y_reportes.sql'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'public', 'netlify-socket.js'), 'utf8');

test('las invitaciones guardan hashes y crean membresía solo al aceptar', () => {
  assert.match(migration, /token_hash text not null unique/);
  assert.match(migration, /codigo_hash text not null unique/);
  assert.match(migration, /create or replace function public\.muro_responder_invitacion/);
  const responseFunction = migration.split('create or replace function public.muro_responder_invitacion')[1].split('create or replace function')[0];
  assert.match(responseFunction, /insert into public\.muro_sala_miembros/);
  assert.match(responseFunction, /invitacion\.estado <> 'pendiente'/);
  const creationFunction = migration.split('create or replace function public.muro_crear_invitacion')[1].split('create or replace function')[0];
  assert.doesNotMatch(creationFunction, /insert into public\.muro_sala_miembros/);
});

test('el frontend usa RPC para invitaciones y reportes sin exponer service role', () => {
  for (const name of ['muro_crear_invitacion', 'muro_responder_invitacion', 'muro_crear_reporte', 'muro_responder_reporte']) assert.match(adapter, new RegExp(`rpc\\('${name}'`));
  assert.doesNotMatch(adapter, /service[_-]?role/i);
});

test('reportes derivan el autor de auth.uid y no devuelven contenido privado del muro', () => {
  const createReport = migration.split('create or replace function public.muro_crear_reporte')[1].split('create or replace function')[0];
  assert.match(createReport, /solicitante uuid := \(select auth\.uid\(\)\)/);
  const adminReports = migration.split('create or replace function public.muro_reportes_administracion')[1].split('create or replace function')[0];
  assert.doesNotMatch(adminReports, /muro_notas|contenido|sala_nombre/);
  assert.match(migration, /estado in \('pendiente', 'en_revision', 'resuelto', 'rechazado'\)/);
});
