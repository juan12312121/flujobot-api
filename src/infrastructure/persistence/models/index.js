import mongoose from 'mongoose';
import { CANALES, ESTADOS_PEDIDO } from '../../../domain/shared/catalogos.js';

const { Schema, model, Types } = mongoose;
const ref = (nombre) => ({ type: Types.ObjectId, ref: nombre, required: true, index: true });

/**
 * Esquemas de Mongoose. Toda colección de negocio lleva `empresaId`:
 * los repositorios SIEMPRE filtran por él, así una empresa nunca ve datos de otra.
 */

const EmpresaSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    moneda: { type: String, default: 'MXN' },
    activa: { type: Boolean, default: true },
    /** Tipo de negocio (domain/empresa/giros.js): solo define los valores de arranque. */
    giro: { type: String, default: 'otro' },
    /** Cómo se ve su espacio de trabajo. */
    marca: {
      colorPrimario: { type: String, default: '#12a150' },
      colorMenu: { type: String, default: '#0f1b17' },
      logoUrl: { type: String, default: '' },
    },
    /** Palabras que usa el panel: "Servicios" en vez de "Productos", "Pacientes" en vez de "Clientes"... */
    terminos: { type: Schema.Types.Mixed, default: {} },
    /** Secciones visibles del panel. */
    modulos: {
      catalogo: { type: Boolean, default: true },
      pedidos: { type: Boolean, default: true },
      agenda: { type: Boolean, default: false },
    },
    /** Horario de atención para el bloque Agendar cita. dias: 0 = domingo. */
    horario: {
      dias: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
      apertura: { type: String, default: '09:00' },
      cierre: { type: String, default: '19:00' },
      intervaloMin: { type: Number, default: 30 },
      capacidad: { type: Number, default: 1 },
    },
    zonaHoraria: { type: String, default: 'America/Mexico_City' },
    /** Lo que el bloque "Responder con IA" sabe del negocio: precios, políticas, preguntas frecuentes... */
    conocimiento: { type: String, default: '', maxlength: 8000 },
    /** Avisos automáticos al cliente: cambios de estado de pedidos/citas y recordatorios de cita. */
    avisos: {
      pedidos: { type: Boolean, default: true },
      citas: { type: Boolean, default: true },
      recordatorioDia: { type: Boolean, default: true },
      recordatorioHora: { type: Boolean, default: true },
      encuestaAlEntregar: { type: Boolean, default: false },
      /** Textos por estado ("enviado": "Tu pedido {{folio}} va en camino"). Vacío = el texto de fábrica. */
      textos: { type: Schema.Types.Mixed, default: {} },
    },
    /** Cobro dentro de la plática. Las llaves van cifradas (AES-GCM) y nunca salen al frontend. */
    pagos: {
      proveedor: { type: String, enum: ['ninguno', 'mercadopago', 'stripe'], default: 'ninguno' },
      llaveCifrada: { type: String, default: '', select: false },
      secretoWebhookCifrado: { type: String, default: '', select: false },
    },
    suspendidaMotivo: { type: String, default: '' },
  },
  { timestamps: true, minimize: false },
);

const UsuarioSchema = new Schema(
  {
    empresaId: ref('Empresa'),
    nombre: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    rol: { type: String, enum: ['admin', 'editor'], default: 'editor' },
  },
  { timestamps: true },
);

const ProductoSchema = new Schema(
  {
    empresaId: ref('Empresa'),
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '' },
    /** producto = se vende y va al carrito; servicio = tiene duración y se puede agendar. */
    tipo: { type: String, enum: ['producto', 'servicio'], default: 'producto' },
    precio: { type: Number, required: true, min: 0 },
    precioDesde: { type: Boolean, default: false },
    duracionMin: { type: Number, default: null },
    categoria: { type: String, default: '', trim: true },
    imagenUrl: { type: String, default: '' },
    sku: { type: String, default: '' },
    activo: { type: Boolean, default: true },
    orden: { type: Number, default: 0 },
  },
  { timestamps: true },
);
ProductoSchema.index({ empresaId: 1, activo: 1, categoria: 1, orden: 1 });

/** Nodos y flechas del editor. Mixed: la forma la garantiza la validación del dominio (Flujo.revisar). */
const DefinicionSchema = new Schema(
  {
    nodos: { type: [Schema.Types.Mixed], default: [] },
    conexiones: { type: [Schema.Types.Mixed], default: [] },
    version: { type: Number, default: 0 },
    fecha: { type: Date },
  },
  { _id: false },
);

