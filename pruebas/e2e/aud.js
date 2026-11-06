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
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(1200);
  await p.click('.admin-item:has-text("Estructura de todas")'); await p.waitForTimeout(800);
  const padre = p.locator('.est-proyecto:has-text("Hospital Demo Norte")');
  for (const [cod, nom] of [['D-101.1', 'Torre A'], ['D-101.2', 'Torre B']]) {
    await padre.locator('[data-padre]').click(); await p.waitForTimeout(300);
    console.log('campos sub:', await p.locator('.modal [name]').evaluateAll(es => es.map(e => e.name).join(',')));
    await p.locator('.modal [name="codigo"]').fill(cod); await p.locator('.modal [name="nombre_corto"]').fill(nom);
    await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(700);
  }
  console.log('filas sub:', (await p.locator('.est-subproyecto').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 70)));
  await p.click('[data-vista="arbol"]'); await p.waitForTimeout(400);
  console.log('cajas sub organigrama:', await p.locator('.org-subproyecto').count());
  await p.screenshot({ path: SH + 'sub_organigrama.png' });
  // menú lateral
  // Mover las actividades del padre a "Torre A" (el LPS se registra en Grupos LPS)
  await p.goto(B + '?demo&a=2#/tablero'); await p.waitForTimeout(1500);
  const info = await p.evaluate(async () => {
    const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    const torre = s.store.proyectos.find(x => x.nombre_corto === 'Torre A');
    const padre = s.store.proyectos.find(x => x.nombre_corto === 'Hospital Demo Norte');
    const acts = await api.list('actividades', { eq: { proyecto_id: padre.id } });
    let n = 0; for (const a of acts) { try { await api.update('actividades', a.id, { proyecto_id: torre.id }); n++; } catch {} }
    const rests = await api.list('restricciones', { eq: { proyecto_id: padre.id } });
    for (const x of rests) await api.update('restricciones', x.id, { proyecto_id: torre.id });
    s.seleccionarProyecto(padre.id);
    return { movidas: n, de: acts.length, rests: rests.length, padre: padre.id, codigo: padre.codigo };
  });
  console.log('movidas al Grupo LPS:', info);
  await p.goto(B + '?demo&a=2#/tablero'); await p.waitForTimeout(1800);
  const kpis = async () => (await p.locator('#contenido .kpi').allInnerTexts()).map(t => t.replace(/\s+/g, ' ')).slice(0, 6).join(' | ');
  console.log('Tablero con padre elegido:', await kpis());
  await p.goto(B + '?demo&a=2#/reportes'); await p.waitForTimeout(1500);
  await p.goto(B + `?demo&a=2#/proyectos/${info.padre}`); await p.waitForTimeout(1500);
  console.log('Ficha del padre:', (await p.locator('#contenido').innerText()).replace(/\s+/g, ' ').slice(0, 400));
  // Eliminar el padre desde Proyectos: mensaje claro
  const msg = await p.evaluate(async () => {
    const s = await import('./js/core/store.js');
    return s.esContenedor(s.store.proyectos.find(x => x.nombre_corto === 'Hospital Demo Norte'));
  });
  console.log('padre es contenedor:', msg);
  await p.goto(B + `?demo&a=2#/proyectos/${info.padre}`); await p.waitForTimeout(1500);
  await p.locator('#contenido button:has-text("Eliminar")').first().click(); await p.waitForTimeout(400);
  for (let i = 0; i < 3 && await p.locator('.modal-pie .btn-peligro, .modal-pie .btn-primario').count(); i++) { await p.locator('.modal-pie .btn-peligro, .modal-pie .btn-primario').last().click(); await p.waitForTimeout(500); }
  console.log('aviso:', (await p.locator('.toast, .aviso, [class*=toast]').allInnerTexts()).join(' / ').slice(0, 200));
  console.log('padre sigue:', await p.evaluate(async () => !!(await import('./js/core/store.js')).store.proyectos.find(x => x.nombre_corto === 'Hospital Demo Norte')));
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
