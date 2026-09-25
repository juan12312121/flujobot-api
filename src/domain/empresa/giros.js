/**
 * Tipos de negocio. El giro solo pone valores de arranque (términos, módulos, colores, plantilla):
 * después cada empresa cambia lo que quiera desde "Mi empresa".
 */
const TERMINOS_BASE = {
  item: 'Producto',
  items: 'Productos',
  pedido: 'Pedido',
  pedidos: 'Pedidos',
  cita: 'Cita',
  citas: 'Citas',
  cliente: 'Cliente',
  clientes: 'Clientes',
};

export const GIROS = {
  tienda: {
    nombre: 'Tienda / comercio',
    terminos: {},
    modulos: { catalogo: true, pedidos: true, agenda: false },
    color: '#12a150',
    plantilla: 'tienda',
  },
  restaurante: {
    nombre: 'Restaurante / comida',
    terminos: { item: 'Platillo', items: 'Menú', pedido: 'Orden', pedidos: 'Órdenes', cita: 'Reservación', citas: 'Reservaciones' },
    modulos: { catalogo: true, pedidos: true, agenda: true },
    color: '#ea580c',
    plantilla: 'tienda',
  },
  belleza: {
    nombre: 'Salón, barbería o spa',
    terminos: { item: 'Servicio', items: 'Servicios' },
    modulos: { catalogo: true, pedidos: false, agenda: true },
    color: '#db2777',
    plantilla: 'citas',
  },
  salud: {
    nombre: 'Consultorio / salud',
    terminos: { item: 'Servicio', items: 'Servicios', cita: 'Consulta', citas: 'Consultas', cliente: 'Paciente', clientes: 'Pacientes' },
    modulos: { catalogo: true, pedidos: false, agenda: true },
    color: '#0891b2',
    plantilla: 'citas',
  },
  servicios: {
    nombre: 'Servicios profesionales / taller',
    terminos: { item: 'Servicio', items: 'Servicios', pedido: 'Solicitud', pedidos: 'Solicitudes' },
    modulos: { catalogo: true, pedidos: true, agenda: true },
    color: '#2563eb',
    plantilla: 'citas',
  },
  educacion: {
    nombre: 'Escuela / cursos',
    terminos: { item: 'Curso', items: 'Cursos', pedido: 'Inscripción', pedidos: 'Inscripciones', cliente: 'Alumno', clientes: 'Alumnos' },
    modulos: { catalogo: true, pedidos: true, agenda: false },
    color: '#7c3aed',
    plantilla: 'prospectos',
  },
  inmobiliaria: {
    nombre: 'Inmobiliaria',
    terminos: { item: 'Propiedad', items: 'Propiedades', pedido: 'Prospecto', pedidos: 'Prospectos', cita: 'Visita', citas: 'Visitas' },
    modulos: { catalogo: true, pedidos: true, agenda: true },
    color: '#b45309',
    plantilla: 'prospectos',
  },
  otro: {
    nombre: 'Otro',
    terminos: { pedido: 'Solicitud', pedidos: 'Solicitudes' },
    modulos: { catalogo: true, pedidos: true, agenda: true },
    color: '#475569',
    plantilla: 'informacion',
  },
};

/** Configuración inicial de una empresa nueva según su giro. */
export function configuracionInicial(giro = 'otro') {
  const g = GIROS[giro] ?? GIROS.otro;
  return {
    giro: GIROS[giro] ? giro : 'otro',
    terminos: { ...TERMINOS_BASE, ...g.terminos },
    modulos: { ...g.modulos },
    marca: { colorPrimario: g.color, colorMenu: '#0f1b17', logoUrl: '' },
    horario: { dias: [1, 2, 3, 4, 5, 6], apertura: '09:00', cierre: '19:00', intervaloMin: 30, capacidad: 1 },
    zonaHoraria: 'America/Mexico_City',
  };
}

export const plantillaDeGiro = (giro) => GIROS[giro]?.plantilla ?? 'informacion';
