'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const required = [
  'server.js',
  'lib/supabase.js',
  'lib/supabase-store.js',
  'public/index.html',
  'public/app.js',
  'public/styles.css',
  'public/original-theme.css',
  'public/supabase-client.js',
  'supabase/migrations/20260713200000_create_muro_schema.sql'
];

const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) throw new Error(`Faltan archivos de compilación: ${missing.join(', ')}`);

const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
for (const asset of ['/styles.css', '/original-theme.css', '/vendor/supabase.js', '/supabase-client.js', '/app.js']) {
  if (!html.includes(asset)) throw new Error(`index.html no incluye ${asset}`);
}

console.log('Build validado: servidor, cliente, estilos y migración están completos.');
