/**
 * Roles del equipo de una empresa y qué secciones puede usar cada uno.
 * El frontend tiene una copia de esta tabla para armar el menú; aquí es donde se hace cumplir.
 */
export const ROLES = {
  admin: { nombre: 'Administrador', descripcion: 'Todo: equipo, empresa, bots, cobros y bitácora.' },
  editor: { nombre: 'Editor', descripcion: 'Arma bots, catálogo, campañas y atiende pedidos y conversaciones.' },
  cajero: { nombre: 'Cajero', descripcion: 'Pedidos, cobros, inventario y conversaciones.' },
  recepcion: { nombre: 'Recepción', descripcion: 'Agenda, conversaciones y módulos (órdenes, expedientes...).' },
  repartidor: { nombre: 'Repartidor', descripcion: 'Solo ve los pedidos que le asignan y los marca como entregados.' },
};

export const CLAVES_ROL = Object.keys(ROLES);

/** Sección → roles que la pueden usar (admin siempre). */
export const PERMISOS = {
  bots: ['editor'],
  catalogo: ['editor', 'cajero'],
  pedidos: ['editor', 'cajero', 'recepcion', 'repartidor'],
  agenda: ['editor', 'recepcion'],
  conversaciones: ['editor', 'cajero', 'recepcion'],
  campanas: ['editor'],
  gestion: ['editor', 'cajero', 'recepcion'],
  modulos: ['editor', 'cajero', 'recepcion'],
  reportes: ['editor', 'cajero'],
  inventario: ['editor', 'cajero'],
  sucursales: ['editor', 'cajero', 'recepcion', 'repartidor'],
};

export function puede(rol, seccion) {
  if (rol === 'admin') return true;
  return (PERMISOS[seccion] ?? []).includes(rol);
}

/** El repartidor solo mueve sus pedidos entre estos estados. */
export const ESTADOS_REPARTIDOR = ['enviado', 'entregado'];
