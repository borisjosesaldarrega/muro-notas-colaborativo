'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const required = [
  'server.js',
  'lib/supabase.js',
  'lib/supabase-store.js',
  'public/index.html',
  'public/inicio-tema.js',
  'public/app.js',
  'public/styles.css',
  'public/original-theme.css',
  'public/runtime-config.js',
  'public/supabase-client.js',
  'public/netlify-socket.js',
  'public/vendor/supabase.js',
  'supabase/migrations/20260713200000_create_muro_schema.sql'
];

const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) throw new Error(`Faltan archivos de compilación: ${missing.join(', ')}`);

function listarArchivos(directorio, base = directorio) {
  return fs.readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = path.join(directorio, entrada.name);
    return entrada.isDirectory() ? listarArchivos(ruta, base) : [path.relative(base, ruta)];
  });
}

async function construir() {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const recursos = ['/inicio-tema.js', '/styles.css', '/original-theme.css', '/runtime-config.js', '/vendor/supabase.js', '/supabase-client.js', '/netlify-socket.js', '/app.js'];
  for (const recurso of recursos) {
    if (!html.includes(recurso)) throw new Error(`index.html no incluye ${recurso}`);
  }

  const origen = path.join(root, 'public');
  const destino = path.join(root, 'dist');
  fs.rmSync(destino, { recursive: true, force: true });
  fs.mkdirSync(destino, { recursive: true });

  const archivosJavaScript = new Set([
    'inicio-tema.js',
    'runtime-config.js',
    'supabase-client.js',
    'netlify-socket.js',
    'app.js'
  ]);

  for (const rutaRelativa of listarArchivos(origen)) {
    const rutaOrigen = path.join(origen, rutaRelativa);
    const rutaDestino = path.join(destino, rutaRelativa);
    fs.mkdirSync(path.dirname(rutaDestino), { recursive: true });

    if (archivosJavaScript.has(rutaRelativa.replaceAll('\\', '/'))) {
      const resultado = await esbuild.transform(fs.readFileSync(rutaOrigen, 'utf8'), {
        charset: 'utf8',
        legalComments: 'none',
        minify: true,
        sourcemap: false,
        target: 'es2020'
      });
      fs.writeFileSync(rutaDestino, resultado.code, 'utf8');
    } else {
      fs.copyFileSync(rutaOrigen, rutaDestino);
    }
  }

  console.log('Build preparado en dist: recursos públicos validados y JavaScript propio minificado sin mapas de código.');
}

construir().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
