const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo#/plan'); await p.waitForTimeout(1200);
  console.log('Chart en Plan:', await p.evaluate(() => typeof window.Chart));
  await p.evaluate(() => { location.hash = '#/tablero'; }); await p.waitForTimeout(2000);
  console.log('gráficos en Tablero:', await p.evaluate(() => [...document.querySelectorAll('canvas')].filter(c => window.Chart?.getChart(c)).length));
  // cambiar semanas y proyecto: repinta
  await p.selectOption('[data-sem]', '26'); await p.waitForTimeout(1200);
  await p.evaluate(async () => { const s = await import('./js/core/store.js'); s.seleccionarProyecto(s.store.proyectos[0].id); }); await p.waitForTimeout(800);
  console.log('gráficos tras filtros:', await p.evaluate(() => [...document.querySelectorAll('canvas')].filter(c => window.Chart?.getChart(c)).length));
  console.log('KPIs:', (await p.locator('#contenido .kpi').count()));
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
