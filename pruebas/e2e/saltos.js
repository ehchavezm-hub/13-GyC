const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1470, height: 880 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  // pasar dos proyectos a En pausa y tres a Cerrado como en la captura
  await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('lpsgt-demo-db'));
    for (const x of db.proyectos) { if (['INT-01', 'INT-02'].includes(x.codigo)) x.estado = 'en_pausa'; if (['D-102', 'D-103', 'D-104'].includes(x.codigo)) x.estado = 'cerrado'; }
    localStorage.setItem('lpsgt-demo-db', JSON.stringify(db)); });
  await p.goto(BASE + '?demo&y=1#/proyectos'); await p.waitForTimeout(2000);
  // medir altos durante 3 segundos: si cambian, la grilla "baila"
  const altos = [];
  for (let i = 0; i < 15; i++) {
    altos.push(await p.evaluate(() => [...document.querySelectorAll('[data-grilla] .tabulator')].map(t => t.offsetHeight + '/' + t.querySelector('.tabulator-tableholder').clientWidth).join(' ')));
    await p.waitForTimeout(200);
  }
  const distintos = [...new Set(altos)];
  console.log(distintos.length === 1 ? 'OK  altos estables: ' + distintos[0] : 'FALLA cambian: ' + distintos.join(' || '));
  const barrasV = await p.evaluate(() => [...document.querySelectorAll('[data-grilla] .tabulator-tableholder')].map(h => h.scrollHeight > h.clientHeight));
  console.log('  barra vertical interna por ventana:', JSON.stringify(barrasV));
  await p.screenshot({ path: 'shots3/saltos.png', fullPage: true });
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
