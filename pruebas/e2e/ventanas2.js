const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (/FOCO|FOCUSIN/.test(m.text())) console.log('   ', m.text().slice(0, 600)); });
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) errs.push(m); };
  const en = e => p.evaluate(e => Tabulator.findTable(`[data-grilla="${e}"] .grilla-tabla`)[0].getData().map(r => r.codigo), e);
  const titulos = () => p.$$eval('.ventana-tit', t => t.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(BASE + '?demo#/config/listas?lista=__proyectos'); await p.waitForTimeout(1800);
  console.log('  ventanas:', (await titulos()).join(' | '));
  chk((await titulos()).map(t => t.replace(/ \d+$/, '')).join(',') === 'Activos,En pausa,Cerrados', 'tres ventanas visibles a la vez, en orden');
  // D-101 → En pausa
  await p.dblclick('[data-grilla="activo"] .tabulator-row:has(.tabulator-cell[tabulator-field="codigo"]:text-is("D-101")) .tabulator-cell[tabulator-field="estado"]'); await p.waitForTimeout(400);
  await p.click('.tabulator-edit-list-item:text-is("En pausa")'); await p.waitForTimeout(1500);
  chk(!(await en('activo')).includes('D-101') && (await en('en_pausa')).includes('D-101'), 'D-101 pasó de inmediato a En pausa');
  // D-102 → Cerrado
  await p.dblclick('[data-grilla="activo"] .tabulator-row:has(.tabulator-cell[tabulator-field="codigo"]:text-is("D-102")) .tabulator-cell[tabulator-field="estado"]'); await p.waitForTimeout(400);
  await p.click('.tabulator-edit-list-item:text-is("Cerrado")'); await p.waitForTimeout(1500);
  chk((await en('cerrado')).includes('D-102'), 'D-102 pasó a Cerrados');
  console.log('  ventanas:', (await titulos()).join(' | '));
  const db = await p.evaluate(() => JSON.parse(localStorage.getItem('lpsgt-demo-db')).proyectos.filter(x => ['D-101', 'D-102'].includes(x.codigo)).map(x => x.codigo + ':' + x.estado).join(','));
  chk(db === 'D-101:en_pausa,D-102:cerrado', 'estados guardados: ' + db);
  await p.evaluate(() => { const f = HTMLElement.prototype.focus; HTMLElement.prototype.focus = function (o) { if (this.closest?.('[data-grilla="cerrado"]')) console.log('FOCO cerrado ' + new Error().stack.split('\n').slice(2, 7).map(x => x.trim().replace(/http:\/\/localhost:8099\//, '')).join(' < ')); return f.call(this, o); };
    document.addEventListener('focusin', e => { if (e.target.closest?.('[data-grilla="cerrado"]')) console.log('FOCUSIN cerrado'); }, true); });
  // de En pausa a Activo
  await p.dblclick('[data-grilla="en_pausa"] .tabulator-row:has(.tabulator-cell[tabulator-field="codigo"]:text-is("D-101")) .tabulator-cell[tabulator-field="estado"]'); await p.waitForTimeout(400);
  console.log('  foco:', await p.evaluate(() => { const a = document.activeElement; return a.tagName + ' ' + (a.closest('[data-grilla]')?.dataset.grilla || a.className); }));
  console.log('  lista abierta:', await p.$$eval('.tabulator-edit-list-item', o => o.map(x => x.textContent).join(',')), '| editando:', await p.$$eval('.tabulator-editing', e => e.length));
  console.log('  editando:', JSON.stringify(await p.$$eval('.tabulator-editing', e => e.map(x => (x.closest('[data-grilla]')?.dataset.grilla || 'fuera') + ':' + x.className.slice(0, 50) + ':' + (x.closest('.tabulator-row')?.querySelector('[tabulator-field=codigo]')?.textContent || '')))));
  console.log('  popups:', JSON.stringify(await p.$$eval('.tabulator-edit-list, .tabulator-popup-container', e => e.map(x => [x.className, x.getBoundingClientRect().top|0, x.getBoundingClientRect().height|0, x.children.length, getComputedStyle(x).display]))));
  await p.waitForSelector('.tabulator-edit-list-item'); await p.click('.tabulator-edit-list-item:text-is("Activo")'); await p.waitForTimeout(1500);
  chk((await en('activo')).includes('D-101') && !(await en('en_pausa')).includes('D-101'), 'D-101 volvió a Activos');
  await p.screenshot({ path: 'shots3/ventanas.png', fullPage: true });
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