const BotSchema = new Schema(
  {
    empresaId: ref('Empresa'),
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '' },
    /** Nombre de la instancia en Evolution API (un número de WhatsApp = una instancia). */
    instancia: { type: String, required: true, unique: true },
    telefono: { type: String, default: '' },
    whatsapp: { type: String, enum: ['desconectado', 'esperando_qr', 'conectado'], default: 'desconectado' },
    /** Secreto que n8n manda en X-Bot-Token al llamar al motor. */
    tokenMotor: { type: String, required: true, select: false },
    borrador: { type: DefinicionSchema, default: () => ({}) },
    publicado: { type: DefinicionSchema, default: null },
    n8nWorkflowId: { type: String, default: null },
    webhookUrl: { type: String, default: null },
    /** Chat web: el globito que el negocio pega en su página. `clave` es pública (va en el código a pegar). */
    web: {
      activo: { type: Boolean, default: false },
      clave: { type: String, default: undefined },
      titulo: { type: String, default: '' },
      saludo: { type: String, default: '' },
    },
    /** Telegram: token del bot (de @BotFather) cifrado; `secreto` valida que el webhook viene de Telegram. */
    telegram: {
      activo: { type: Boolean, default: false },
      usuario: { type: String, default: '' },
      tokenCifrado: { type: String, default: '', select: false },
      secreto: { type: String, default: '', select: false },
    },
    /** Messenger e Instagram (una página de Facebook con su Instagram ligado). */
    meta: {
      activo: { type: Boolean, default: false },
      paginaId: { type: String, default: '' },
      instagramId: { type: String, default: '' },
      tokenCifrado: { type: String, default: '', select: false },
    },
    /** Recuperar carritos abandonados: a las `horas` sin respuesta se le escribe al cliente una vez. */
    recuperacion: {
      activo: { type: Boolean, default: false },
      horas: { type: Number, default: 2 },
      texto: { type: String, default: '' },
    },
  },
  { timestamps: true },
);

BotSchema.index({ 'web.clave': 1 }, { unique: true, sparse: true });
BotSchema.index({ 'meta.paginaId': 1 }, { sparse: true });
BotSchema.index({ 'meta.instagramId': 1 }, { sparse: true });

const ConversacionSchema = new Schema(
  {
    empresaId: ref('Empresa'),
    botId: ref('Bot'),
    canal: { type: String, enum: CANALES, default: 'whatsapp' },
    contacto: { type: String, required: true },
    nombre: { type: String, default: '' },
    /** Quién de la empresa la está atendiendo (bloque "Pasar a un asesor" o "Tomar" en la bandeja). */
    atendidaPor: { type: String, default: '' },
    /** Respuesta que se espera fuera del flujo: confirmar un recordatorio de cita o calificar un pedido. */
    pendiente: { type: Schema.Types.Mixed, default: null },
    /** Ya se le escribió por el carrito abandonado en esta conversación. */
    carritoRecordado: { type: Date, default: null },
    estado: { type: String, enum: ['nueva', 'activa', 'terminada', 'humano'], default: 'nueva' },
    nodoActual: { type: String, default: null },
    variables: { type: Schema.Types.Mixed, default: {} },
    carrito: { type: [Schema.Types.Mixed], default: [] },
    historial: {
      type: [{ _id: false, de: { type: String, enum: ['contacto', 'bot', 'asesor', 'sistema'] }, autor: String, texto: String, url: String, fecha: Date }],
      default: [],
    },
    actualizadoEn: { type: Date, default: Date.now, index: true },
    /** Bloques y flechas ("origen|puerto") por los que ya pasó esta conversación desde que empezó. */
    camino: {
      nodos: { type: [String], default: [] },
      flechas: { type: [String], default: [] },
    },
  },
  { minimize: false },
);
ConversacionSchema.index({ botId: 1, canal: 1, contacto: 1 }, { unique: true });
ConversacionSchema.index({ empresaId: 1, estado: 1, actualizadoEn: -1 });

