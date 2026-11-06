// Plan semanal: los indicadores siguen el filtro «Resp. 1» del título de la columna (solo esa persona).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1700, height: 1000 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const fallas = []; const chk = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo#/plan'); await p.waitForTimeout(2200);
  const kpi = async t => (await p.locator('[data-kpis] .kpi', { hasText: t }).first().innerText()).replace(/\s+/g, ' ');
  const comp = async () => Number((await kpi('Comprometidas')).match(/Comprometidas (\d+)/i)?.[1]);
  const todos = await comp(); const capTodos = await kpi('Carga vs capacidad');
  const filas = async () => p.locator('[data-grilla] .tabulator-row:not(.tabulator-calcs):not(.tabulator-group)').count();
  console.log('  todo el equipo:', todos, '·', capTodos);
  // Filtro «Resp. 1» en el título de la columna
  const sel = p.locator('[data-grilla] .tabulator-col[tabulator-field="responsable_id"] select');
  const opciones = await sel.locator('option').allInnerTexts();
  await sel.selectOption({ index: 1 }); await p.waitForTimeout(800);
  const una = await comp(); const capUna = await kpi('Carga vs capacidad'); const n = await filas();
  console.log(`  filtrado por ${opciones[1]}:`, una, '·', capUna, '· filas', n);
  chk(una < todos && una === n, `los indicadores muestran solo a ${opciones[1]} (${una} de ${todos}; ${n} filas en la grilla)`);
  chk(capUna !== capTodos, 'la carga vs capacidad también es solo de esa persona');
  await sel.selectOption({ index: 0 }); await p.waitForTimeout(800);
  chk(await comp() === todos, 'al quitar el filtro vuelven los indicadores de todo el equipo');
  console.log(errs.length || fallas.length ? ['ERRORES', ...errs, ...fallas] : 'SIN ERRORES');
  await b.close();
})();
