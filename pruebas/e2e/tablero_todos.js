// Pedido 173: la opción «Tablero» aparece para todos los usuarios (cualquier rol) y abre sin errores.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const fallas = []; const chk = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button');
  const n = await p.locator('.usuarios-demo button').count();
  for (let i = 1; i <= n; i++) {
    await p.goto(B + '?demo&x=' + i + '#/'); await p.waitForSelector('.usuarios-demo button');
    const quien = (await p.locator(`.usuarios-demo button:nth-child(${i})`).innerText()).replace(/\s+/g, ' ');
    await p.click(`.usuarios-demo button:nth-child(${i})`); await p.waitForTimeout(1200);
    if (/Pendiente de aprobación/i.test(quien)) { console.log('  (sin acceso hasta ser aprobado) ' + quien); }
    else {
      chk(await p.locator('.nav-modulos a[href="#/tablero"]').count() === 1, 'Tablero en el menú: ' + quien);
      await p.click('.nav-modulos a[href="#/tablero"]'); await p.waitForTimeout(1500);
      chk(/#\/tablero/.test(p.url()) && (await p.locator('h1, h2').first().innerText()).includes('Tablero'), 'Tablero abre: ' + quien);
    }
    await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  }
  chk(!errs.length, 'sin errores de página ' + errs.join(' / '));
  await b.close(); console.log(fallas.length ? `FALLAS: ${fallas.length}` : 'SIN ERRORES'); process.exit(fallas.length ? 1 : 0);
})();