const PedidoSchema = new Schema(
  {
    empresaId: ref('Empresa'),
    botId: ref('Bot'),
    folio: { type: String, required: true },
    canal: { type: String, default: 'whatsapp' },
    contacto: { type: String, required: true },
    nombreContacto: { type: String, default: '' },
    items: { type: [{ _id: false, productoId: String, nombre: String, precio: Number, cantidad: Number }], default: [] },
    total: { type: Number, required: true },
    datos: { type: Schema.Types.Mixed, default: {} },
    estado: { type: String, enum: ESTADOS_PEDIDO, default: 'nuevo' },
    /** Cobro en línea: link generado por el bloque Pedido y lo que confirmó la pasarela. */
    pago: {
      estado: { type: String, enum: ['sin_cobro', 'pendiente', 'pagado', 'fallido'], default: 'sin_cobro' },
      proveedor: { type: String, default: '' },
      url: { type: String, default: '' },
      referencia: { type: String, default: '' },
      pagadoEn: { type: Date, default: null },
    },
    /** Se registró después de recordarle el carrito abandonado. */
    recuperado: { type: Boolean, default: false },
  },
  { timestamps: true, minimize: false },
);
PedidoSchema.index({ empresaId: 1, createdAt: -1 });
PedidoSchema.index({ empresaId: 1, folio: 1 }, { unique: true });
PedidoSchema.index({ empresaId: 1, contacto: 1, createdAt: -1 });

const CitaSchema = new Schema(
  {
    empresaId: ref('Empresa'),
    botId: { type: Types.ObjectId, ref: 'Bot', default: null },
    folio: { type: String, required: true },
    canal: { type: String, default: 'whatsapp' },
    contacto: { type: String, default: '' },
    nombreContacto: { type: String, default: '' },
    servicio: { type: String, default: '' },
    inicio: { type: Date, required: true },
    fin: { type: Date, required: true },
    estado: { type: String, enum: ['pendiente', 'confirmada', 'atendida', 'cancelada', 'no_asistio'], default: 'pendiente' },
    notas: { type: String, default: '' },
    datos: { type: Schema.Types.Mixed, default: {} },
    /** Cuándo se mandó cada recordatorio (null = aún no). */
    recordatorios: { dia: { type: Date, default: null }, hora: { type: Date, default: null } },
  },
  { timestamps: true, minimize: false },
);
CitaSchema.index({ empresaId: 1, inicio: 1 });
CitaSchema.index({ empresaId: 1, contacto: 1, inicio: -1 });
CitaSchema.index({ empresaId: 1, folio: 1 }, { unique: true });

/**
 * Resultados del lienzo: cuántas conversaciones pasaron por cada bloque y flecha, por día.
 * nodos/flechas son mapas { "idBloque": n } y { "origen|puerto": n }.
 */
const EstadisticaSchema = new Schema(
  {
    empresaId: ref('Empresa'),
    botId: ref('Bot'),
    dia: { type: String, required: true },
    nodos: { type: Schema.Types.Mixed, default: {} },
    flechas: { type: Schema.Types.Mixed, default: {} },
  },
  { minimize: false },
);
EstadisticaSchema.index({ botId: 1, dia: 1 }, { unique: true });

/**
 * Tareas programadas (recordatorios, bloque Esperar, campañas...). Las toma el Programador cuando vence
 * `ejecutarEn`; `clave` evita duplicados y permite cancelarlas (p. ej. "cita:<id>:dia").
 */
