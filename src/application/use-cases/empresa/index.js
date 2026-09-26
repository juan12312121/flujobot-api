import { UseCase } from '../../shared/UseCase.js';
import { ReglaDeNegocioError } from '../../../domain/shared/errors.js';
import { GIROS, configuracionInicial } from '../../../domain/empresa/giros.js';
import { exigirAdmin, existe } from '../../services/permisos.js';

/** Giros disponibles con sus valores de arranque (lo usa el registro para mostrar opciones). */
export class ListarGiros extends UseCase {
  ejecutar() {
    return Object.entries(GIROS).map(([id, g]) => ({ id, nombre: g.nombre, color: g.color, plantilla: g.plantilla, ...configuracionInicial(id) }));
  }
}

export class ObtenerEmpresa extends UseCase {
  constructor({ empresas }) {
    super();
    this.empresas = empresas;
  }

  async ejecutar({ actor }) {
    return existe(await this.empresas.obtener(actor.empresaId), 'Empresa no encontrada');
  }
}

/** Grupos que se guardan campo por campo: cambiar solo el color no borra el logo. */
const ANIDADOS = ['marca', 'modulos', 'horario', 'terminos', 'avisos'];

/**
 * Personalización del espacio de trabajo (solo admin): nombre, giro, colores, logo,
 * palabras del panel, módulos visibles, horario de atención.
 * `aplicarGiro: true` reemplaza términos y módulos por los del giro elegido.
 */
export class ActualizarEmpresa extends UseCase {
  constructor({ empresas, bitacora }) {
    super();
    Object.assign(this, { empresas, bitacora });
  }

  async ejecutar({ actor, aplicarGiro, ...cambios }) {
    exigirAdmin(actor);
    if (cambios.horario?.apertura && cambios.horario?.cierre && cambios.horario.apertura >= cambios.horario.cierre) {
      throw new ReglaDeNegocioError('HORARIO_INVALIDO', 'La hora de cierre debe ser después de la de apertura');
    }
    if (aplicarGiro && cambios.giro) {
      const base = configuracionInicial(cambios.giro);
      cambios.terminos = { ...base.terminos, ...(cambios.terminos ?? {}) };
      cambios.modulos = { ...base.modulos, ...(cambios.modulos ?? {}) };
    }
    const set = {};
    for (const [campo, valor] of Object.entries(cambios)) {
      if (ANIDADOS.includes(campo) && valor && typeof valor === 'object') {
        for (const [k, v] of Object.entries(valor)) set[`${campo}.${k}`] = v;
      } else {
        set[campo] = valor;
      }
    }
    const empresa = existe(await this.empresas.actualizar(actor.empresaId, set), 'Empresa no encontrada');
    await this.bitacora?.registrar(actor, 'empresa.editar', { entidad: 'empresa', entidadId: empresa.id, detalle: Object.keys(cambios).join(', ') });
    return empresa;
  }
}
