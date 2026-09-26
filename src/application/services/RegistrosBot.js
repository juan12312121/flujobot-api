import { textoBusqueda } from '../../domain/modulos/modulos.js';

/**
 * Lo que el motor necesita de los módulos personalizados: leer la definición, guardar un registro
 * (bloque "Guardar en módulo") y buscar los del cliente (bloque "Consultar módulo").
 */
export class RegistrosBot {
  constructor({ modulos, registros }) {
    Object.assign(this, { modulos, registros });
  }

  modulo(empresaId, moduloId) {
    return this.modulos.obtener(empresaId, moduloId);
  }

  async guardar({ empresaId, modulo, datos, canal, contacto, nombreContacto, botId }) {
    const r = await this.registros.crear({ empresaId, moduloId: modulo.id, prefijo: modulo.prefijo, datos, canal, contacto, nombreContacto, botId });
    await this.registros.actualizar(empresaId, r.id, { textoBusqueda: textoBusqueda(r.folio, datos) });
    return r;
  }

  delContacto(empresaId, modulo, contacto) {
    const telefonos = modulo.campos.filter((c) => c.tipo === 'telefono').map((c) => c.id);
    return this.registros.delContacto(empresaId, modulo.id, contacto, telefonos);
  }
}
