// Auditoría 3: «Desde la cartera» deja la actividad en el Grupo LPS elegido (con el proyecto de la cartera como proyecto
// atendido) y borrar el Proyecto de una fila borra también su CET.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1700, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const fallas = []; const chk = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  const ini = await p.evaluate(async () => {
    const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    const [P, Q] = s.store.proyectos.filter(x => !x.padre_id);
    const [G] = await api.insert('proyectos', { area_id: s.store.area.id, codigo: 'G-AUD3', nombre_corto: 'LPS Aud3', estado: 'activo', padre_id: P.id });
    const serv = s.valoresLista('servicios');
    await api.update('lista_valores', serv[0].id, { codigo: 'CET-Q', extra: { ...(serv[0].extra || {}), proyecto_id: Q.id } });
    await api.insert('cartera', { area_id: s.store.area.id, descripcion: 'Solicitud aud3', proyecto_id: Q.id, responsable_id: s.store.usuario.id, estado: 'abierta', tipo_id: null });
    const lunes = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7); return d.toISOString().slice(0, 10); })();
    for (const t of ['Con CET aud3', 'Supr proyecto aud3', 'Supr CET aud3', 'Servicio aud3'])
      await api.insert('actividades', { area_id: s.store.area.id, proyecto_id: G.id, servicio_id: serv[0].id, descripcion: t, semana: lunes, responsable_id: s.store.usuario.id });
    await s.cargarCatalogo(); s.seleccionarProyecto(G.id);
    return { G: G.id, Q: Q.id, Qtxt: Q.codigo + ' · ' + Q.nombre_corto, total: (await api.list('actividades', {})).length };
  });
  await p.goto(B + '?demo#/lookahead'); await p.waitForTimeout(2200);
  // Desde la cartera
  await p.click('button:has-text("Desde la cartera")'); await p.waitForTimeout(600);
  await p.locator('.modal tr', { hasText: 'Solicitud aud3' }).locator('input[type=checkbox]').check();
  await p.click('.modal-pie button:has-text("Crear actividades")'); await p.waitForTimeout(1500);
  const a = await p.evaluate(async () => { const { api } = await import('./js/data/api.js'); return (await api.list('actividades', {})).find(x => x.descripcion === 'Solicitud aud3'); });
  chk(a && a.proyecto_id === ini.G && a.extra?.proyecto_id === ini.Q, 'desde la cartera: queda en el Grupo LPS elegido y con el proyecto de la cartera como Proyecto');
  const fila = t => p.locator('.tabulator-row', { hasText: t });
  chk((await fila('Solicitud aud3').count()) === 1 && (await fila('Solicitud aud3').locator('[tabulator-field="_proyecto"]').innerText()).includes(ini.Qtxt), 'y se ve en el Look Ahead del grupo con su Proyecto');
  // Borrar el Proyecto de una fila con CET: se borra también su CET (si no, el proyecto «volvería»)
  const c = fila('Con CET aud3').locator('[tabulator-field="_proyecto"]');
  await c.dblclick(); await p.waitForTimeout(400); await p.locator('.tabulator-edit-list-item').first().click(); await p.waitForTimeout(1500);
  const x = await p.evaluate(async () => { const { api } = await import('./js/data/api.js'); return (await api.list('actividades', {})).find(r => r.descripcion === 'Con CET aud3'); });
  chk(x && !!x.servicio_id && x.extra?.proyecto_id === null && !(await c.innerText()).trim().replace('—', ''), 'r1: borrar el Proyecto lo deja vacío y conserva el CET');
  // Tecla Supr sobre Proyecto y sobre CET
  const leer = t => p.evaluate(async t => { const { api } = await import('./js/data/api.js'); return (await api.list('actividades', {})).find(r => r.descripcion === t); }, t);
  await fila('Supr proyecto aud3').locator('[tabulator-field="_proyecto"]').click(); await p.keyboard.press('Delete'); await p.waitForTimeout(1500);
  let y = await leer('Supr proyecto aud3');
  chk(y && !!y.servicio_id && y.extra?.proyecto_id === null, 'Supr en Proyecto: se guarda vacío (el CET se conserva)');
  await fila('Supr CET aud3').locator('[tabulator-field="_cet"]').click(); await p.keyboard.press('Delete'); await p.waitForTimeout(1500);
  y = await leer('Supr CET aud3');
  chk(y && !y.servicio_id && y.extra?.proyecto_id === ini.Q, 'Supr en CET: se guarda vacío y la fila conserva el proyecto que mostraba');
  // Cambiar el Servicio (columna Servicio) en una fila anterior a r1: el Proyecto que mostraba se conserva
  await fila('Servicio aud3').locator('[tabulator-field="servicio_id"]').dblclick(); await p.waitForTimeout(400);
  await p.locator('.tabulator-edit-list-item').nth(3).click(); await p.waitForTimeout(1500);
  y = await leer('Servicio aud3');
  chk(y && y.extra?.proyecto_id === ini.Q && (await fila('Servicio aud3').locator('[tabulator-field="_proyecto"]').innerText()).includes(ini.Qtxt), 'r1: cambiar el Servicio no cambia el Proyecto');
  await p.goto(B + '?demo#/lookahead'); await p.waitForTimeout(2000);
  chk(!(await fila('Supr CET aud3').locator('[tabulator-field="_cet"]').innerText()).replace('—', '').trim(), 'y sigue vacío al recargar');
  const fin = await p.evaluate(async () => (await (await import('./js/data/api.js')).api.list('actividades', {})).length);
  chk(fin === ini.total + 1, `sin pérdidas (actividades ${fin} = ${ini.total} + 1 creada desde la cartera)`);
  console.log(errs.length || fallas.length ? ['ERRORES', ...errs, ...fallas] : 'SIN ERRORES');
  await b.close();
})();
