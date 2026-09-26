import { UseCase } from '../../shared/UseCase.js';
import { ConflictoError } from '../../shared/errors.js';
import { ReglaDeNegocioError } from '../../../domain/shared/errors.js';
import { PLANTILLAS_MODULO, claveDeModulo, normalizarCampos, validarDatos, textoBusqueda } from '../../../domain/modulos/modulos.js';
import { exigirAdmin, existe } from '../../services/permisos.js';

/**
 * Módulos personalizados: la empresa define secciones propias (órdenes de servicio, inventario...)
 * y captura registros en ellas desde el panel o desde el bot (bloque "Guardar en módulo").
 */

const MAX_MODULOS = 20;

export class ListarPlantillasModulo extends UseCase {
  ejecutar() {
    return Object.entries(PLANTILLAS_MODULO).map(([id, p]) => ({ id, ...p, campos: normalizarCampos(p.campos).campos }));
  }
}

export class ListarModulos extends UseCase {
  constructor({ modulos, registros }) {
    super();
    Object.assign(this, { modulos, registros });
  }

  async ejecutar({ actor }) {
    const [lista, cuentas] = await Promise.all([this.modulos.deEmpresa(actor.empresaId), this.registros.contarPorModulo(actor.empresaId)]);
    return lista.map((m) => ({ ...m, registros: cuentas.get(m.id) ?? 0 }));
  }
}

export class ObtenerModulo extends UseCase {
  constructor({ modulos }) {
    super();
    this.modulos = modulos;
  }

  async ejecutar({ actor, moduloId }) {
    return existe(await this.modulos.obtener(actor.empresaId, moduloId), 'Módulo no encontrado');
  }
}

/** Nuevo módulo desde cero o desde una plantilla (la plantilla da los valores que no vengan). */
export class CrearModulo extends UseCase {
  constructor({ modulos, bitacora }) {
    super();
    Object.assign(this, { modulos, bitacora });
  }

  async ejecutar({ actor, plantilla, ...datos }) {
    exigirAdmin(actor);
    if ((await this.modulos.contar(actor.empresaId)) >= MAX_MODULOS) throw new ReglaDeNegocioError('MAXIMO_MODULOS', `Máximo ${MAX_MODULOS} módulos por empresa`);
    const base = plantilla ? PLANTILLAS_MODULO[plantilla] : null;
    if (plantilla && !base) throw new ReglaDeNegocioError('PLANTILLA_INVALIDA', 'Plantilla desconocida');
    const nombre = datos.nombre ?? base?.nombre;
    if (!nombre) throw new ReglaDeNegocioError('SIN_NOMBRE', 'Ponle nombre al módulo');
    const { campos, errores } = normalizarCampos(datos.campos ?? base?.campos);
    if (errores.length) throw new ReglaDeNegocioError('CAMPOS_INVALIDOS', errores[0], errores.map((mensaje) => ({ mensaje })));
    const clave = await this.#claveLibre(actor.empresaId, nombre);
    const modulo = await this.modulos.crear(actor.empresaId, {
      nombre,
      singular: datos.singular ?? base?.singular ?? nombre,
      clave,
      icono: datos.icono ?? base?.icono ?? 'registro',
      descripcion: datos.descripcion ?? base?.descripcion ?? '',
      prefijo: (datos.prefijo ?? base?.prefijo ?? nombre.slice(0, 2)).toUpperCase(),
      campos,
      orden: await this.modulos.contar(actor.empresaId),
      plantilla: plantilla ?? '',
    });
    await this.bitacora.registrar(actor, 'modulo.crear', { entidad: 'modulo', entidadId: modulo.id, detalle: nombre });
    return { ...modulo, registros: 0 };
  }

  async #claveLibre(empresaId, nombre) {
    const base = claveDeModulo(nombre) || 'modulo';
    for (let i = 1; i < 50; i++) {
      const clave = i === 1 ? base : `${base}-${i}`;
      if (!(await this.modulos.existeClave(empresaId, clave))) return clave;
    }
    throw new ConflictoError('CLAVE_OCUPADA', 'Ya hay un módulo con ese nombre');
  }
}

/** Cambiar nombre, ícono o campos. Los datos ya capturados se conservan (un campo quitado deja de mostrarse). */
export class EditarModulo extends UseCase {
  constructor({ modulos, bitacora }) {
    super();
    Object.assign(this, { modulos, bitacora });
  }

  async ejecutar({ actor, moduloId, ...cambios }) {
    exigirAdmin(actor);
    existe(await this.modulos.obtener(actor.empresaId, moduloId), 'Módulo no encontrado');
    if (cambios.campos) {
      const { campos, errores } = normalizarCampos(cambios.campos);
      if (errores.length) throw new ReglaDeNegocioError('CAMPOS_INVALIDOS', errores[0], errores.map((mensaje) => ({ mensaje })));
      cambios.campos = campos;
    }
    if (cambios.prefijo) cambios.prefijo = cambios.prefijo.toUpperCase();
    const modulo = await this.modulos.actualizar(actor.empresaId, moduloId, cambios);
    await this.bitacora.registrar(actor, 'modulo.editar', { entidad: 'modulo', entidadId: moduloId, detalle: modulo.nombre });
    return modulo;
  }
}

