'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const root = join(__dirname, '..');

test('restaura la sesión persistida y conserva el muro solicitado al recargar', () => {
  const app = readFileSync(join(root, 'Frontend/js/app.js'), 'utf8');
  const board = readFileSync(join(root, 'Frontend/js/board.js'), 'utf8');
  assert.match(app, /localStorage\.getItem\(TOKEN_KEY\)/);
  assert.match(app, /emit\('auth:restore'/);
  assert.match(board, /URLSearchParams\(window\.location\.hash/);
  assert.equal((board.match(/emit\('auth:restore'/g) || []).length, 0);
});

test('expone configuración de cuenta, temas e invitación con lenguaje claro', () => {
  const html = readFileSync(join(root, 'Frontend/index.html'), 'utf8');
  const board = readFileSync(join(root, 'Frontend/js/board.js'), 'utf8');
  assert.match(html, /id="accountSettingsDialog"/);
  assert.match(html, /value="system"/);
  assert.match(html, /value="light"/);
  assert.match(html, /value="dark"/);
  assert.match(html, />Invitar</);
  assert.match(board, /Propietario\/a/);
});

test('sincroniza el correo confirmado de Auth con el perfil público', () => {
  const migration = readFileSync(join(root, 'supabase/migrations/20261105045727_sincronizar_cambio_correo_usuario.sql'), 'utf8');
  assert.match(migration, /after update of email on auth\.users/i);
  assert.match(migration, /update public\.muro_usuarios/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /revoke all on function/i);
});
