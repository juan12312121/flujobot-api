import { UseCase } from '../../shared/UseCase.js';
import { existe, exigirAdmin } from '../../services/permisos.js';

/** Encuestas, versiones de los flujos y bitácora de actividad. */

export class ListarEncuestas extends UseCase {
  constructor({ encuestas, reloj = () => new Date() }) {
    super();
    Object.assign(this, { encuestas, reloj });
  }

  async ejecutar({ actor, dias = 30 }) {
    const desde = new Date(this.reloj().getTime() - dias * 86400000);
    const [resumen, lista] = await Promise.all([
      this.encuestas.resumen(actor.empresaId, desde),
      this.encuestas.listar(actor.empresaId, { createdAt: { $gte: desde } }, { orden: { createdAt: -1 }, limite: 300 }),
    ]);
    return { ...resumen, lista };
  }
}

export class ListarVersiones extends UseCase {
  constructor({ bots, versiones }) {
    super();
    Object.assign(this, { bots, versiones });
  }

  async ejecutar({ actor, botId }) {
    const bot = existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    const lista = await this.versiones.deBot(actor.empresaId, botId);
    return lista.map((v) => ({ ...v, activa: v.version === bot.publicado?.version }));
  }
}

/**
 * Regresa el BORRADOR a una publicación anterior. No se publica solo: la persona revisa en el editor
 * (y en el simulador) y publica cuando quiera.
 */
export class RestaurarVersion extends UseCase {
  constructor({ bots, versiones, bitacora }) {
    super();
    Object.assign(this, { bots, versiones, bitacora });
  }

  async ejecutar({ actor, botId, versionId }) {
    const bot = existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    const v = existe(await this.versiones.obtener(actor.empresaId, versionId), 'Versión no encontrada');
    if (v.botId !== bot.id) existe(null, 'Versión no encontrada');
    const borrador = { nodos: v.nodos, conexiones: v.conexiones, version: (bot.borrador?.version ?? 0) + 1, fecha: new Date() };
    await this.bots.actualizar(actor.empresaId, botId, { borrador });
    await this.bitacora.registrar(actor, 'bot.restaurar', { entidad: 'bot', entidadId: botId, detalle: `${bot.nombre}: volvió a la versión ${v.version}` });
    return { version: borrador.version, restaurada: v.version };
  }
}

export class ListarActividad extends UseCase {
  constructor({ actividad }) {
    super();
    this.actividad = actividad;
  }

  ejecutar({ actor, entidad, usuario }) {
    exigirAdmin(actor);
    return this.actividad.buscar(actor.empresaId, { entidad, usuario });
  }
}
