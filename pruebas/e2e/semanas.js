const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const ver = async etq => {
    const cab = await p.textContent('[data-semana]');
    const lunes = await p.$$eval('.tabulator-col-title', t => t.map(x => x.textContent).find(x => /^L \d/.test(x)));
    const ok = cab.includes(lunes.replace('L ', ''));
    console.log((ok ? 'OK  ' : 'FALLA ') + etq + ': cabecera "' + cab + '" · columna lunes "' + lunes + '"'); if (!ok) errs.push(etq);
  };
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  for (const ruta of ['/plan', '/lookahead']) {
    await p.goto(BASE + '?demo#' + ruta); await p.waitForTimeout(1300);
    if (ruta === '/lookahead') { console.log('  LA semanas:', await p.$$eval('.tabulator-group', g => g.slice(0, 3).map(x => x.textContent.slice(0, 22)).join(' | '))); continue; }
    await ver('inicio');
    await p.click('[data-a="sig"]'); await p.waitForTimeout(1300); await ver('siguiente');
    await p.click('[data-a="sig"]'); await p.waitForTimeout(1300); await ver('siguiente x2');
    await p.click('[data-a="ant"]'); await p.waitForTimeout(1300); await ver('anterior');
    await p.click('[data-a="hoy"]'); await p.waitForTimeout(1300); await ver('semana actual');
    await p.reload(); await p.waitForTimeout(1500); await ver('recargar');
  }
  console.log(errs.length ? 'ERRORES: ' + errs.join(', ') : 'SIN ERRORES');
  await b.close();
})();
