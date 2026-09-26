import { UseCase } from '../../shared/UseCase.js';
import { EstadoInvalidoError, ReglaDeNegocioError } from '../../../domain/shared/errors.js';
import { existe } from '../../services/permisos.js';
import { SEGMENTOS, CANALES_CAMPANA } from '../../services/Campanas.js';

/** Campañas (mensajes masivos) y la lista de contactos con permiso. */

export class ListarCampanas extends UseCase {
  constructor({ campanas }) {
    super();
    this.campanas = campanas;
  }

  ejecutar({ actor }) {
    return this.campanas.listar(actor.empresaId, {}, { orden: { createdAt: -1 }, limite: 100 });
  }
}

export class CrearCampana extends UseCase {
  constructor({ campanas, bots, bitacora }) {
    super();
    Object.assign(this, { campanas, bots, bitacora });
  }

  async ejecutar({ actor, ...datos }) {
    existe(await this.bots.obtener(actor.empresaId, datos.botId), 'Bot no encontrado');
    const c = await this.campanas.crear(actor.empresaId, { ...datos, estado: 'borrador', creadaPor: actor.email ?? '' });
    await this.bitacora.registrar(actor, 'campana.crear', { entidad: 'campana', entidadId: c.id, detalle: c.nombre });
    return c;
  }
}

export class EditarCampana extends UseCase {
  constructor({ campanas, bots }) {
    super();
    Object.assign(this, { campanas, bots });
  }

  async ejecutar({ actor, campanaId, ...cambios }) {
    const c = existe(await this.campanas.obtener(actor.empresaId, campanaId), 'Campaña no encontrada');
    if (!['borrador', 'programada'].includes(c.estado)) throw new EstadoInvalidoError('CAMPANA_ENVIADA', 'Esta campaña ya se envió; duplícala para mandar otra');
    if (cambios.botId) existe(await this.bots.obtener(actor.empresaId, cambios.botId), 'Bot no encontrado');
    return this.campanas.actualizar(actor.empresaId, campanaId, cambios);
  }
}

export class BorrarCampana extends UseCase {
  constructor({ campanas }) {
    super();
    this.campanas = campanas;
  }

  async ejecutar({ actor, campanaId }) {
    const c = existe(await this.campanas.obtener(actor.empresaId, campanaId), 'Campaña no encontrada');
    if (c.estado === 'enviando') throw new EstadoInvalidoError('CAMPANA_ENVIANDO', 'Cancélala primero; se está enviando');
    await this.campanas.borrar(actor.empresaId, campanaId);
  }
}

/** Programa el envío (ahora o en una fecha). Se revisa que haya canal y destinatarios. */
export class ProgramarCampana extends UseCase {
  constructor({ campanas, campanasServicio, mensajero, bitacora, reloj = () => new Date() }) {
    super();
    Object.assign(this, { campanas, campanasServicio, mensajero, bitacora, reloj });
  }

  async ejecutar({ actor, campanaId, cuando }) {
    const c = existe(await this.campanas.obtener(actor.empresaId, campanaId), 'Campaña no encontrada');
    if (c.estado !== 'borrador' && c.estado !== 'programada') throw new EstadoInvalidoError('CAMPANA_ENVIADA', 'Esta campaña ya se envió');
    if (!this.mensajero.puedeIniciar('whatsapp') && !this.mensajero.puedeIniciar('telegram')) {
      throw new ReglaDeNegocioError('SIN_CANAL', 'No hay canal para enviar campañas (conecta WhatsApp o Telegram)');
    }
    const destinatarios = await this.campanasServicio.destinatarios(actor.empresaId, c.segmento);
    if (destinatarios.length === 0) throw new ReglaDeNegocioError('SIN_DESTINATARIOS', 'Nadie de ese grupo ha aceptado recibir promociones todavía');
    const programadaPara = cuando ? new Date(cuando) : this.reloj();
    const r = await this.campanas.actualizar(actor.empresaId, campanaId, { estado: 'programada', programadaPara });
    await this.bitacora.registrar(actor, 'campana.programar', { entidad: 'campana', entidadId: c.id, detalle: `${c.nombre}: ${destinatarios.length} destinatarios` });
    return { ...r, destinatariosEstimados: destinatarios.length };
  }
}

export class CancelarCampana extends UseCase {
  constructor({ campanas, bitacora }) {
    super();
    Object.assign(this, { campanas, bitacora });
  }

  async ejecutar({ actor, campanaId }) {
    const c = existe(await this.campanas.obtener(actor.empresaId, campanaId), 'Campaña no encontrada');
    if (!['programada', 'enviando'].includes(c.estado)) throw new EstadoInvalidoError('CAMPANA_NO_ACTIVA', 'La campaña no está programada ni enviándose');
    const r = await this.campanas.actualizar(actor.empresaId, campanaId, { estado: c.estado === 'programada' ? 'borrador' : 'cancelada' });
    await this.bitacora.registrar(actor, 'campana.cancelar', { entidad: 'campana', entidadId: c.id, detalle: c.nombre });
    return r;
  }
}

/** Cuánta gente recibiría la campaña con ese segmento (antes de programarla). */
export class ContarSegmento extends UseCase {
  constructor({ campanasServicio, contactos }) {
    super();
    Object.assign(this, { campanasServicio, contactos });
  }

  async ejecutar({ actor, tipo, dias }) {
    const [lista, resumen] = await Promise.all([this.campanasServicio.destinatarios(actor.empresaId, { tipo, dias }), this.contactos.resumen(actor.empresaId)]);
    return { destinatarios: lista.length, contactos: resumen.total, conPermiso: resumen.conPermiso, segmentos: SEGMENTOS, canales: CANALES_CAMPANA };
  }
}

export class ListarContactos extends UseCase {
  constructor({ contactos }) {
    super();
    this.contactos = contactos;
  }

  ejecutar({ actor, permiso }) {
    const filtro = permiso === undefined ? {} : { aceptaPromos: permiso };
    return this.contactos.listar(actor.empresaId, filtro, { orden: { ultimoMensaje: -1 }, limite: 1000 });
  }
}
