// Backlog del Grupo LPS: menú, columnas (en orden), registrar, restricciones, pasar al Look Ahead; sin tocar otros datos.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1800, height: 1000 }, serviceWorkers: 'block' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const fallas = []; const chk = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  const conteo = () => p.evaluate(async () => { const { api } = await import('./js/data/api.js');
    const t = ['actividades', 'cartera', 'restricciones', 'proyectos', 'lista_valores']; const r = {};
    for (const x of t) r[x] = (await api.list(x, {})).length; return r; });
  const ini = await p.evaluate(async () => {
    const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    const P = s.store.proyectos.find(x => !x.padre_id);
    const [G] = await api.insert('proyectos', { area_id: s.store.area.id, codigo: 'G-BKL', nombre_corto: 'LPS Gestión', estado: 'activo', padre_id: P.id });
    await s.cargarCatalogo(); s.seleccionarProyecto(G.id);
    return { G: G.id };
  });
  const antes = await conteo();
  await p.goto(B + '?demo#/backlog'); await p.waitForTimeout(2200);
  // Menú: «Backlog» justo debajo de «Look Ahead»
  const menu = (await p.locator('nav a, .nav-modulos a').allInnerTexts()).map(t => t.trim().replace(/^\S+\s*/, ''));
  const iLA = menu.findIndex(t => t.startsWith('Look Ahead'));
  chk(iLA >= 0 && menu[iLA + 1]?.startsWith('Backlog'), `menú: «Backlog» debajo de «Look Ahead» (${menu.slice(iLA, iLA + 2).join(' → ')})`);
  // Columnas en el orden aprobado
  const titulos = (await p.evaluate(() => [...document.querySelectorAll('[data-grilla] .tabulator-col')].filter(c => c.offsetParent !== null)
    .map(c => c.querySelector('.tabulator-col-title')?.innerText.trim() || ''))).filter(Boolean);
  const esperado = ['Prioridad', 'Resp. 1', 'Gerencia', 'Proyecto', 'CET', 'Servicio', 'Actividad', 'HH estimadas', 'F. requerida', 'Entra al LA en', 'Estado', '🚧', '💬', 'Comentario'];
  console.log('  columnas:', titulos.join(' | '));
  chk(JSON.stringify(titulos) === JSON.stringify(esperado), 'columnas y orden aprobados (sin Resp. 2, Semana, L–V ni Estado LA)');
  // Registrar un ítem
  await p.click('[data-a="nueva"]'); await p.waitForTimeout(500);
  await p.keyboard.type('Preparar informe mensual del grupo'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  const fila = p.locator('.tabulator-row', { hasText: 'Preparar informe mensual' });
  await fila.locator('[tabulator-field="_hh"]').dblclick(); await p.keyboard.type('10'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  await fila.locator('[tabulator-field="_prioridad"]').dblclick(); await p.waitForTimeout(300);
  await p.locator('.tabulator-edit-list-item', { hasText: 'Alta' }).first().click(); await p.waitForTimeout(400);
  const freq = await p.evaluate(async () => { const s = await import('./js/core/store.js'); return s.semanasLookAhead().at(-1); });
  await fila.locator('[tabulator-field="f_requerida"]').dblclick(); await p.waitForTimeout(300);
  await fila.locator('[tabulator-field="f_requerida"] input').fill(freq); await p.keyboard.press('Enter'); await p.waitForTimeout(1800);
  const item = await p.evaluate(async () => (await (await import('./js/data/api.js')).api.list('cartera', {})).find(c => c.descripcion === 'Preparar informe mensual del grupo'));
  chk(item && item.proyecto_id === ini.G && item.extra?.hh_estimadas === 10 && item.extra?.prioridad === 'alta' && item.origen === 'interna',
    `ítem guardado en el Grupo LPS con HH 10 y prioridad Alta (${JSON.stringify(item?.extra)})`);
  console.log('  fila:', (await fila.innerText()).replace(/\s+/g, ' ').slice(0, 160));
  chk(/En backlog/.test(await fila.innerText()), 'estado «En backlog»');
  chk(/S-\d+/.test(await fila.locator('[tabulator-field="_entra"]').innerText()), '«Entra al LA en» muestra la semana sugerida');
  // Restricción conocida
  await fila.locator('[tabulator-field="_restr"] button').click(); await p.waitForTimeout(400);
  await p.click('.modal-pie button:has-text("Nueva restricción")'); await p.waitForTimeout(400);
  await p.locator('.modal').last().locator('[name="descripcion"]').fill('Falta información del cliente');
  await p.locator('.modal').last().locator('.modal-pie .btn-primario').click(); await p.waitForTimeout(800);
  await p.locator('.modal-pie button:has-text("Cerrar")').first().click(); await p.waitForTimeout(800);
  // Pasar al Look Ahead
  await p.click('[data-a="pasar"]'); await p.waitForTimeout(500);
  await p.locator('.modal tr', { hasText: 'Preparar informe mensual' }).locator('input[type=checkbox]').check();
  await p.click('.modal-pie button:has-text("Crear en el Look Ahead")'); await p.waitForTimeout(1800);
  const r = await p.evaluate(async id => { const { api } = await import('./js/data/api.js');
    const a = (await api.list('actividades', {})).find(x => x.cartera_id === id);
    const rs = (await api.list('restricciones', {})).filter(x => x.extra?.cartera_id === id);
    return a && { grupo: a.proyecto_id, hh: a.hh_total, estado_la: a.estado_la, rest: rs.map(x => x.actividad_id === a.id) }; }, item.id);
  console.log('  actividad creada:', JSON.stringify(r));
  chk(r && r.grupo === ini.G && Number(r.hh) === 10, 'pasa al Look Ahead en el mismo Grupo LPS con las 10 HH repartidas');
  chk(r && r.rest.length === 1 && r.rest[0] && r.estado_la === 'con_restriccion', 'su restricción pasa a la actividad (Estado LA «Con restricción»)');
  await p.waitForTimeout(800);
  chk(/En Look Ahead/.test(await p.locator('.tabulator-row', { hasText: 'Preparar informe mensual' }).innerText()), 'el ítem queda «En Look Ahead»');
  const despues = await conteo();
  console.log('  conteos:', JSON.stringify(antes), '→', JSON.stringify(despues));
  chk(despues.actividades === antes.actividades + 1 && despues.cartera === antes.cartera + 1 && despues.restricciones === antes.restricciones + 1
    && despues.proyectos === antes.proyectos && despues.lista_valores === antes.lista_valores, 'solo se agregan los registros nuevos; nada más cambia');
  console.log(errs.length || fallas.length ? ['ERRORES', ...errs, ...fallas] : 'SIN ERRORES');
  await b.close();
})();
