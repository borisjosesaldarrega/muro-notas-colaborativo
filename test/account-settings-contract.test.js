'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const root = join(__dirname, '..');

test('restaura la sesión persistida y conserva el muro solicitado al recargar', () => {
  const app = readFileSync(join(root, 'Frontend/js/app.js'), 'utf8');
  const board = readFileSync(join(root, 'Frontend/js/board.js'), 'utf8');
  const adapter = readFileSync(join(root, 'public/netlify-socket.js'), 'utf8');
  assert.match(app, /localStorage\.getItem\(TOKEN_KEY\)/);
  assert.match(app, /emit\('auth:restore'/);
  assert.match(board, /URLSearchParams\(window\.location\.hash/);
  assert.equal((board.match(/emit\('auth:restore'/g) || []).length, 0);
  assert.match(app, /await emitAsync\(socket, 'auth:logout'/);
  assert.match(adapter, /auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(adapter, /auth\.getSession\(\)/);
  assert.match(adapter, /if \(data\.session\) throw new Error/);
});

test('expone configuración de cuenta, temas e invitación con lenguaje claro', () => {
  const html = readFileSync(join(root, 'Frontend/index.html'), 'utf8');
  const board = readFileSync(join(root, 'Frontend/js/board.js'), 'utf8');
  assert.match(html, /id="accountSettingsDialog"/);
  assert.match(html, /value="system"/);
  assert.match(html, /value="light"/);
  assert.match(html, /value="dark"/);
  assert.match(html, />Invitar</);
  assert.match(html, /id="usernameForm"/);
  assert.match(html, /id="emailForm"/);
  assert.match(html, /id="passwordForm"/);
  assert.match(html, /data-admin-tab="historial"/);
  assert.match(html, /data-admin-tab="guia"/);
  assert.match(board, /Propietario\/a/);
});

test('sincroniza el correo confirmado de Auth con el perfil público', () => {
  const migration = readFileSync(join(root, 'supabase/migrations/20261105045727_sincronizar_cambio_correo_usuario.sql'), 'utf8');
  assert.match(migration, /after update of email on auth\.users/i);
  assert.match(migration, /update public\.muro_usuarios/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /revoke all on function/i);
});

test('los nombres son únicos y el tema oscuro conserva contraste en notas y modales', () => {
  const migration = readFileSync(join(root, 'supabase/migrations/20261105143627_nombres_usuario_unicos.sql'), 'utf8');
  const css = readFileSync(join(root, 'Frontend/css/styles.css'), 'utf8');
  const adapter = readFileSync(join(root, 'public/netlify-socket.js'), 'utf8');
  assert.match(migration, /unique index[\s\S]*lower\(btrim\(nombre\)\)/i);
  assert.match(migration, /muro_nombre_disponible/i);
  assert.doesNotMatch(adapter, /rpc\('muro_nombre_disponible'/);
  assert.match(css, /html\[data-theme="dark"\] #appView \.note textarea \{ background: transparent; \}/);
  assert.match(css, /html\[data-theme="dark"\] \.secondary-button/);
});
