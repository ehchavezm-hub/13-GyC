const { chromium } = require('playwright');
const B = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = [], fallas = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  const titulos = () => p.$$eval('.tabulator-col[tabulator-field] .tabulator-col-title', t => t.filter(x => x.offsetParent).map(x => x.textContent.trim()).filter(Boolean));
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  // 43 / 49: usuarios con Cargo; Código a la derecha de Nombre
  await p.goto(B + '?demo&a=1#/config/usuarios'); await p.waitForTimeout(1500);
  const th = await p.$$eval('table.simple tr:first-child th', t => t.map(x => x.textContent.trim()));
  chk(th[0] === 'Nombre' && th[1] === 'Código' && th.includes('Cargo'), '43/49 Usuarios: ' + th.slice(0, 4).join(' | '));
  // 26/27/30/51: lista CET / Servicio = Proyecto | CET | Servicio, sin Descripción ni Color
  await p.goto(B + '?demo&a=2#/config/listas?lista=servicios'); await p.waitForTimeout(1500);
  const cs = await titulos();
  chk(cs.join('|').startsWith('Proyecto|CET|Servicio') && !cs.includes('Descripción') && !cs.includes('Color') && !cs.includes('Código CET'), '26/27/30/51 lista: ' + cs.join(' | '));
  // 52/53/72: Plan y LA → CET a la izquierda de Servicio; Semana a la derecha... (orden de la grilla)
  for (const r of ['plan', 'lookahead']) {
    await p.goto(B + '?demo&a=' + r + '#/' + r); await p.waitForTimeout(1800);
    const t = await titulos(); const i = t.indexOf('CET');
    chk(i >= 0 && t[i + 1] === 'Servicio' && !t.includes('CET / Servicio') && !t.includes('Resp. 2'), `47/52 ${r}: ${t.slice(0, 8).join(' | ')}`);
    chk(t.indexOf('Semana') >= 0 && t.indexOf('Semana') < t.indexOf('Resp. 1'), `50/53 ${r}: Semana junto a Resp. 1 (${t.indexOf('Semana')} → ${t.indexOf('Resp. 1')})`);
  }
  // 48: la cabecera del periodo empieza en lunes, y el periodo cambia al navegar
  await p.goto(B + '?demo&a=3#/plan'); await p.waitForTimeout(1500);
  for (const paso of ['inicio', 'sig', 'sig', 'ant', 'hoy']) {
    if (paso !== 'inicio') { await p.click(`[data-a="${paso}"]`); await p.waitForTimeout(1200); }
    const cab = await p.textContent('[data-semana]');
    const m = cab.match(/(\d\d)\/(\d\d)/); const d = new Date(new Date().getFullYear(), +m[2] - 1, +m[1]);
    chk(d.getDay() === 1, `48 periodo (${paso}): "${cab.trim()}" empieza en lunes`);
  }
  // 32/35: tres ventanas Activos, En pausa, Cerrados; al cambiar el estado el proyecto cambia de ventana
  await p.goto(B + '?demo&a=4#/config/listas?lista=__proyectos'); await p.waitForTimeout(2000);
  const v = await p.$$eval('[data-ventana]', s => s.filter(x => x.offsetParent).map(x => x.dataset.ventana));
  chk(v.join(',') === 'activo,en_pausa,cerrado', '32/35 ventanas visibles: ' + v.join(','));
  const antes = await p.evaluate(() => Tabulator.findTable('[data-grilla="cerrado"] .tabulator')[0]?.getDataCount() ?? Tabulator.findTable('[data-grilla="cerrado"]')[0]?.getDataCount());
  const celda = p.locator('[data-grilla="activo"] .tabulator-row').first().locator('[tabulator-field="estado"]');
  await celda.dblclick(); await p.waitForTimeout(300);
  await p.locator('.tabulator-edit-list-item', { hasText: 'Cerrado' }).first().click(); await p.waitForTimeout(1500);
  const despues = await p.evaluate(() => (Tabulator.findTable('[data-grilla="cerrado"] .tabulator')[0] || Tabulator.findTable('[data-grilla="cerrado"]')[0]).getDataCount());
  chk(despues === antes + 1, `32 al pasar a Cerrado cambia de ventana (${antes} → ${despues})`);
  // 22/42: listas agrupadas; Proyectos solo en Configuración → Listas
  await p.goto(B + '?demo&a=5#/config/listas'); await p.waitForTimeout(1500);
  const g = await p.$$eval('[data-l] optgroup', gs => gs.map(x => x.label));
  const g0 = await p.$$eval('[data-l] optgroup:first-child option', o => o.map(x => x.value));
  chk(g.length >= 3 && g0.includes('__proyectos'), '22 grupos: ' + g.join(' | '));
  const nav = await p.$$eval('.lateral a, .lateral nav a', a => a.map(x => (x.getAttribute('href') || '')));
  chk(!nav.some(h => /#\/proyectos$/.test(h)), '42 sin Proyectos en el menú lateral');
  // 23/46: formulario (+) de proyecto sin CET, Tipo ni Líderes asignados
  await p.goto(B + '?demo&a=8#/config/listas?lista=__proyectos'); await p.waitForTimeout(1800);
  await p.locator('[data-a="nuevo"]').first().click(); await p.waitForTimeout(800);
  const etiquetas = await p.$$eval('.modal label', l => l.map(x => x.textContent.trim()));
  chk(!etiquetas.some(x => /^(CET|Tipo)\b|Líderes/.test(x)), '23/46 formulario: ' + etiquetas.filter(Boolean).slice(0, 10).join(' | '));
  await p.keyboard.press('Escape');
  // 26 (menú del título): Servicio abre su lista
  await p.goto(B + '?demo&a=6#/plan'); await p.waitForTimeout(1500);
  await p.click('.tabulator-col[tabulator-field] .tabulator-col-title:text-is("Servicio")', { button: 'right' }); await p.waitForTimeout(300);
  const item = p.locator('.tabulator-menu .tabulator-menu-item', { hasText: 'editar o eliminar' }).first();
  if (await item.count()) { await item.click(); await p.waitForTimeout(1300); }
  chk(p.url().includes('lista=servicios'), 'acceso desde el título Servicio a su lista: ' + p.url().split('#')[1]);
  // Ficha del proyecto: igual en pantalla y en PDF (sin Líderes)
  await p.goto(B + '?demo&a=7#/config/listas?lista=__proyectos'); await p.waitForTimeout(1800);
  const fichaLink = p.locator('[data-grilla="activo"] .tabulator-row').first().locator('text=Ficha').first();
  await fichaLink.click(); await p.waitForTimeout(1500);
  const datos = await p.$$eval('.tarjeta table.simple td:first-child', t => t.map(x => x.textContent));
  await p.locator('button:has-text("PDF")').first().click(); await p.waitForTimeout(1500);
  const pdf = await p.evaluate(() => [...document.querySelector('.vista-pdf iframe').contentDocument.querySelectorAll('td:first-child')].map(x => x.textContent));
  chk(!datos.includes('Líderes') && !pdf.includes('Líderes') && ['Gerencia', 'Fase', 'País', 'Fechas', 'Estado'].every(k => datos.includes(k) && pdf.includes(k)), 'ficha pantalla/PDF: ' + datos.join(',') + ' / ' + pdf.join(','));
  console.log(fallas.length ? 'FALLAS: ' + fallas.length : 'TODO OK');
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
