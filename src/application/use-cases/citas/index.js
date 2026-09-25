import { UseCase } from '../../shared/UseCase.js';
import { ReglaDeNegocioError } from '../../../domain/shared/errors.js';
import { localAUtc, aLocal } from '../../../domain/agenda/disponibilidad.js';
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

/** Cita capturada desde el panel (llamada telefónica, visita en persona...). */
export class CrearCita extends UseCase {
  constructor({ citas, empresas }) {
    super();
    Object.assign(this, { citas, empresas });
  }

  async ejecutar({ actor, fecha, hora, duracionMin, nombreContacto, contacto = '', servicio = '', notas = '' }) {
    const empresa = await this.empresas.obtener(actor.empresaId);
    const inicio = localAUtc(fecha, hora, empresa?.zonaHoraria ?? 'America/Mexico_City');
    const dura = duracionMin ?? empresa?.horario?.intervaloMin ?? 30;
    if (Number.isNaN(inicio.getTime())) throw new ReglaDeNegocioError('FECHA_INVALIDA', 'Fecha u hora inválida');
    return this.citas.crear({
      empresaId: actor.empresaId,
      canal: 'panel',
      contacto,
      nombreContacto,
      servicio,
      notas,
      inicio,
      fin: new Date(inicio.getTime() + dura * 60000),
      estado: 'confirmada',
    });
  }
}

export class ActualizarCita extends UseCase {
  constructor({ citas }) {
    super();
    this.citas = citas;
  }

  async ejecutar({ actor, citaId, ...cambios }) {
    return existe(await this.citas.actualizar(actor.empresaId, citaId, cambios), 'Cita no encontrada');
  }
}
