// Página en blanco para los documentos que se implementarán después (Plan de gestión, Plan de construcción,
// Programa de cierre). Muestra solo el título de la sección.
import { esc, html } from '../core/util.js';
import { nombreSeleccion } from '../core/store.js';

export const pagina = titulo => ({
  render(el) {
    el.innerHTML = '';
    const proy = nombreSeleccion();
    el.append(html(`<div><div class="pagina-cab"><h1>${esc(titulo)}</h1>${proy ? `<span class="proy-badge">${esc(proy)}</span>` : ''}</div></div>`));
  },
});
