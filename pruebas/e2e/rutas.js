const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message + ' @' + p.url()));
  p.on('console', m => { if (m.type() === 'error' && !/404|ERR_FAILED|fonts/.test(m.text())) errs.push('console: ' + m.text() + ' @' + p.url()); });
  await p.route('**/fonts.g*/**', r => r.abort());
  await p.goto(BASE + '?demo');
  await p.waitForTimeout(1500);
  console.log('INICIO:', (await p.textContent('body')).slice(0, 120).replace(/\s+/g,' '));
  const usuarios = (process.argv[3] || '1').split(',').map(Number);
  for (const u of usuarios) {
    await p.evaluate(() => localStorage.removeItem('lpsgt-demo-usuario'));
    await p.goto(BASE + '?demo&u=' + u + '#/');
    await p.waitForSelector('.usuarios-demo button');
    await p.click(`.usuarios-demo button:nth-child(${u})`);
    await p.waitForTimeout(1500);
    const rutas = ['/plan', '/lookahead', '/restricciones', '/cartera', '/tablero', '/reunion', '/equipo', '/proyectos', '/plantillas',
      '/config/usuarios', '/config/listas', '/config/parametros', '/config/permisos', '/config/columnas', '/config/importar', '/config/respaldo', '/config/auditoria', '/mejoras', '/ayuda'];
    for (const r of rutas) {
      await p.goto(BASE + '?demo#' + r);
      await p.waitForTimeout(1300);
      const aviso = await p.$('.aviso.error');
      if (aviso) errs.push(`aviso error en ${r}: ` + (await aviso.textContent()));
      await p.screenshot({ path: `${OUT}/u${u}_${r.replace(/\//g, '_')}.png` });
    }
    // Ficha de proyecto
    await p.goto(BASE + '?demo#/proyectos');
    await p.waitForTimeout(1200);
    const ficha = await p.$('button.mini-btn');
    if (ficha) { await ficha.click(); await p.waitForTimeout(1200); await p.screenshot({ path: `${OUT}/u${u}_ficha.png` }); }
  }
  console.log(errs.length ? errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
