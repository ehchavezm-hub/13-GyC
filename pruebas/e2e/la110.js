const { chromium } = require('playwright');
const B = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = [], fallas = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  const lunes = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); });
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1200);
  // Por defecto: semana siguiente
  await p.goto(B + '?demo&a=1#/lookahead'); await p.waitForTimeout(1800);
  console.log('  por defecto:', (await p.locator('.pagina-sub').innerText()), '·', await p.locator('[data-a="comprometer"]').innerText());
  // Configuración → Parámetros: lunes, la misma semana
  await p.goto(B + '?demo&a=2#/config/parametros'); await p.waitForTimeout(1500);
  const casillas = p.locator('[data-name="la_dias"] input[type="checkbox"]');
  console.log('  casillas de días:', await casillas.count());
  chk(await casillas.count() === 7 && await p.locator('[name="la_semana"]').count() === 1, 'Configuración → Parámetros: 7 casillas de días y Semana que planifica');
  for (let i = 0; i < 7; i++) { const c = casillas.nth(i); const v = await c.getAttribute('value'); if (['1', '2'].includes(v) !== await c.isChecked()) await c.click(); }
  await p.selectOption('[name="la_semana"]', 'actual');
  await p.click('button:has-text("Guardar parámetros")'); await p.waitForTimeout(1200);
  // Look Ahead
  await p.goto(B + '?demo&a=3#/lookahead'); await p.waitForTimeout(2000);
  const grupos = await p.$$eval('.tabulator-group', g => g.map(x => x.textContent.slice(0, 22)));
  const sub = await p.locator('.pagina-sub').innerText();
  console.log('  configurado:', sub, '· grupos:', grupos.join(' | '));
  const etq = await p.evaluate(l => { const [y, m, d] = l.split('-'); return `${d}/${m}`; }, lunes);
  chk(sub.includes(etq), `Look Ahead empieza en la semana actual (${etq})`);
  const btn = await p.locator('[data-a="comprometer"]').innerText();
  chk(btn.includes('Comprometer S-'), 'botón: ' + btn);
  const aviso = await p.locator('[data-vista="la"] .aviso').innerText();
  chk(/lunes y martes/.test(aviso) && /misma semana/.test(aviso), 'aviso: ' + aviso.slice(-130));
  // Fila nueva en el Look Ahead: semana actual
  await p.click('button:has-text("Fila")'); await p.waitForTimeout(600);
  const semNueva = await p.evaluate(() => { const t = Tabulator.findTable('[data-grilla] .tabulator')[0] || Tabulator.findTable('[data-grilla]')[0]; return t.getData().find(r => !r.id)?.semana; });
  chk(semNueva === lunes, 'fila nueva del Look Ahead en la semana actual: ' + semNueva);
  // Plan: lo agregado hoy (día de registro) es programado
  await p.goto(B + '?demo&a=4#/plan'); await p.waitForTimeout(1800);
  await p.click('button:has-text("Fila")'); await p.waitForTimeout(600);
  const tipo = await p.evaluate(() => { const t = Tabulator.findTable('[data-grilla] .tabulator')[0] || Tabulator.findTable('[data-grilla]')[0]; return t.getData().find(r => !r.id)?.tipo; });
  const diaHoy = await p.evaluate(() => ((new Date().getDay() + 6) % 7) + 1);
  chk(diaHoy > 2 ? tipo === 'no_programada' : tipo === 'programada', `Plan: compromiso nuevo hoy = ${tipo} (día ${diaHoy}, registro lunes y martes)`);
  const guardado = await p.evaluate(() => JSON.parse(localStorage.getItem('lpsgt-demo-db')).parametros.find(x => x.clave === 'look_ahead')?.valor);
  chk(JSON.stringify(guardado) === JSON.stringify({ dias: [1, 2], semana: 'actual' }), 'guardado: ' + JSON.stringify(guardado));
  // Reportes: Look Ahead con las mismas semanas
  await p.goto(B + '?demo&a=5#/reportes'); await p.waitForTimeout(1500);
  await p.click('[data-r="lookahead"]'); await p.waitForTimeout(1500);
  const h2 = await p.evaluate(() => [...document.querySelector('[data-prev]').contentDocument.querySelectorAll('h2')].map(x => x.textContent.slice(0, 22)));
  chk(h2[0]?.includes(etq), 'Reporte Look Ahead empieza en la semana actual: ' + h2[0]);
  // Reunión: compromisos de la semana actual
  await p.goto(B + '?demo&a=6#/reunion'); await p.waitForTimeout(1800);
  const subR = await p.locator('.pagina-sub').innerText();
  chk(subR.includes('compromisos ' + 'S-'), 'Reunión: ' + subR);
  console.log(fallas.length ? 'FALLAS: ' + fallas.length : 'TODO OK');
  console.log(errs.length ? errs : 'SIN ERRORES'); await b.close();
})();
