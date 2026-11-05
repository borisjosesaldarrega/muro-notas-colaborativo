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
  const css = readFileSync(join(root, 'Frontend/css/styles.css'), 'utf8');
  assert.match(css, /\.settings-scroll-content::\-webkit-scrollbar-thumb/);
  assert.match(css, /scrollbar-color:\s*rgba\(107, 88, 220, \.52\) transparent/);
  assert.match(css, /html\[data-theme="dark"\] \.settings-scroll-content/);
  assert.match(css, /\.admin-user-info \.avatar[\s\S]*place-items:\s*center/);
  assert.match(html, /class="admin-user-role">Moderador\/a/);
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

test('personaliza muros y sincroniza su edición o eliminación para todos los miembros', () => {
  const html = readFileSync(join(root, 'Frontend/index.html'), 'utf8');
  const app = readFileSync(join(root, 'Frontend/js/app.js'), 'utf8');
  const board = readFileSync(join(root, 'Frontend/js/board.js'), 'utf8');
  const adapter = readFileSync(join(root, 'public/netlify-socket.js'), 'utf8');
  const migration = readFileSync(join(root, 'supabase/migrations/20261105150734_agregar_color_a_muros.sql'), 'utf8');
  assert.match(html, /name="wallColor" value="amarillo"/);
  assert.match(html, />Guardar<\/button>/);
  assert.match(app, /input\[name="theme"\][\s\S]*applyTheme\(selectedTheme\)/);
  assert.match(board, /wall-card-menu-trigger/);
  assert.match(board, /data-wall-action="edit"/);
  assert.match(board, /data-wall-action="delete"/);
  assert.match(board, /socket\.on\('wall:deleted'/);
  assert.match(adapter, /color_nuevo: payload\.color/);
  assert.match(migration, /add column color text not null default 'amarillo'/i);
  assert.match(migration, /insert into public\.muro_salas \(nombre, descripcion, color, propietario_id\)[\s\S]*insert into public\.muro_sala_miembros/i);
  assert.match(migration, /grant execute on function public\.muro_crear_sala\(text, text, text\) to authenticated/i);
});

test('el registro exige verificación real de ocho dígitos y permite reenviar el código', () => {
  const html = readFileSync(join(root, 'Frontend/index.html'), 'utf8');
  const app = readFileSync(join(root, 'Frontend/js/app.js'), 'utf8');
  const server = readFileSync(join(root, 'server.js'), 'utf8');
  const store = readFileSync(join(root, 'lib/supabase-store.js'), 'utf8');
  const adapter = readFileSync(join(root, 'public/netlify-socket.js'), 'utf8');
  const config = readFileSync(join(root, 'supabase/config.toml'), 'utf8');
  assert.equal((html.match(/class="code-digit"/g) || []).length, 8);
  assert.match(app, /pendingRegistration = \{ name, email, type: 'signup' \}/);
  assert.doesNotMatch(app, /pendingRegistration\.(password|passwordConfirmation|code)/);
  assert.match(app, /auth:resend-code/);
  assert.match(app, /auth:verify-code/);
  assert.match(server, /socket\.on\('auth:verify-code'/);
  assert.match(server, /socket\.on\('auth:resend-code'/);
  assert.match(store, /auth\.signUp\(/);
  assert.match(store, /auth\.verifyOtp\(\{ email, token, type: 'email' \}\)/);
  assert.match(store, /auth\.resend\(\{ type: 'signup'/);
  assert.doesNotMatch(store, /createUser\(\{[\s\S]{0,200}email_confirm:\s*true/);
  assert.match(adapter, /payload\.type === 'recovery' \? 'recovery' : 'email'/);
  assert.match(adapter, /auth\.verifyOtp\(\{ email: payload\.email\.trim\(\)\.toLowerCase\(\), token: payload\.token\.trim\(\), type \}\)/);
  assert.match(config, /otp_length = 8/);
  assert.match(config, /max_frequency = "60s"/);
});

test('recupera la contraseña con un código de ocho dígitos dentro de la aplicación', () => {
  const html = readFileSync(join(root, 'Frontend/index.html'), 'utf8');
  const app = readFileSync(join(root, 'Frontend/js/app.js'), 'utf8');
  const server = readFileSync(join(root, 'server.js'), 'utf8');
  const store = readFileSync(join(root, 'lib/supabase-store.js'), 'utf8');
  const adapter = readFileSync(join(root, 'public/netlify-socket.js'), 'utf8');
  const template = readFileSync(join(root, 'supabase/email-templates/recovery.html'), 'utf8');
  assert.match(html, /id="resetPasswordForm"/);
  assert.match(html, /te enviaremos un código de 8 dígitos/i);
  assert.match(app, /pendingRegistration = \{ email, type: 'recovery' \}/);
  assert.match(app, /auth:recovery-password/);
  assert.match(server, /socket\.on\('auth:recovery-password'/);
  assert.match(server, /store\.verifyRecovery\(\{ email, token \}\)/);
  assert.match(store, /verifyOtp\(\{ email, token, type: 'recovery' \}\)/);
  assert.match(adapter, /case 'auth:recovery-password'/);
  assert.match(template, /\{\{ \.Token \}\}/);
  assert.doesNotMatch(template, /\{\{ \.ConfirmationURL \}\}/);
});

test('ajusta las notas al contenido y sincroniza el nombre visible de su autor', () => {
  const board = readFileSync(join(root, 'Frontend/js/board.js'), 'utf8');
  const css = readFileSync(join(root, 'Frontend/css/styles.css'), 'utf8');
  const migration = readFileSync(join(root, 'supabase/migrations/20261105200638_sincronizar_nombre_autor_notas.sql'), 'utf8');
  assert.match(board, /function resizeNoteToContent/);
  assert.match(board, /sizeClass === 'size-sm' \? 46/);
  assert.match(css, /#appView \.note\.size-sm \{ width: 210px; min-height: 132px/);
  assert.match(migration, /after update of nombre on public\.muro_usuarios/i);
  assert.match(migration, /update public\.muro_notas/i);
  assert.match(migration, /nota\.autor_id = usuario\.id/i);
});

test('preserva la autoría, identifica a quien edita y cuenta personas únicas por muro', () => {
  const board = readFileSync(join(root, 'Frontend/js/board.js'), 'utf8');
  const server = readFileSync(join(root, 'server.js'), 'utf8');
  const store = readFileSync(join(root, 'lib/supabase-store.js'), 'utf8');
  const migration = readFileSync(join(root, 'supabase/migrations/20261105203500_preservar_autoria_y_registrar_edicion.sql'), 'utf8');
  assert.match(migration, /new\.autor_id := old\.autor_id/i);
  assert.match(migration, /new\.nombre_autor := old\.nombre_autor/i);
  assert.match(migration, /new\.editado_por_id := actor_id/i);
  assert.match(store, /editado_por_id,nombre_editor/);
  assert.doesNotMatch(store, /delete row\.autor_id/);
  assert.match(board, /Creada por \$\{note\.autor/);
  assert.match(board, /Editada por \$\{note\.editor\}/);
  assert.match(server, /const userIds = new Set\(\)/);
  assert.match(server, /connectedUserCount\(wallId/);
  assert.doesNotMatch(server, /io\.emit\('users:count', io\.engine\.clientsCount\)/);
});

test('renueva sesiones vencidas, confirma el guardado de notas y conserva el historial de reportes', () => {
  const app = readFileSync(join(root, 'Frontend/js/app.js'), 'utf8');
  const board = readFileSync(join(root, 'Frontend/js/board.js'), 'utf8');
  const html = readFileSync(join(root, 'Frontend/index.html'), 'utf8');
  const server = readFileSync(join(root, 'server.js'), 'utf8');
  const store = readFileSync(join(root, 'lib/supabase-store.js'), 'utf8');
  assert.match(store, /refreshSession\(\{ refresh_token: refreshToken \}\)/);
  assert.match(server, /refreshSocketSession\(socket\)/);
  assert.match(server, /socket\.emit\('auth:token-refreshed'/);
  assert.match(app, /REFRESH_TOKEN_KEY = 'muroRefreshToken'/);
  assert.match(app, /boardSocket\.on\('auth:token-refreshed'/);
  assert.match(app, /boardSocket\.on\('connect'/);
  assert.match(app, /window\.MuroBoard\?\.selectWall\(wallId\)/);
  assert.match(board, /function emitWithTimeout/);
  assert.match(board, /setTimeout\(\(\) => persistNoteEdit\(note\.id, textarea\), 700\)/);
  assert.match(board, /await emitWithTimeout\('note:create'/);
  assert.match(server, /const nextNote = \{/);
  assert.match(html, /id="adminReportHistoryTable"/);
  assert.match(app, /Cerrar reporte/);
  assert.match(app, /renderAdminReportHistory/);
});

test('mantiene el scroll de configuración dentro del contenido del modal', () => {
  const html = readFileSync(join(root, 'Frontend/index.html'), 'utf8');
  const css = readFileSync(join(root, 'Frontend/css/styles.css'), 'utf8');
  assert.match(html, /class="settings-scroll-content"/);
  assert.match(css, /\.account-settings-dialog \{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.settings-scroll-content \{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.settings-scroll-content::-webkit-scrollbar \{ width:\s*8px/);
  assert.match(css, /scrollbar-color:\s*rgba\(107, 88, 220, \.52\) transparent/);
});

test('permite reportar miembros y notifica las medidas por correo sin revelar al reportante', () => {
  const board = readFileSync(join(root, 'Frontend/js/board.js'), 'utf8');
  const app = readFileSync(join(root, 'Frontend/js/app.js'), 'utf8');
  const server = readFileSync(join(root, 'server.js'), 'utf8');
  assert.match(board, /class="report-member-btn"[^>]*>Reportar</);
  assert.match(board, /socket\.emit\('report:user:create'/);
  assert.match(server, /sendModerationEmail\(socket\.data\.accessToken/);
  assert.match(server, /email: target\.email, name: target\.name, action, message/);
  assert.doesNotMatch(server, /sendModerationEmail\([\s\S]{0,200}reporter/i);
  assert.match(app, /La medida se aplicó y se notificó por correo/);
  assert.match(server, /La medida se aplicó, pero no se pudo enviar el correo de notificación/);
});

test('el modal de nueva nota cierra sus acciones y no genera desplazamiento horizontal', () => {
  const html = readFileSync(join(root, 'Frontend/index.html'), 'utf8');
  const board = readFileSync(join(root, 'Frontend/js/board.js'), 'utf8');
  const css = readFileSync(join(root, 'Frontend/css/styles.css'), 'utf8');
  assert.match(html, /id="closeNoteModal"/);
  assert.match(html, /id="cancelNoteModal"/);
  assert.match(board, /#closeNoteModal[\s\S]*#noteDialog[\s\S]*close\(\)/);
  assert.match(board, /#cancelNoteModal[\s\S]*#noteDialog[\s\S]*close\(\)/);
  assert.match(css, /#noteDialog \{[^}]*overflow:\s*hidden/);
  assert.match(css, /#noteDialog textarea \{[^}]*max-width:\s*100%/);
});
