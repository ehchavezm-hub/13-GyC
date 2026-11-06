// Verifica que las librerías de app/vendor sean idénticas a las publicadas oficialmente (cadena de suministro)
// y que no tengan vulnerabilidades conocidas (npm audit). Uso: node pruebas/verificar-librerias.mjs
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(RAIZ, 'app/vendor');
const TMP = mkdtempSync(join(tmpdir(), 'lpsgt-libs-'));
const sh = (c, cwd = TMP) => execSync(c, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

// Librería → paquete npm y archivo original
const NPM = {
  'tabulator.min.js': ['tabulator-tables', '6.6.1', 'dist/js/tabulator.min.js'],
  'tabulator.min.css': ['tabulator-tables', '6.6.1', 'dist/css/tabulator.min.css'],
  'supabase.min.js': ['@supabase/supabase-js', '2.117.3', 'dist/umd/supabase.js'],
  'chart.umd.min.js': ['chart.js', '4.5.1', 'dist/chart.umd.min.js'],
};
const SHEETJS = ['0.20.3', 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'];
const SENTRY = ['@sentry/browser@11.9.0', 'esbuild@0.25.0'];

// Se ignora solo el comentario del mapa de fuentes y los saltos de línea finales
const normal = t => t.replace(/\/[/*]# sourceMappingURL=\S+\s*(\*\/)?/g, '').trimEnd();
const fallas = [];
const comparar = (nombre, original) => {
  const ok = normal(readFileSync(join(VENDOR, nombre), 'utf8')) === normal(original);
  console.log(`${ok ? '✔' : '✘'} ${nombre}`);
  if (!ok) fallas.push(`${nombre} no coincide con el original publicado`);
};

for (const [archivo, [paquete, version, ruta]] of Object.entries(NPM)) {
  const tgz = sh(`npm pack ${paquete}@${version} --silent`).trim().split('\n').pop();
  const dir = join(TMP, archivo + '-pkg');
  sh(`mkdir -p "${dir}" && tar xzf "${tgz}" -C "${dir}"`);
  comparar(archivo, readFileSync(join(dir, 'package', ruta), 'utf8'));
}

try {
  const respuesta = await fetch(SHEETJS[1]);
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  comparar('xlsx.full.min.js', await respuesta.text());
} catch (e) {
  fallas.push(`No se pudo descargar SheetJS ${SHEETJS[0]} de cdn.sheetjs.com para compararlo (${e.cause?.code || e.message})`);
}

// sentry.min.js se genera desde npm: se vuelve a generar y se compara
writeFileSync(join(TMP, 'package.json'), '{"name":"verificar","private":true}');
sh(`npm i --silent --no-audit --no-fund ${SENTRY.join(' ')}`);
writeFileSync(join(TMP, 'entrada.js'), readFileSync(join(RAIZ, 'pruebas/sentry-entrada.js')));
sh('npx esbuild entrada.js --bundle --minify --format=iife --global-name=Sentry --target=es2020 --legal-comments=eof --log-level=warning --outfile=sentry.min.js');
comparar('sentry.min.js', readFileSync(join(TMP, 'sentry.min.js'), 'utf8'));

// Vulnerabilidades conocidas de las versiones incluidas (SheetJS no está en npm: se exige >= 0.20.2)
const deps = Object.fromEntries(Object.values(NPM).map(([p, v]) => [p, v]));
deps['@sentry/browser'] = SENTRY[0].split('@').pop();
writeFileSync(join(TMP, 'package.json'), JSON.stringify({ name: 'auditoria', private: true, dependencies: deps }));
sh('rm -rf node_modules package-lock.json && npm i --package-lock-only --silent --no-fund');
try {
  sh('npm audit --audit-level=moderate');
  console.log('✔ npm audit sin vulnerabilidades moderadas o mayores');
} catch {
  fallas.push('npm audit encontró vulnerabilidades en las librerías incluidas');
}
const [ma, mi, pa] = SHEETJS[0].split('.').map(Number);
if (ma === 0 && (mi < 20 || (mi === 20 && pa < 2))) fallas.push('SheetJS debe ser 0.20.2 o superior (CVE-2023-30533, CVE-2024-22363)');

if (fallas.length) { console.error('\n' + fallas.join('\n')); process.exit(1); }
console.log('\nLibrerías verificadas.');
