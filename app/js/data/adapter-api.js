// Stub — implementación completa en Task 7.
export function crearAdaptadorApi(_apiBase) {
  const ne = m => () => Promise.reject(new Error(m || 'Adaptador API aún no implementado.'));
  return {
    list: ne(), insert: ne(), upsert: ne(), update: ne(), updateWhere: ne(),
    remove: ne(), removeWhere: ne(), rpc: ne(), adminUsuarios: ne(), fijarArea: ne(),
    subscribe: () => () => {},
    auth: {
      alCambiar: () => () => {},
      usuario: ne(),
      ingresar: ne(),
      registrar: ne(),
      recuperar: ne(),
      cambiarClave: ne(),
      salir: ne(),
    },
    reiniciar: () => {},
    usuariosDemo: () => [],
  };
}
