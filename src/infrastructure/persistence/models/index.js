import mongoose from 'mongoose';

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
  },
  { timestamps: true },
);

BotSchema.index({ 'web.clave': 1 }, { unique: true, sparse: true });

const ConversacionSchema = new Schema(
  {
    empresaId: ref('Empresa'),
    botId: ref('Bot'),
    canal: { type: String, enum: ['whatsapp', 'web', 'simulador'], default: 'whatsapp' },
    contacto: { type: String, required: true },
    nombre: { type: String, default: '' },
    estado: { type: String, enum: ['nueva', 'activa', 'terminada', 'humano'], default: 'nueva' },
    nodoActual: { type: String, default: null },
    variables: { type: Schema.Types.Mixed, default: {} },
    carrito: { type: [Schema.Types.Mixed], default: [] },
    historial: {
      type: [{ _id: false, de: { type: String, enum: ['contacto', 'bot'] }, texto: String, url: String, fecha: Date }],
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
    estado: { type: String, enum: ['nuevo', 'confirmado', 'enviado', 'entregado', 'cancelado'], default: 'nuevo' },
  },
  { timestamps: true, minimize: false },
);
PedidoSchema.index({ empresaId: 1, createdAt: -1 });
PedidoSchema.index({ empresaId: 1, folio: 1 }, { unique: true });

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
  },
  { timestamps: true, minimize: false },
);
CitaSchema.index({ empresaId: 1, inicio: 1 });
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