export class BorrarModulo extends UseCase {
  constructor({ modulos, registros, bitacora }) {
    super();
    Object.assign(this, { modulos, registros, bitacora });
  }

  async ejecutar({ actor, moduloId }) {
    exigirAdmin(actor);
    const m = existe(await this.modulos.obtener(actor.empresaId, moduloId), 'Módulo no encontrado');
    await this.registros.borrarDeModulo(actor.empresaId, moduloId);
    await this.modulos.borrar(actor.empresaId, moduloId);
    await this.bitacora.registrar(actor, 'modulo.borrar', { entidad: 'modulo', entidadId: moduloId, detalle: m.nombre });
  }
}

// ───── Registros ─────

export class ListarRegistros extends UseCase {
  constructor({ modulos, registros }) {
    super();
    Object.assign(this, { modulos, registros });
  }

  async ejecutar({ actor, moduloId, texto, campo, valor }) {
    existe(await this.modulos.obtener(actor.empresaId, moduloId), 'Módulo no encontrado');
    return this.registros.buscar(actor.empresaId, moduloId, { texto, campo, valor });
  }
}

export class CrearRegistro extends UseCase {
  constructor({ modulos, registros }) {
    super();
    Object.assign(this, { modulos, registros });
  }

  async ejecutar({ actor, moduloId, datos: entrada }) {
    const modulo = existe(await this.modulos.obtener(actor.empresaId, moduloId), 'Módulo no encontrado');
    const { datos, errores } = validarDatos(modulo.campos, entrada);
    if (errores.length) throw new ReglaDeNegocioError('DATOS_INVALIDOS', errores[0].mensaje, errores);
    const r = await this.registros.crear({ empresaId: actor.empresaId, moduloId, prefijo: modulo.prefijo, datos, canal: 'panel', creadoPor: actor.email ?? '' });
    await this.registros.actualizar(actor.empresaId, r.id, { textoBusqueda: textoBusqueda(r.folio, datos) });
    return r;
  }
}

/**
 * Editar un registro. Si cambia un campo marcado para avisar (p. ej. Estado), el bot le escribe al cliente
 * por su canal, o por WhatsApp si el registro tiene un teléfono.
 */
export class EditarRegistro extends UseCase {
  constructor({ modulos, registros, avisos, bitacora }) {
    super();
    Object.assign(this, { modulos, registros, avisos, bitacora });
  }

  async ejecutar({ actor, moduloId, registroId, datos: entrada, avisar = true }) {
    const modulo = existe(await this.modulos.obtener(actor.empresaId, moduloId), 'Módulo no encontrado');
    const antes = existe(await this.registros.obtener(actor.empresaId, registroId), 'Registro no encontrado');
    if (antes.moduloId !== modulo.id) existe(null, 'Registro no encontrado');
    const { datos, errores } = validarDatos(modulo.campos, entrada, { parcial: true });
    if (errores.length) throw new ReglaDeNegocioError('DATOS_INVALIDOS', errores[0].mensaje, errores);
    const todos = { ...antes.datos, ...datos };
    const r = await this.registros.actualizar(actor.empresaId, registroId, { datos: todos, textoBusqueda: textoBusqueda(antes.folio, todos) });

    const cambiados = modulo.campos.filter((c) => c.avisar && c.id in datos && datos[c.id] !== antes.datos?.[c.id] && datos[c.id]);
    let aviso = { enviado: false };
    if (avisar && cambiados.length) {
      aviso = await this.avisos.registroCambio(modulo, r, cambiados[0]).catch((e) => ({ enviado: false, error: e.message }));
    }
    if (cambiados.length) {
      const c = cambiados[0];
      await this.bitacora.registrar(actor, 'registro.estado', { entidad: 'modulo', entidadId: modulo.id, detalle: `${r.folio}: ${c.nombre} → ${datos[c.id]}` });
    }
    return { ...r, aviso };
  }
}

export class BorrarRegistro extends UseCase {
  constructor({ modulos, registros }) {
    super();
    Object.assign(this, { modulos, registros });
  }

  async ejecutar({ actor, moduloId, registroId }) {
    existe(await this.modulos.obtener(actor.empresaId, moduloId), 'Módulo no encontrado');
    const r = existe(await this.registros.obtener(actor.empresaId, registroId), 'Registro no encontrado');
    if (r.moduloId !== moduloId) existe(null, 'Registro no encontrado');
    await this.registros.borrar(actor.empresaId, registroId);
  }
}
