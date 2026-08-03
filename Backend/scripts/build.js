'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const required = [
  'Backend/server.js',
  'Backend/lib/supabase.js',
  'Backend/lib/supabase-store.js',
  'Frontend/public/index.html',
  'Frontend/public/app.js',
  'Frontend/public/styles.css',
  'Frontend/public/original-theme.css',
  'Frontend/public/supabase-client.js',
  'BaseDeDatos/supabase/migrations/20260713200000_create_muro_schema.sql'
];

const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) throw new Error(`Faltan archivos de compilación: ${missing.join(', ')}`);

const html = fs.readFileSync(path.join(root, 'Frontend', 'public', 'index.html'), 'utf8');
for (const asset of ['/styles.css', '/original-theme.css', '/vendor/supabase.js', '/supabase-client.js', '/app.js']) {
  if (!html.includes(asset)) throw new Error(`index.html no incluye ${asset}`);
}

console.log('Build validado: servidor, cliente, estilos y migración están completos.');
