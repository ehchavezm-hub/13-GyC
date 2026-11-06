const { chromium } = require('playwright');
const SH = require('path').join(__dirname, 'salida') + '/' + '';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo#/tablero'); await p.waitForTimeout(1500);
  const ids = await p.evaluate(async () => {
    const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    const area = s.store.area.id;
    const [f] = await api.insert('portafolios', { area_id: area, nombre: 'GT_POR', estado: 'activo' });
    const [g] = await api.insert('programas', { area_id: area, nombre: 'GT_PROG', portafolio_id: f.id, estado: 'activo' });
    const [g2] = await api.insert('programas', { area_id: area, nombre: 'OTRO_PROG', portafolio_id: f.id, estado: 'activo' });
    const ps = s.store.proyectos;
    const P = ps.find(x => x.nombre_corto === 'Hospital Demo Norte'), Q = ps.find(x => x.nombre_corto === 'Puente Demo Río Azul'), R = ps.find(x => x.nombre_corto === 'Planta Concentradora Demo');
    await api.update('proyectos', P.id, { portafolio_id: f.id, programa_id: g.id });
    await api.update('proyectos', Q.id, { portafolio_id: f.id, programa_id: g2.id });
    const [S] = await api.insert('proyectos', { area_id: area, codigo: 'D-101.1', nombre_corto: 'Gestion', estado: 'activo', padre_id: P.id, portafolio_id: f.id, programa_id: g.id });
    // la mitad de las actividades (semanas abiertas) del proyecto pasan al Grupo LPS
    const acts = await api.list('actividades', { eq: { proyecto_id: P.id } });
    let n = 0; for (const a of acts) { try { await api.update('actividades', a.id, { proyecto_id: S.id }); n++; } catch {} }
    await s.cargarCatalogo();
    return { f: f.id, g: g.id, P: P.id, S: S.id, R: R.id, movidas: n };
  });
  const contar = clave => p.evaluate(async ({ clave, ids }) => {
    const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    if (clave === 'empresa') s.seleccionarProyecto(''); else if (clave === 'S' || clave === 'P') s.seleccionarProyecto(ids[clave]); else s.seleccionarNivel(clave + ':' + ids[clave]);
    const acts = await api.list('actividades', { eq: { area_id: s.store.area.id } });
    return { actividades: acts.filter(a => s.enProyectoSel(a.proyecto_id)).length, nombre: s.nombreSeleccion() || 'Empresa (todo)' };
  }, { clave, ids });
  console.log('actividades movidas al Grupo LPS:', ids.movidas);
  const r = {};
  for (const k of ['S', 'P', 'g', 'f', 'empresa']) { r[k] = await contar(k); console.log(k.padEnd(8), r[k].nombre.padEnd(34), r[k].actividades); }
  console.log('agregación de abajo hacia arriba (S ≤ P ≤ Programa ≤ Portafolio ≤ Empresa):',
    r.S.actividades > 0 && r.S.actividades <= r.P.actividades && r.P.actividades <= r.g.actividades && r.g.actividades <= r.f.actividades && r.f.actividades <= r.empresa.actividades);
  // en la pantalla: árbol y Tablero con el programa elegido
  await p.goto(B + '?demo#/tablero'); await p.waitForTimeout(1500);
  await p.locator('.proy-lista [data-nivel^="g:"] .nom').first().click(); await p.waitForTimeout(1500);
  console.log('rama activa:', await p.locator('.proy-lista .arbol-rama.activo').innerText().catch(() => '—'));
  console.log('filtro en Tablero:', await p.locator('#contenido [data-proy]').innerText());
  // la flecha solo abre/cierra (no cambia la selección)
  await p.locator('.proy-lista [data-nivel^="f:"] .arbol-flecha').first().click(); await p.waitForTimeout(300);
  console.log('tras la flecha sigue elegido:', await p.evaluate(async () => (await import('./js/core/store.js')).nombreSeleccion()));
  await p.locator('.proy-lista [data-nivel^="f:"] .arbol-flecha').first().click(); await p.waitForTimeout(300);
  const lat = await p.locator('.menu-proy').boundingBox();
  await p.screenshot({ path: SH + 'q5_menu.png', clip: { x: lat.x, y: lat.y, width: lat.width, height: 380 } });
  for (const v of ['plan', 'lookahead', 'restricciones', 'cartera', 'reportes']) { await p.evaluate(h => { location.hash = h; }, '#/' + v); await p.waitForTimeout(1200); }
  console.log('filtro en Plan:', await p.evaluate(() => { location.hash = '#/plan'; return new Promise(r => setTimeout(() => r(document.querySelector('#contenido [data-proy]')?.innerText), 1200)); }));
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
