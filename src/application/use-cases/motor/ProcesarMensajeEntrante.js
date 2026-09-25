import { UseCase } from '../../shared/UseCase.js';
import { NoAutenticadoError, NoEncontradoError } from '../../shared/errors.js';

/**
 * Lo llama el workflow de n8n de cada bot con el mensaje que mandó Evolution.
 * Responde { numero, respuestas: [{ numero, tipo, texto, url }] } y n8n las envía una por una.
 */
export class ProcesarMensajeEntrante extends UseCase {
  constructor({ bots, atender, generador, normalizar }) {
    super();
    Object.assign(this, { bots, atender, generador, normalizar });
  }

  async ejecutar({ botId, token, cuerpo }) {
    const bot = await this.bots.paraMotor(botId);
    if (!bot) throw new NoEncontradoError('Bot no encontrado');
    if (!this.generador.iguales(token, bot.tokenMotor)) throw new NoAutenticadoError('X-Bot-Token inválido');

    const entrante = this.normalizar(cuerpo);
    if (entrante.ignorar) return { ignorado: entrante.ignorar, respuestas: [] };
    if (!bot.publicado?.nodos?.length) return { ignorado: 'el bot no tiene un flujo publicado', respuestas: [] };

    const { respuestas } = await this.atender.ejecutar({
      bot,
      definicion: bot.publicado,
      canal: 'whatsapp',
      contacto: entrante.contacto,
      nombre: entrante.nombre,
      texto: entrante.texto,
    });
    return { numero: entrante.contacto, respuestas: respuestas.map((r) => ({ numero: entrante.contacto, ...r })) };
  }
}
