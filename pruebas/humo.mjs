// Prueba de humo del aplicativo en modo demostración: recorre todas las pantallas con cada usuario de prueba
// (un usuario por rol) y falla si aparece un error de JavaScript o un aviso de error en pantalla.
// Uso: node pruebas/humo.mjs [url]   (por defecto http://localhost:8099/; servir la carpeta app/)
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8099/';
const RUTAS = ['/plan', '/lookahead', '/backlog', '/restricciones', '/cartera', '/tablero', '/reunion', '/equipo', '/plantillas',
  '/config/usuarios', '/config/listas', '/config/listas?lista=__proyectos', '/config/parametros', '/config/permisos',
  '/config/columnas', '/config/importar', '/config/respaldo', '/config/auditoria', '/reportes', '/mejoras', '/ayuda'];

const opciones = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};
const navegador = await chromium.launch(opciones);
const pagina = await (await navegador.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errores = [];
pagina.on('pageerror', e => errores.push(`JS: ${e.message} @ ${pagina.url()}`));
pagina.on('console', m => {
  if (m.type() === 'error' && !/favicon|fonts|ERR_FAILED|404/.test(m.text())) errores.push(`consola: ${m.text()} @ ${pagina.url()}`);
});
await pagina.route('**/fonts.g*/**', r => r.abort());

await pagina.goto(BASE + '?demo');
await pagina.evaluate(() => localStorage.clear());
await pagina.goto(BASE + '?demo&inicio=1#/');
await pagina.waitForSelector('.usuarios-demo button');
const usuarios = await pagina.$$eval('.usuarios-demo button', bs => bs.map(b => b.textContent.replace(/\s+/g, ' ').trim()));
let pantallas = 0;

for (let i = 0; i < usuarios.length; i++) {
  await pagina.evaluate(() => localStorage.removeItem('lpsgt-demo-usuario'));
  await pagina.goto(`${BASE}?demo&u=${i}#/`);
  await pagina.waitForSelector('.usuarios-demo button');
  await pagina.click(`.usuarios-demo button:nth-child(${i + 1})`);
  await pagina.waitForSelector('.usuarios-demo', { state: 'detached', timeout: 15000 });
  await pagina.waitForSelector('nav.nav-modulos, .login', { timeout: 15000 });
  if (!(await pagina.$('nav'))) {           // cuenta pendiente o desactivada: solo ve el aviso
    console.log(`✔ ${usuarios[i]} (sin acceso a pantallas)`);
    continue;
  }
  for (const r of RUTAS) {
    await pagina.goto(`${BASE}?demo#${r}`);
    await pagina.waitForTimeout(900);
    const aviso = await pagina.$('.aviso.error');
    if (aviso) errores.push(`aviso de error en ${r} (${usuarios[i]}): ${(await aviso.textContent()).trim()}`);
    pantallas++;
  }
  console.log(`✔ ${usuarios[i]}`);
}

await navegador.close();
console.log(`${usuarios.length} usuarios · ${pantallas} pantallas recorridas`);
if (errores.length) {
  console.error(errores.join('\n'));
  process.exit(1);
}
console.log('SIN ERRORES');