const TrabajoSchema = new Schema(
  {
    empresaId: { type: Types.ObjectId, ref: 'Empresa', default: null, index: true },
    tipo: { type: String, required: true },
    clave: { type: String, default: undefined },
    ejecutarEn: { type: Date, required: true },
    estado: { type: String, enum: ['pendiente', 'en_curso', 'hecho', 'error', 'cancelado'], default: 'pendiente' },
    datos: { type: Schema.Types.Mixed, default: {} },
    intentos: { type: Number, default: 0 },
    error: { type: String, default: '' },
    tomadoEn: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);
TrabajoSchema.index({ estado: 1, ejecutarEn: 1 });
TrabajoSchema.index({ clave: 1 }, { unique: true, partialFilterExpression: { estado: 'pendiente', clave: { $type: 'string' } } });

/** Personas que le han escrito a la empresa por cualquier canal; base de las campañas. */
const ContactoSchema = new Schema(
  {
    empresaId: ref('Empresa'),
    botId: { type: Types.ObjectId, ref: 'Bot', default: null },
    canal: { type: String, required: true },
    contacto: { type: String, required: true },
    nombre: { type: String, default: '' },
    /** Aceptó recibir promociones (bloque "Pedir permiso" o escribiendo ALTA). BAJA lo apaga. */
    aceptaPromos: { type: Boolean, default: false },
    permisoEn: { type: Date, default: null },
    bajaEn: { type: Date, default: null },
    primerMensaje: { type: Date, default: Date.now },
    ultimoMensaje: { type: Date, default: Date.now },
    ultimaCompra: { type: Date, default: null },
    compras: { type: Number, default: 0 },
  },
  { timestamps: true },
);
ContactoSchema.index({ empresaId: 1, canal: 1, contacto: 1 }, { unique: true });
ContactoSchema.index({ empresaId: 1, aceptaPromos: 1, ultimoMensaje: -1 });

const CampanaSchema = new Schema(
  {
    empresaId: ref('Empresa'),
    botId: { type: Types.ObjectId, ref: 'Bot', required: true },
    nombre: { type: String, required: true, trim: true },
    texto: { type: String, required: true },
    imagenUrl: { type: String, default: '' },
    /** todos | compraron | sin_terminar | con_cita | inactivos (con `dias`). */
    segmento: { tipo: { type: String, default: 'todos' }, dias: { type: Number, default: 30 } },
    estado: { type: String, enum: ['borrador', 'programada', 'enviando', 'enviada', 'cancelada'], default: 'borrador' },
    programadaPara: { type: Date, default: null },
    destinatarios: { type: [{ _id: false, canal: String, contacto: String, nombre: String }], default: [], select: false },
    indice: { type: Number, default: 0 },
    totales: { destinatarios: { type: Number, default: 0 }, enviados: { type: Number, default: 0 }, fallidos: { type: Number, default: 0 } },
    creadaPor: { type: String, default: '' },
    terminadaEn: { type: Date, default: null },
    /** Mientras una instancia de la API envía un lote, las demás no la tocan. */
    bloqueadaHasta: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);
CampanaSchema.index({ empresaId: 1, createdAt: -1 });
CampanaSchema.index({ estado: 1, programadaPara: 1 });

const EncuestaSchema = new Schema(
  {
    empresaId: ref('Empresa'),
    botId: { type: Types.ObjectId, ref: 'Bot', default: null },
    canal: { type: String, default: 'whatsapp' },
    contacto: { type: String, default: '' },
    nombre: { type: String, default: '' },
    calificacion: { type: Number, min: 1, max: 5, required: true },
    comentario: { type: String, default: '' },
    /** Qué se calificó: el flujo (bloque Encuesta) o un pedido entregado. */
    origen: { type: String, default: 'flujo' },
    folio: { type: String, default: '' },
  },
  { timestamps: true },
);
EncuestaSchema.index({ empresaId: 1, createdAt: -1 });

/** Cada publicación de un bot queda guardada para poder regresar a ella. */
const VersionSchema = new Schema(
  {
    empresaId: ref('Empresa'),
    botId: ref('Bot'),
    version: { type: Number, required: true },
    nodos: { type: [Schema.Types.Mixed], default: [] },
    conexiones: { type: [Schema.Types.Mixed], default: [] },
    publicadaPor: { type: String, default: '' },
    nota: { type: String, default: '' },
  },
  { timestamps: true },
);
VersionSchema.index({ botId: 1, createdAt: -1 });

/** Bitácora: quién hizo qué en la empresa. */
const ActividadSchema = new Schema(
  {
    empresaId: ref('Empresa'),
    usuarioId: { type: String, default: '' },
    usuario: { type: String, default: '' },
    accion: { type: String, required: true },
    entidad: { type: String, default: '' },
    entidadId: { type: String, default: '' },
    detalle: { type: String, default: '' },
  },
  { timestamps: { createdAt: 'fecha', updatedAt: false } },
);
ActividadSchema.index({ empresaId: 1, fecha: -1 });

/** Consecutivos por empresa (folios de pedido). _id = "pedido:<empresaId>". */
const ContadorSchema = new Schema({ _id: String, valor: { type: Number, default: 0 } });

export const EmpresaModel = model('Empresa', EmpresaSchema);
export const UsuarioModel = model('Usuario', UsuarioSchema);
export const ProductoModel = model('Producto', ProductoSchema);
export const BotModel = model('Bot', BotSchema);
export const ConversacionModel = model('Conversacion', ConversacionSchema, 'conversaciones');
export const PedidoModel = model('Pedido', PedidoSchema);
export const CitaModel = model('Cita', CitaSchema);
export const EstadisticaModel = model('Estadistica', EstadisticaSchema);
export const ContadorModel = model('Contador', ContadorSchema);
export const TrabajoModel = model('Trabajo', TrabajoSchema);
export const ContactoModel = model('Contacto', ContactoSchema);
export const CampanaModel = model('Campana', CampanaSchema);
export const EncuestaModel = model('Encuesta', EncuestaSchema);
export const VersionModel = model('Version', VersionSchema, 'versiones');
export const ActividadModel = model('Actividad', ActividadSchema, 'actividad');
