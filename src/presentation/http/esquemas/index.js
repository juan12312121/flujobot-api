import { z } from 'zod';
import { TIPOS_DE_NODO } from '../../../domain/flujo/tiposDeNodo.js';
import { PLANTILLAS } from '../../../domain/flujo/plantillas.js';
import { GIROS } from '../../../domain/empresa/giros.js';

const texto = (max = 200) => z.string().trim().min(1, 'Requerido').max(max);
const email = z.string().trim().toLowerCase().email('Correo inválido');
const password = z.string().min(8, 'Mínimo 8 caracteres').max(100);
const booleano = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

const giro = z.enum(Object.keys(GIROS));
const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Color en formato #RRGGBB');
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora en formato HH:MM');
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD');
const zonaValida = (z_) => {
  try {
    new Intl.DateTimeFormat('es', { timeZone: z_ });
    return true;
  } catch {
    return false;
  }
};

export const auth = {
  registro: z.object({
    empresa: texto(80),
    nombre: texto(80),
    email,
    password,
    moneda: z.string().length(3).toUpperCase().default('MXN'),
    giro: giro.default('otro'),
  }),
  login: z.object({ email, password: z.string().min(1) }),
};

export const usuarios = {
  crear: z.object({ nombre: texto(80), email, password, rol: z.enum(['admin', 'editor']).default('editor') }),
};

const producto = z.object({
  nombre: texto(120),
  descripcion: z.string().max(500).default(''),
  tipo: z.enum(['producto', 'servicio']).default('producto'),
  precio: z.coerce.number().min(0).max(10_000_000),
  precioDesde: z.boolean().default(false),
  duracionMin: z.coerce.number().int().min(5).max(1440).nullable().default(null),
  categoria: z.string().trim().max(60).default(''),
  imagenUrl: z.union([z.string().url('URL inválida'), z.literal('')]).default(''),
  sku: z.string().trim().max(60).default(''),
  activo: z.boolean().default(true),
  orden: z.coerce.number().int().default(0),
});

export const productos = {
  crear: producto,
  editar: producto.partial().refine((o) => Object.keys(o).length > 0, 'Nada que cambiar'),
  filtro: z.object({ texto: z.string().max(80).optional(), categoria: z.string().max(60).optional(), activos: booleano.optional() }),
};

const nodo = z.object({
  id: z.string().min(1).max(64),
  tipo: z.enum(Object.keys(TIPOS_DE_NODO)),
  datos: z.record(z.any()).default({}),
  posicion: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
});
const conexion = z.object({
  id: z.string().max(64).optional(),
  origen: z.string().min(1).max(64),
  puerto: z.string().min(1).max(80),
  destino: z.string().min(1).max(64),
  vertices: z.array(z.object({ x: z.number(), y: z.number() })).max(20).optional(),
});

const definicion = z.object({ nodos: z.array(nodo).max(300), conexiones: z.array(conexion).max(600) });

export const bots = {
  crear: z.object({
    nombre: texto(60),
    descripcion: z.string().max(300).default(''),
    plantilla: z.enum(Object.keys(PLANTILLAS)).optional(),
    /** Flujo ya armado (p. ej. el que propuso el asistente de IA); tiene prioridad sobre la plantilla. */
    flujo: definicion.optional(),
  }),
  editar: z
    .object({ nombre: texto(60), descripcion: z.string().max(300), telefono: z.string().max(20) })
    .partial()
    .refine((o) => Object.keys(o).length > 0, 'Nada que cambiar'),
  flujo: definicion,
  simular: z.object({ texto: z.string().min(1).max(1000), nombre: z.string().max(60).optional() }),
  resultados: z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }),
};

export const conversaciones = {
  filtro: z.object({ botId: z.string().regex(/^[0-9a-f]{24}$/i).optional(), estado: z.enum(['activa', 'terminada', 'humano']).optional() }),
};

export const pedidos = {
  filtro: z.object({
    estado: z.enum(['nuevo', 'confirmado', 'enviado', 'entregado', 'cancelado']).optional(),
    botId: z.string().regex(/^[0-9a-f]{24}$/i).optional(),
  }),
  estado: z.object({ estado: z.enum(['nuevo', 'confirmado', 'enviado', 'entregado', 'cancelado']) }),
};

const TERMINOS = ['item', 'items', 'pedido', 'pedidos', 'cita', 'citas', 'cliente', 'clientes'];

export const empresa = {
  editar: z
    .object({
      nombre: texto(80),
      giro,
      aplicarGiro: z.boolean(),
      moneda: z.string().length(3).toUpperCase(),
      zonaHoraria: z.string().refine(zonaValida, 'Zona horaria desconocida'),
      conocimiento: z.string().max(8000, 'Máximo 8,000 caracteres'),
      marca: z.object({ colorPrimario: color, colorMenu: color, logoUrl: z.union([z.string().url('URL inválida'), z.literal('')]) }).partial(),
      terminos: z.object(Object.fromEntries(TERMINOS.map((t) => [t, texto(30)]))).partial(),
      modulos: z.object({ catalogo: z.boolean(), pedidos: z.boolean(), agenda: z.boolean() }).partial(),
      horario: z
        .object({
          dias: z.array(z.number().int().min(0).max(6)).max(7),
          apertura: hora,
          cierre: hora,
          intervaloMin: z.number().int().min(5).max(240),
          capacidad: z.number().int().min(1).max(50),
        })
        .partial(),
    })
    .partial()
    .refine((o) => Object.keys(o).length > 0, 'Nada que cambiar'),
};

const ESTADOS_CITA = ['pendiente', 'confirmada', 'atendida', 'cancelada', 'no_asistio'];

export const citas = {
  filtro: z.object({
    desde: fecha.optional(),
    hasta: fecha.optional(),
    estado: z.enum(ESTADOS_CITA).optional(),
    botId: z.string().regex(/^[0-9a-f]{24}$/i).optional(),
  }),
  crear: z.object({
    fecha,
    hora,
    duracionMin: z.number().int().min(5).max(1440).optional(),
    nombreContacto: texto(80),
    contacto: z.string().max(20).default(''),
    servicio: z.string().max(120).default(''),
    notas: z.string().max(500).default(''),
  }),
  editar: z
    .object({ estado: z.enum(ESTADOS_CITA), notas: z.string().max(500) })
    .partial()
    .refine((o) => Object.keys(o).length > 0, 'Nada que cambiar'),
};

const accionTarea = z.object({ tipo: z.enum(['correo', 'hoja', 'http']) }).passthrough();

export const asistente = {
  generar: z.object({
    descripcion: z.string().trim().min(10, 'Cuéntale un poco más al asistente').max(2000),
    base: definicion.optional(),
  }),
  tarea: z.object({
    descripcion: z.string().trim().min(10, 'Cuéntale un poco más al asistente').max(1500),
    base: definicion.optional(),
  }),
  publicarTarea: z.object({
    propuesta: z.object({
      nombre: z.string().trim().min(1).max(80),
      respuesta: z.string().max(500).default(''),
      acciones: z.array(accionTarea).min(1).max(4),
    }),
  }),
};

export const web = {
  configurar: z
    .object({ activo: z.boolean(), titulo: z.string().trim().max(60), saludo: z.string().trim().max(200) })
    .partial(),
  mensaje: z.object({
    /** Id que el globito genera y guarda en el navegador del visitante. */
    visitante: z.string().regex(/^[\w-]{8,64}$/, 'Visitante inválido'),
    texto: z.string().trim().min(1).max(1000),
    nombre: z.string().trim().max(60).optional(),
  }),
};
