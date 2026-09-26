import { UseCase } from '../../shared/UseCase.js';
import { NoAutenticadoError, NoEncontradoError } from '../../shared/errors.js';
import { SIN_AUDIO } from '../../services/Voz.js';

/**
 * Lo llama el workflow de n8n de cada bot con el mensaje que mandó Evolution.
 * Responde { numero, respuestas: [{ numero, tipo, texto, url }] } y n8n las envía una por una.
 */
export class ProcesarMensajeEntrante extends UseCase {
  constructor({ bots, atender, generador, normalizar, voz, evolution }) {
    super();
    Object.assign(this, { bots, atender, generador, normalizar, voz, evolution });
  }

  async ejecutar({ botId, token, cuerpo }) {
    const bot = await this.bots.paraMotor(botId);
    if (!bot) throw new NoEncontradoError('Bot no encontrado');
    if (!this.generador.iguales(token, bot.tokenMotor)) throw new NoAutenticadoError('X-Bot-Token inválido');

    const entrante = this.normalizar(cuerpo);
    if (entrante.ignorar) return { ignorado: entrante.ignorar, respuestas: [] };
    if (!bot.publicado?.nodos?.length) return { ignorado: 'el bot no tiene un flujo publicado', respuestas: [] };

    // Nota de voz: se transcribe y el flujo la trata como si la hubiera escrito
    let texto = entrante.texto;
    if (entrante.audio) {
      texto = await this.voz.aTexto(() => this.evolution.descargarMedia(bot.instancia, entrante.audio));
      if (!texto) return { numero: entrante.contacto, respuestas: [{ numero: entrante.contacto, tipo: 'texto', texto: SIN_AUDIO }] };
    }

    const { respuestas } = await this.atender.ejecutar({
      bot,
      definicion: bot.publicado,
      canal: 'whatsapp',
      contacto: entrante.contacto,
      nombre: entrante.nombre,
      texto,
      notaDeVoz: Boolean(entrante.audio),
    });
    return { numero: entrante.contacto, respuestas: respuestas.map((r) => ({ numero: entrante.contacto, ...r })) };
  }
}
