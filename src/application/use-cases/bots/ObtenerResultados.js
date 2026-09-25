import { UseCase } from '../../shared/UseCase.js';
import { CANALES_REALES } from '../../shared/canales.js';
import { aLocal } from '../../../domain/agenda/disponibilidad.js';
import { existe } from '../../services/permisos.js';

/** Si alguien lleva más de esto sin contestar, se considera que se fue en ese bloque. */
const ABANDONO_MIN = 60;

/**
 * "Ver resultados" del editor: por cada bloque y flecha, cuántas conversaciones pasaron
 * en los últimos N días, y dónde se quedaron esperando los que ya no contestaron.
 */
export class ObtenerResultados extends UseCase {
  constructor({ bots, empresas, estadisticas, conversaciones, reloj = () => new Date() }) {
    super();
    Object.assign(this, { bots, empresas, estadisticas, conversaciones, reloj });
  }

  async ejecutar({ actor, botId, dias = 30 }) {
    const bot = existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    const empresa = await this.empresas.obtener(actor.empresaId);
    const ahora = this.reloj();
    const desde = aLocal(new Date(ahora.getTime() - (dias - 1) * 86400000), empresa?.zonaHoraria ?? 'America/Mexico_City').fecha;
    const [{ nodos, flechas }, esperando] = await Promise.all([
      this.estadisticas.totales(actor.empresaId, botId, desde),
      this.conversaciones.esperandoPorBloque(actor.empresaId, botId, CANALES_REALES),
    ]);
    const limite = ahora.getTime() - ABANDONO_MIN * 60000;
    const abandonos = {};
    const enCurso = {};
    for (const { nodoId, fechas } of esperando) {
      for (const f of fechas) {
        const destino = new Date(f).getTime() < limite ? abandonos : enCurso;
        destino[nodoId] = (destino[nodoId] ?? 0) + 1;
      }
    }
    const inicio = bot.borrador?.nodos?.find((n) => n.tipo === 'inicio')?.id ?? bot.publicado?.nodos?.find((n) => n.tipo === 'inicio')?.id;
    return { dias, desde, conversaciones: nodos[inicio] ?? 0, nodos, flechas, abandonos, enCurso, abandonoMinutos: ABANDONO_MIN };
  }
}
