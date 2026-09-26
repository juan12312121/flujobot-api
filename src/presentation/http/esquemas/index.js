import { z } from 'zod';
import { TIPOS_DE_NODO } from '../../../domain/flujo/tiposDeNodo.js';
import { PLANTILLAS } from '../../../domain/flujo/plantillas.js';
import { GIROS } from '../../../domain/empresa/giros.js';
import { USOS_IMAGEN } from '../../../application/use-cases/archivos/FirmarSubidaImagen.js';
import { ESTADOS_PEDIDO, CANALES } from '../../../domain/shared/catalogos.js';
import { SEGMENTOS } from '../../../application/services/Campanas.js';
import { TEXTOS_AVISO } from '../../../domain/avisos/textos.js';

const texto = (max = 200) => z.string().trim().min(1, 'Requerido').max(max);
const email = z.string().trim().toLowerCase().email('Correo inválido');
const password = z.string().min(8, 'Mínimo 8 caracteres').max(100);
const booleano = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);
const idMongo = z.string().regex(/^[0-9a-f]{24}$/i, 'Id inválido');
const urlOVacia = z.union([z.string().url('URL inválida'), z.literal('')]);

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
  filtro: z.object({
    botId: idMongo.optional(),
    estado: z.enum(['activa', 'terminada', 'humano']).optional(),
    canal: z.enum(CANALES.filter((c) => c !== 'simulador')).optional(),
  }),
  responder: z.object({ texto: z.string().trim().min(1, 'Escribe un mensaje').max(2000), imagenUrl: urlOVacia.optional() }),
};

export const pedidos = {
  filtro: z.object({
    estado: z.enum(ESTADOS_PEDIDO).optional(),
    botId: idMongo.optional(),
    pago: z.enum(['sin_cobro', 'pendiente', 'pagado', 'fallido']).optional(),
  }),
  estado: z.object({ estado: z.enum(ESTADOS_PEDIDO), avisar: z.boolean().default(true) }),
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
      avisos: z
        .object({
          pedidos: z.boolean(),
          citas: z.boolean(),
          recordatorioDia: z.boolean(),
          recordatorioHora: z.boolean(),
          encuestaAlEntregar: z.boolean(),
          textos: z.object(Object.fromEntries(Object.keys(TEXTOS_AVISO).map((k) => [k, z.string().max(600)]))).partial(),
        })
        .partial(),
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
    botId: idMongo.nullable().default(null),
  }),
  editar: z
    .object({ estado: z.enum(ESTADOS_CITA), notas: z.string().max(500), avisar: z.boolean() })
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

export const web_nuevos = z.object({
  visitante: z.string().regex(/^[\w-]{8,64}$/, 'Visitante inválido'),
  desde: z.string().datetime({ offset: true }).optional(),
});

const segmento = z.object({ tipo: z.enum(Object.keys(SEGMENTOS)).default('todos'), dias: z.coerce.number().int().min(1).max(365).default(30) });
const campana = z.object({
  botId: idMongo,
  nombre: texto(80),
  texto: z.string().trim().min(1, 'Escribe el mensaje').max(1500),
  imagenUrl: urlOVacia.default(''),
  segmento: segmento.default({}),
});

export const campanas = {
  crear: campana,
  editar: campana.partial().refine((o) => Object.keys(o).length > 0, 'Nada que cambiar'),
  programar: z.object({ cuando: z.string().datetime({ offset: true }).nullable().optional() }),
  segmento,
  contactos: z.object({ permiso: booleano.optional() }),
};

export const gestion = {
  encuestas: z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }),
  actividad: z.object({ entidad: z.string().max(40).optional(), usuario: z.string().max(120).optional() }),
};

export const canales = {
  telegram: z.object({ token: z.string().trim().regex(/^\d+:[\w-]{30,}$/, 'Ese no parece un token de @BotFather (ej. 123456:ABC...)') }),
  meta: z.object({ token: z.string().trim().min(40, 'Pega el token de acceso de la página') }),
  recuperacion: z
    .object({ activo: z.boolean(), horas: z.number().int().min(1).max(48), texto: z.string().trim().max(600) })
    .partial(),
};

export const plataforma = {
  cobros: z.object({
    proveedor: z.enum(['ninguno', 'mercadopago', 'stripe']),
    llave: z.string().trim().max(300).optional(),
    secretoWebhook: z.string().trim().max(300).optional(),
  }),
  adminFiltro: z.object({ texto: z.string().max(80).optional() }),
  adminEditar: z.object({ activa: z.boolean(), motivo: z.string().max(200).optional() }),
};

export const archivos = {
  firma: z.object({ uso: z.enum(USOS_IMAGEN) }),
};
