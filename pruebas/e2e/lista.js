const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&u=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(BASE + '?demo#/config/listas'); await p.waitForTimeout(1200);
  await p.selectOption('[data-l]', 'ubicaciones'); await p.waitForTimeout(1000);
  const r = await p.evaluate(async () => {
    const t = Tabulator.findTable('.grilla-tabla')[0];
    const row = t.getRows().find(r => r.getData().codigo === 'remoto');
    row.getCell('_cuenta').setValue(false);
    await new Promise(r => setTimeout(r, 1500));
    const db = JSON.parse(localStorage.getItem('lpsgt-demo-db'));
    return [t.getColumns().map(c => c.getField()).join(','), JSON.stringify(db.lista_valores.find(v => v.codigo === 'remoto').extra)];
  });
  console.log(r, errs);
  await b.close();
})();
