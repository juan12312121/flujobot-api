import { UseCase } from '../../shared/UseCase.js';
import { ReglaDeNegocioError } from '../../../domain/shared/errors.js';
import { localAUtc, aLocal } from '../../../domain/agenda/disponibilidad.js';
import { ESTADO_CITA_TEXTO } from '../../../domain/avisos/textos.js';
import { existe } from '../../services/permisos.js';

/** Agenda: las citas que agendan los bots (bloque "Agendar cita") y las que se capturan a mano. */

export class ListarCitas extends UseCase {
  constructor({ citas, empresas, reloj = () => new Date() }) {
    super();
    Object.assign(this, { citas, empresas, reloj });
  }

  /** Por defecto: de hoy a 14 días, vistos en la zona horaria de la empresa. */
  async ejecutar({ actor, desde, hasta, estado, botId }) {
    const empresa = await this.empresas.obtener(actor.empresaId);
    const zona = empresa?.zonaHoraria ?? 'America/Mexico_City';
    const hoy = aLocal(this.reloj(), zona).fecha;
    const inicio = localAUtc(desde ?? hoy, '00:00', zona);
    const fin = hasta ? localAUtc(hasta, '23:59', zona) : new Date(inicio.getTime() + 14 * 86400000);
    return this.citas.enRango(actor.empresaId, { desde: inicio, hasta: fin, estado, botId });
  }
}

/**
 * Cita capturada desde el panel (llamada telefónica, visita en persona...).
 * Con teléfono, recibe los mismos recordatorios por WhatsApp que las agendadas por el bot.
 */
export class CrearCita extends UseCase {
  constructor({ citas, empresas, avisos, bitacora }) {
    super();
    Object.assign(this, { citas, empresas, avisos, bitacora });
  }

  async ejecutar({ actor, fecha, hora, duracionMin, nombreContacto, contacto = '', servicio = '', notas = '', botId = null }) {
    const empresa = await this.empresas.obtener(actor.empresaId);
    const inicio = localAUtc(fecha, hora, empresa?.zonaHoraria ?? 'America/Mexico_City');
    const dura = duracionMin ?? empresa?.horario?.intervaloMin ?? 30;
    if (Number.isNaN(inicio.getTime())) throw new ReglaDeNegocioError('FECHA_INVALIDA', 'Fecha u hora inválida');
    const cita = await this.citas.crear({
      empresaId: actor.empresaId,
      botId,
      canal: 'panel',
      contacto: contacto.replace(/\D/g, ''),
      nombreContacto,
      servicio,
      notas,
      inicio,
      fin: new Date(inicio.getTime() + dura * 60000),
      estado: 'confirmada',
    });
    const recordatorios = await this.avisos.programarRecordatorios(cita).catch(() => []);
    await this.bitacora.registrar(actor, 'cita.crear', { entidad: 'cita', entidadId: cita.id, detalle: `${cita.folio} ${nombreContacto} ${fecha} ${hora}` });
    return { ...cita, recordatorios };
  }
}

export class ActualizarCita extends UseCase {
  constructor({ citas, avisos, bitacora }) {
    super();
    Object.assign(this, { citas, avisos, bitacora });
  }

  async ejecutar({ actor, citaId, avisar = true, ...cambios }) {
    const antes = existe(await this.citas.obtener(actor.empresaId, citaId), 'Cita no encontrada');
    const cita = await this.citas.actualizar(actor.empresaId, citaId, cambios);
    let aviso = { enviado: false };
    if (cambios.estado && cambios.estado !== antes.estado) {
      if (avisar) aviso = await this.avisos.citaCambioEstado(cita).catch((e) => ({ enviado: false, error: e.message }));
      else if (cambios.estado === 'cancelada') await this.avisos.cancelarRecordatorios(cita.id);
      await this.bitacora.registrar(actor, 'cita.estado', { entidad: 'cita', entidadId: cita.id, detalle: `${cita.folio}: ${ESTADO_CITA_TEXTO[antes.estado]} → ${ESTADO_CITA_TEXTO[cita.estado]}` });
    }
    return { ...cita, aviso };
  }
}
