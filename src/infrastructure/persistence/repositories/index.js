import mongoose from 'mongoose';
import { MongoRepository, aObjeto } from './MongoRepository.js';
import {
  EmpresaModel,
  UsuarioModel,
  ProductoModel,
  BotModel,
  ConversacionModel,
  PedidoModel,
  CitaModel,
  EstadisticaModel,
  ContadorModel,
} from '../models/index.js';

const escaparRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Siguiente folio de la empresa para un tipo de documento: P-000001, C-000001... */
async function siguienteFolio(tipo, prefijo, empresaId) {
  const { valor } = await ContadorModel.findOneAndUpdate({ _id: `${tipo}:${empresaId}` }, { $inc: { valor: 1 } }, { upsert: true, new: true }).lean();
  return `${prefijo}-${String(valor).padStart(6, '0')}`;
}

export class EmpresaRepository {
  async crear(datos) {
    return aObjeto((await EmpresaModel.create(datos)).toObject());
  }

  async obtener(id) {
    return aObjeto(await EmpresaModel.findById(id).lean());
  }

  async actualizar(id, cambios) {
    return aObjeto(await EmpresaModel.findByIdAndUpdate(id, { $set: cambios }, { new: true, runValidators: true }).lean());
  }

  async existeSlug(slug) {
    return Boolean(await EmpresaModel.exists({ slug }));
  }

  async borrar(id) {
    await EmpresaModel.deleteOne({ _id: id });
  }
}

export class UsuarioRepository extends MongoRepository {
  constructor() {
    super(UsuarioModel);
  }

  /** Búsqueda global (el login no sabe aún la empresa). Incluye el hash. */
  async porEmail(email) {
    return aObjeto(await UsuarioModel.findOne({ email: email.toLowerCase() }).lean());
  }

  async listar(empresaId) {
    return super.listar(empresaId, {}, { orden: { createdAt: 1 }, campos: '-passwordHash' });
  }

  async obtener(empresaId, id) {
    return super.obtener(empresaId, id, '-passwordHash');
  }

  async crear(empresaId, datos) {
    const { passwordHash: _, ...usuario } = await super.crear(empresaId, datos);
    return usuario;
  }
}

export class ProductoRepository extends MongoRepository {
  constructor() {
    super(ProductoModel);
  }

  async buscar(empresaId, { texto, categoria, soloActivos } = {}) {
    const filtro = {};
    if (texto) filtro.nombre = { $regex: escaparRegex(texto), $options: 'i' };
    if (categoria) filtro.categoria = categoria;
    if (soloActivos) filtro.activo = true;
    return this.listar(empresaId, filtro, { orden: { categoria: 1, orden: 1, nombre: 1 }, limite: 500 });
  }

  /** Lo que el bot muestra en el bloque Catálogo (máximo 30 para no mandar un mensaje eterno). */
  async listarActivos(empresaId, categoria) {
    const filtro = { activo: true, ...(categoria ? { categoria } : {}) };
    return this.listar(empresaId, filtro, { orden: { orden: 1, nombre: 1 }, limite: 30 });
  }

  async buscarPorIds(empresaId, ids) {
    const validos = ids.filter((id) => mongoose.isValidObjectId(id));
    return this.listar(empresaId, { _id: { $in: validos } });
  }

  async categorias(empresaId) {
    const lista = await ProductoModel.distinct('categoria', { empresaId });
    return lista.filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));
  }
}

export class BotRepository extends MongoRepository {
  constructor() {
    super(BotModel);
  }

  /** Para el listado: sin los flujos completos (pueden pesar). */
  async listar(empresaId) {
    const bots = await super.listar(empresaId, {}, { orden: { createdAt: -1 }, campos: '-borrador.nodos -borrador.conexiones -publicado.nodos -publicado.conexiones' });
    return bots;
  }

  /** El motor llega solo con el id del bot (desde n8n): trae también el token para verificarlo. */
  async paraMotor(botId) {
    if (!mongoose.isValidObjectId(botId)) return null;
    return aObjeto(await BotModel.findById(botId).select('+tokenMotor').lean());
  }

  async conToken(empresaId, botId) {
    if (!mongoose.isValidObjectId(botId)) return null;
    return aObjeto(await BotModel.findOne({ _id: botId, empresaId }).select('+tokenMotor').lean());
  }

  /** Chat web público: se busca por la clave pública del globito (no por el id del bot). */
  async porClaveWeb(clave) {
    if (typeof clave !== 'string' || !/^[\w-]{16,64}$/.test(clave)) return null;
    return aObjeto(await BotModel.findOne({ 'web.clave': clave }).lean());
  }

  async existeInstancia(instancia) {
    return Boolean(await BotModel.exists({ instancia }));
  }
}

export class ConversacionRepository extends MongoRepository {
  constructor() {
    super(ConversacionModel);
  }

