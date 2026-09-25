import mongoose from 'mongoose';

const { isValidObjectId, Types } = mongoose;

/** Documento de Mongo → objeto plano de la app: `_id` pasa a `id` y los ObjectId a texto. */
export function aObjeto(doc) {
  if (!doc) return null;
  const { _id, __v, ...resto } = doc;
  const plano = { id: String(_id) };
  for (const [k, v] of Object.entries(resto)) plano[k] = v instanceof Types.ObjectId ? String(v) : v;
  return plano;
}

/**
 * Repositorio base con aislamiento por empresa: todas las operaciones reciben `empresaId`
 * y lo meten en el filtro. Un id de otra empresa se comporta igual que uno que no existe.
 */
export class MongoRepository {
  /** @param {import('mongoose').Model} Model */
  constructor(Model) {
    this.Model = Model;
  }

  async listar(empresaId, filtro = {}, { orden = { createdAt: -1 }, limite = 200, saltar = 0, campos } = {}) {
    const docs = await this.Model.find({ ...filtro, empresaId }, campos).sort(orden).skip(saltar).limit(limite).lean();
    return docs.map(aObjeto);
  }

  async contar(empresaId, filtro = {}) {
    return this.Model.countDocuments({ ...filtro, empresaId });
  }

  async obtener(empresaId, id, campos) {
    if (!isValidObjectId(id)) return null;
    return aObjeto(await this.Model.findOne({ _id: id, empresaId }, campos).lean());
  }

  async crear(empresaId, datos) {
    const doc = await this.Model.create({ ...datos, empresaId });
    return aObjeto(doc.toObject());
  }

  async actualizar(empresaId, id, cambios) {
    if (!isValidObjectId(id)) return null;
    const doc = await this.Model.findOneAndUpdate({ _id: id, empresaId }, { $set: cambios }, { new: true, runValidators: true }).lean();
    return aObjeto(doc);
  }

  async borrar(empresaId, id) {
    if (!isValidObjectId(id)) return false;
    const r = await this.Model.deleteOne({ _id: id, empresaId });
    return r.deletedCount === 1;
  }
}
