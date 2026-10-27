'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261027000508_corregir_a10_creacion_atomica_muro.sql'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'public/netlify-socket.js'), 'utf8');

test('A10 crea la sala y la membresia propietaria dentro de una sola funcion', () => {
  assert.match(migration, /create or replace function public\.muro_crear_sala/);
  assert.match(migration, /insert into public\.muro_salas[\s\S]*insert into public\.muro_sala_miembros/);
  assert.match(migration, /solicitante uuid := \(select auth\.uid\(\)\)/);
  assert.match(migration, /revoke insert on table public\.muro_salas from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.muro_crear_sala\(text, text\) from public, anon/);
  assert.match(migration, /grant execute on function public\.muro_crear_sala\(text, text\) to authenticated/);
});

test('wall:create usa la RPC y no publica detalles internos de Supabase', () => {
  const wallCreate = adapter.match(/case 'wall:create':[\s\S]*?case 'wall:update':/)?.[0] || '';
  assert.match(wallCreate, /\.rpc\('muro_crear_sala'/);
  assert.doesNotMatch(wallCreate, /\.from\('muro_salas'\)\.insert/);
  assert.doesNotMatch(wallCreate, /\.from\('muro_sala_miembros'\)\.insert/);
  assert.match(adapter, /'wall:create': 'No se pudo crear el muro\. Inténtalo de nuevo\.'/);
  assert.doesNotMatch(adapter, /console\.error\(event, error\)/);
});