  async buscarPorContacto(botId, canal, contacto) {
    return aObjeto(await ConversacionModel.findOne({ botId, canal, contacto }).lean());
  }

  /**
   * Guarda el estado que dejó el motor y agrega los mensajes al historial (se conservan los últimos 100).
   * Crea la conversación si es la primera vez que escribe ese contacto.
   */
  async guardar({ empresaId, botId, canal, contacto }, estado, mensajes) {
    const { id: _id, historial: _h, empresaId: _e, botId: _b, canal: _c, contacto: _k, ...cambios } = estado;
    const doc = await ConversacionModel.findOneAndUpdate(
      { botId, canal, contacto },
      {
        $set: cambios,
        $setOnInsert: { empresaId },
        $push: { historial: { $each: mensajes, $slice: -100 } },
      },
      { upsert: true, new: true },
    ).lean();
    return aObjeto(doc);
  }

  /** Conversaciones reales que siguen esperando respuesta, agrupadas por el bloque donde esperan. */
  async esperandoPorBloque(empresaId, botId, canales) {
    const filas = await ConversacionModel.aggregate([
      { $match: { empresaId: new mongoose.Types.ObjectId(empresaId), botId: new mongoose.Types.ObjectId(botId), canal: { $in: canales }, estado: 'activa', nodoActual: { $ne: null } } },
      { $group: { _id: '$nodoActual', fechas: { $push: '$actualizadoEn' } } },
    ]);
    return filas.map((f) => ({ nodoId: f._id, fechas: f.fechas }));
  }

  async borrarDeCanal(empresaId, botId, canal) {
    await ConversacionModel.deleteMany({ empresaId, botId, canal });
  }
}

export class PedidoRepository extends MongoRepository {
  constructor() {
    super(PedidoModel);
  }

  /** Crea el pedido con el siguiente folio de la empresa: P-000001, P-000002... */
  async crear(datos) {
    const folio = await siguienteFolio('pedido', 'P', datos.empresaId);
    return super.crear(datos.empresaId, { ...datos, folio });
  }

  async ventasDesde(empresaId, desde) {
    const [r] = await PedidoModel.aggregate([
      { $match: { empresaId: new mongoose.Types.ObjectId(empresaId), createdAt: { $gte: desde }, estado: { $ne: 'cancelado' } } },
      { $group: { _id: null, total: { $sum: '$total' }, pedidos: { $sum: 1 } } },
    ]);
    return { total: r?.total ?? 0, pedidos: r?.pedidos ?? 0 };
  }
}

export class CitaRepository extends MongoRepository {
  constructor() {
    super(CitaModel);
  }

  async crear(datos) {
    const folio = await siguienteFolio('cita', 'C', datos.empresaId);
    return super.crear(datos.empresaId, { ...datos, folio });
  }

  /** Citas que ocupan agenda (menos canceladas y las de prueba del simulador) en el rango, solo con inicio y fin. */
  async ocupadas(empresaId, desde, hasta) {
    return CitaModel.find({ empresaId, canal: { $ne: 'simulador' }, estado: { $nin: ['cancelada'] }, inicio: { $lt: hasta }, fin: { $gt: desde } }, 'inicio fin').lean();
  }

  async enRango(empresaId, { desde, hasta, estado, botId }) {
    const filtro = { canal: { $ne: 'simulador' }, inicio: { $gte: desde, $lt: hasta }, ...(estado ? { estado } : {}), ...(botId ? { botId } : {}) };
    return this.listar(empresaId, filtro, { orden: { inicio: 1 }, limite: 1000 });
  }
}

export class EstadisticaRepository {
  /** Suma 1 a cada bloque y flecha recién visitados por una conversación (un solo upsert atómico). */
  async sumar({ empresaId, botId, dia, nodos, flechas }) {
    if (!nodos.length && !flechas.length) return;
    const inc = {};
    for (const n of nodos) inc[`nodos.${n}`] = 1;
    for (const f of flechas) inc[`flechas.${f}`] = 1;
    await EstadisticaModel.updateOne({ botId, dia }, { $inc: inc, $setOnInsert: { empresaId } }, { upsert: true });
  }

  /** Totales desde el día `desde` (AAAA-MM-DD) hasta hoy. */
  async totales(empresaId, botId, desde) {
    const dias = await EstadisticaModel.find({ empresaId, botId, dia: { $gte: desde } }).lean();
    const sumar = (destino, origen) => {
      for (const [k, v] of Object.entries(origen ?? {})) destino[k] = (destino[k] ?? 0) + v;
      return destino;
    };
    return dias.reduce((t, d) => ({ nodos: sumar(t.nodos, d.nodos), flechas: sumar(t.flechas, d.flechas) }), { nodos: {}, flechas: {} });
  }

  async borrarDeBot(empresaId, botId) {
    await EstadisticaModel.deleteMany({ empresaId, botId });
  }
}
