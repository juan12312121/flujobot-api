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
  TrabajoModel,
  ModuloModel,
  RegistroModel,
  ContactoModel,
  CampanaModel,
  EncuestaModel,
  VersionModel,
  ActividadModel,
} from '../models/index.js';

const oid = (id) => new mongoose.Types.ObjectId(String(id));

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

  /** Con las llaves cifradas de cobro (solo para el servicio de cobros). */
  async conSecretosDePago(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return aObjeto(await EmpresaModel.findById(id).select('+pagos.llaveCifrada +pagos.secretoWebhookCifrado').lean());
  }

  /** Superadministrador: todas las empresas (sin secretos). */
  async listarTodas({ texto } = {}) {
    const filtro = texto ? { nombre: { $regex: escaparRegex(texto), $options: 'i' } } : {};
    return (await EmpresaModel.find(filtro).sort({ createdAt: -1 }).limit(1000).lean()).map(aObjeto);
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

  /** Con los secretos de los canales (Telegram, Messenger/Instagram) para mandar y validar mensajes. */
  async conSecretos(botId) {
    if (!mongoose.isValidObjectId(botId)) return null;
    return aObjeto(await BotModel.findById(botId).select('+tokenMotor +telegram.tokenCifrado +telegram.secreto +meta.tokenCifrado').lean());
  }

  /** Webhook de Meta: el id de la página (Messenger) o de la cuenta de Instagram que recibió el mensaje. */
  async porCuentaMeta(id) {
    return aObjeto(
      await BotModel.findOne({ 'meta.activo': true, $or: [{ 'meta.paginaId': String(id) }, { 'meta.instagramId': String(id) }] })
        .select('+meta.tokenCifrado')
        .lean(),
    );
  }

  async conRecuperacion() {
    return (await BotModel.find({ 'recuperacion.activo': true }, 'empresaId nombre instancia publicado recuperacion').lean()).map(aObjeto);
  }

  /** Bot que avisa por la empresa cuando algo no viene de un bot (p. ej. una cita capturada en el panel). */
  async principal(empresaId) {
    const bots = await BotModel.find({ empresaId, publicado: { $ne: null } }, 'nombre instancia whatsapp publicado.version').sort({ whatsapp: 1, createdAt: 1 }).lean();
    const conectado = bots.find((b) => b.whatsapp === 'conectado') ?? bots[0];
    return conectado ? aObjeto(conectado) : null;
  }

  async contarTodos() {
    const filas = await BotModel.aggregate([{ $group: { _id: '$empresaId', bots: { $sum: 1 } } }]);
    return new Map(filas.map((f) => [String(f._id), f.bots]));
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

  /**
   * Mensajes que no salieron del motor (asesor, aviso, recordatorio, campaña). Crea la conversación
   * si el contacto nunca había escrito por ese canal. `cambios` se guarda junto (p. ej. estado, pendiente).
   */
  async agregarMensajes({ empresaId, botId, canal, contacto, nombre }, mensajes, cambios = {}) {
    const doc = await ConversacionModel.findOneAndUpdate(
      { botId, canal, contacto },
      {
        $set: cambios,
        $setOnInsert: { empresaId, nombre: nombre ?? '', ...('estado' in cambios ? {} : { estado: 'nueva' }) },
        $push: { historial: { $each: mensajes, $slice: -100 } },
      },
      { upsert: true, new: true },
    ).lean();
    return aObjeto(doc);
  }

  /** Chat web: lo que el bot o un asesor le escribió al visitante después de `desde`. */
  async mensajesDesde(botId, canal, contacto, desde) {
    const doc = await ConversacionModel.findOne({ botId, canal, contacto }, 'historial estado').lean();
    const lista = (doc?.historial ?? []).filter((m) => m.de !== 'contacto' && new Date(m.fecha) > desde);
    return { mensajes: lista, estado: doc?.estado ?? 'nueva' };
  }

  /** Carritos abandonados de un bot: con productos, sin respuesta desde hace `horas` (hasta 2 días) y sin recordar. */
  async carritosAbandonados(botId, { desde, hasta, canales }) {
    const docs = await ConversacionModel.find({
      botId,
      canal: { $in: canales },
      estado: 'activa',
      'carrito.0': { $exists: true },
      carritoRecordado: null,
      actualizadoEn: { $gte: desde, $lte: hasta },
    })
      .limit(50)
      .lean();
    return docs.map(aObjeto);
  }

  /** Segmento "no terminó su pedido": dejaron productos en el carrito en los últimos `dias`. */
  async conCarritoDesde(empresaId, desde) {
    return ConversacionModel.find({ empresaId, 'carrito.0': { $exists: true }, actualizadoEn: { $gte: desde } }, 'canal contacto nombre').lean();
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

  /** Últimos pedidos reales de un cliente (para "¿cómo va mi pedido?"). */
  async delContacto(empresaId, contacto, limite = 3) {
    return this.listar(empresaId, { contacto, canal: { $ne: 'simulador' } }, { orden: { createdAt: -1 }, limite });
  }

  async porFolio(empresaId, folio) {
    return aObjeto(await PedidoModel.findOne({ empresaId, folio }).lean());
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

  /** Citas del cliente de hoy en adelante (más la de hace un rato, por si pregunta llegando). */
  async proximasDelContacto(empresaId, contacto, ahora) {
    const filtro = { contacto, canal: { $ne: 'simulador' }, inicio: { $gte: new Date(ahora.getTime() - 2 * 3600_000) } };
    return this.listar(empresaId, filtro, { orden: { inicio: 1 }, limite: 3 });
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

/** Cola de tareas programadas. Varias instancias de la API pueden tomar trabajos sin pisarse (toma atómica). */
export class TrabajoRepository {
  /** Crea la tarea, o la reprograma si ya había una pendiente con la misma clave. */
  async programar({ empresaId = null, tipo, clave, ejecutarEn, datos = {} }) {
    if (clave) {
      const doc = await TrabajoModel.findOneAndUpdate(
        { clave, estado: 'pendiente' },
        { $set: { empresaId, tipo, ejecutarEn, datos } },
        { upsert: true, new: true },
      ).lean();
      return aObjeto(doc);
    }
    return aObjeto((await TrabajoModel.create({ empresaId, tipo, ejecutarEn, datos })).toObject());
  }

  /** Cancela las pendientes cuya clave empieza con `prefijo` (p. ej. "cita:<id>:"). */
  async cancelar(prefijo) {
    const r = await TrabajoModel.updateMany({ estado: 'pendiente', clave: { $regex: `^${escaparRegex(prefijo)}` } }, { $set: { estado: 'cancelado' } });
    return r.modifiedCount;
  }

  /** Toma UNA tarea vencida y la marca en curso. Las que se quedaron "en curso" más de 10 min se reintentan. */
  async tomar(ahora) {
    const doc = await TrabajoModel.findOneAndUpdate(
      {
        $or: [
          { estado: 'pendiente', ejecutarEn: { $lte: ahora } },
          { estado: 'en_curso', tomadoEn: { $lt: new Date(ahora.getTime() - 10 * 60_000) }, intentos: { $lt: 3 } },
        ],
      },
      { $set: { estado: 'en_curso', tomadoEn: ahora }, $inc: { intentos: 1 } },
      { sort: { ejecutarEn: 1 }, new: true },
    ).lean();
    return aObjeto(doc);
  }

  async terminar(id, { error } = {}) {
    await TrabajoModel.updateOne({ _id: id }, { $set: error ? { estado: 'error', error: String(error).slice(0, 500) } : { estado: 'hecho', error: '' } });
  }

  async pendientes(filtro = {}) {
    return (await TrabajoModel.find({ estado: 'pendiente', ...filtro }).sort({ ejecutarEn: 1 }).limit(200).lean()).map(aObjeto);
  }
}

/** Contactos de cada empresa (uno por canal + número/usuario). */
export class ContactoRepository extends MongoRepository {
  constructor() {
    super(ContactoModel);
  }

  /** Cada mensaje real actualiza al contacto (lo crea la primera vez). */
  async registrar({ empresaId, botId, canal, contacto, nombre }) {
    await ContactoModel.updateOne(
      { empresaId, canal, contacto },
      { $set: { ultimoMensaje: new Date(), ...(nombre ? { nombre } : {}), ...(botId ? { botId } : {}) }, $setOnInsert: { primerMensaje: new Date() } },
      { upsert: true },
    );
  }

  async permiso({ empresaId, canal, contacto }, acepta) {
    const cambios = acepta ? { aceptaPromos: true, permisoEn: new Date(), bajaEn: null } : { aceptaPromos: false, bajaEn: new Date() };
    await ContactoModel.updateOne({ empresaId, canal, contacto }, { $set: cambios, $setOnInsert: { primerMensaje: new Date(), ultimoMensaje: new Date() } }, { upsert: true });
  }

  async compra({ empresaId, canal, contacto }) {
    await ContactoModel.updateOne({ empresaId, canal, contacto }, { $set: { ultimaCompra: new Date() }, $inc: { compras: 1 } });
  }

  /** Contactos con permiso por los canales indicados, más un filtro extra del segmento. */
  async conPermiso(empresaId, canales, filtro = {}) {
    return ContactoModel.find({ empresaId, aceptaPromos: true, canal: { $in: canales }, ...filtro }, 'canal contacto nombre').limit(20000).lean();
  }

  async resumen(empresaId) {
    const [total, conPermiso] = await Promise.all([ContactoModel.countDocuments({ empresaId }), ContactoModel.countDocuments({ empresaId, aceptaPromos: true })]);
    return { total, conPermiso };
  }
}

export class CampanaRepository extends MongoRepository {
  constructor() {
    super(CampanaModel);
  }

  async conDestinatarios(id) {
    return aObjeto(await CampanaModel.findById(id).select('+destinatarios').lean());
  }

  /** Programadas cuya hora ya llegó, y las que están a medio enviar. */
  async porAtender(ahora) {
    return (await CampanaModel.find({ $or: [{ estado: 'programada', programadaPara: { $lte: ahora } }, { estado: 'enviando' }] }).limit(20).lean()).map(aObjeto);
  }

  /** Solo una instancia envía un lote a la vez: se aparta la campaña por 3 minutos. */
  async apartar(id, ahora) {
    const doc = await CampanaModel.findOneAndUpdate(
      { _id: id, $or: [{ bloqueadaHasta: null }, { bloqueadaHasta: { $exists: false } }, { bloqueadaHasta: { $lt: ahora } }] },
      { $set: { bloqueadaHasta: new Date(ahora.getTime() + 3 * 60_000) } },
      { new: true },
    ).lean();
    return Boolean(doc);
  }

  async guardarAvance(id, cambios) {
    await CampanaModel.updateOne({ _id: id }, { $set: { ...cambios, bloqueadaHasta: null } });
  }
}

export class EncuestaRepository extends MongoRepository {
  constructor() {
    super(EncuestaModel);
  }

  async resumen(empresaId, desde) {
    const [r] = await EncuestaModel.aggregate([
      { $match: { empresaId: oid(empresaId), createdAt: { $gte: desde } } },
      { $group: { _id: null, promedio: { $avg: '$calificacion' }, total: { $sum: 1 }, buenas: { $sum: { $cond: [{ $gte: ['$calificacion', 4] }, 1, 0] } } } },
    ]);
    const porNota = await EncuestaModel.aggregate([
      { $match: { empresaId: oid(empresaId), createdAt: { $gte: desde } } },
      { $group: { _id: '$calificacion', n: { $sum: 1 } } },
    ]);
    const distribucion = [1, 2, 3, 4, 5].map((c) => porNota.find((p) => p._id === c)?.n ?? 0);
    return { promedio: r ? Math.round(r.promedio * 10) / 10 : null, total: r?.total ?? 0, buenas: r?.buenas ?? 0, distribucion };
  }
}

export class VersionRepository extends MongoRepository {
  constructor() {
    super(VersionModel);
  }

  async deBot(empresaId, botId) {
    return this.listar(empresaId, { botId }, { orden: { createdAt: -1 }, limite: 30, campos: '-nodos -conexiones' });
  }

  /** Se guardan las últimas 30 publicaciones de cada bot. */
  async podar(botId, conservar = 30) {
    const viejas = await VersionModel.find({ botId }, '_id').sort({ createdAt: -1 }).skip(conservar).lean();
    if (viejas.length) await VersionModel.deleteMany({ _id: { $in: viejas.map((v) => v._id) } });
  }

  async borrarDeBot(empresaId, botId) {
    await VersionModel.deleteMany({ empresaId, botId });
  }
}

export class ActividadRepository extends MongoRepository {
  constructor() {
    super(ActividadModel);
  }

  async registrar(datos) {
    await ActividadModel.create(datos);
  }

  async buscar(empresaId, { entidad, usuario, limite = 200 } = {}) {
    const filtro = { ...(entidad ? { entidad } : {}), ...(usuario ? { usuario } : {}) };
    return this.listar(empresaId, filtro, { orden: { fecha: -1 }, limite });
  }
}

export class ModuloRepository extends MongoRepository {
  constructor() {
    super(ModuloModel);
  }

  async deEmpresa(empresaId) {
    return this.listar(empresaId, {}, { orden: { orden: 1, createdAt: 1 }, limite: 50 });
  }

  async porClave(empresaId, clave) {
    return aObjeto(await ModuloModel.findOne({ empresaId, clave }).lean());
  }

  async existeClave(empresaId, clave) {
    return Boolean(await ModuloModel.exists({ empresaId, clave }));
  }
}

export class RegistroRepository extends MongoRepository {
  constructor() {
    super(RegistroModel);
  }

  /** Crea con el siguiente folio del módulo: OS-000001, OS-000002... */
  async crear(datos) {
    const folio = await siguienteFolio(`modulo-${datos.moduloId}`, datos.prefijo || 'R', datos.empresaId);
    const { prefijo: _, ...resto } = datos;
    return super.crear(datos.empresaId, { ...resto, folio });
  }

  /** Búsqueda por texto (cualquier campo o folio) y filtro exacto por un campo (p. ej. estado). */
  async buscar(empresaId, moduloId, { texto, campo, valor, limite = 500 } = {}) {
    const filtro = { moduloId, canal: { $ne: 'simulador' } };
    if (texto) filtro.textoBusqueda = { $regex: escaparRegex(texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()) };
    if (campo && valor !== undefined && /^[a-z0-9_]{1,40}$/.test(campo)) filtro[`datos.${campo}`] = valor;
    return this.listar(empresaId, filtro, { orden: { createdAt: -1 }, limite });
  }

  /**
   * Registros de un cliente: los que registró su conversación o los que tienen su teléfono
   * en algún campo (así se encuentran también los capturados en el panel).
   */
  async delContacto(empresaId, moduloId, contacto, camposTelefono = [], limite = 3) {
    const digitos = String(contacto).replace(/\D/g, '');
    const ultimos10 = digitos.slice(-10);
    const o = [{ contacto }];
    if (ultimos10.length === 10) for (const c of camposTelefono) o.push({ [`datos.${c}`]: { $regex: `${ultimos10}$` } });
    return this.listar(empresaId, { moduloId, canal: { $ne: 'simulador' }, $or: o }, { orden: { createdAt: -1 }, limite });
  }

  async contarPorModulo(empresaId) {
    const filas = await RegistroModel.aggregate([
      { $match: { empresaId: oid(empresaId), canal: { $ne: 'simulador' } } },
      { $group: { _id: '$moduloId', n: { $sum: 1 } } },
    ]);
    return new Map(filas.map((f) => [String(f._id), f.n]));
  }

  async borrarDeModulo(empresaId, moduloId) {
    await RegistroModel.deleteMany({ empresaId, moduloId });
  }
}
