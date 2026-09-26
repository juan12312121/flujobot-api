import { UseCase } from '../../shared/UseCase.js';
import { NoAutenticadoError, NoConfiguradoError } from '../../shared/errors.js';
import { ReglaDeNegocioError } from '../../../domain/shared/errors.js';
import { existe } from '../../services/permisos.js';
import { SIN_AUDIO } from '../../services/Voz.js';

/**
 * Otros canales con el MISMO motor y el mismo flujo publicado:
 * - Telegram: el negocio pega el token de @BotFather y listo.
 * - Messenger / Instagram: token de su página de Facebook (la app de Meta es de FlujoBot).
 * Estos canales no pasan por n8n: la API recibe el webhook y contesta directo.
 */

export class ConectarTelegram extends UseCase {
  constructor({ bots, telegram, cifrador, generador, bitacora, apiUrl }) {
    super();
    Object.assign(this, { bots, telegram, cifrador, generador, bitacora, apiUrl });
  }

  async ejecutar({ actor, botId, token }) {
    const bot = existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    const yo = await this.telegram.quienSoy(token).catch(() => {
      throw new ReglaDeNegocioError('TOKEN_INVALIDO', 'Telegram no reconoció ese token. Cópialo completo de @BotFather.');
    });
    const secreto = this.generador.token();
    await this.telegram.configurarWebhook(token, `${this.apiUrl}/publico/telegram/${bot.id}`, secreto);
    await this.bots.actualizar(actor.empresaId, botId, {
      telegram: { activo: true, usuario: yo.usuario, tokenCifrado: this.cifrador.cifrar(token), secreto },
    });
    await this.bitacora.registrar(actor, 'canal.telegram', { entidad: 'bot', entidadId: bot.id, detalle: `@${yo.usuario}` });
    return { activo: true, usuario: yo.usuario, enlace: `https://t.me/${yo.usuario}` };
  }
}

export class DesconectarTelegram extends UseCase {
  constructor({ bots, telegram, cifrador, bitacora }) {
    super();
    Object.assign(this, { bots, telegram, cifrador, bitacora });
  }

  async ejecutar({ actor, botId }) {
    existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    const bot = await this.bots.conSecretos(botId);
    const token = this.cifrador.descifrar(bot?.telegram?.tokenCifrado);
    if (token) await this.telegram.quitarWebhook(token);
    await this.bots.actualizar(actor.empresaId, botId, { telegram: { activo: false, usuario: '', tokenCifrado: '', secreto: '' } });
    await this.bitacora.registrar(actor, 'canal.telegram.quitar', { entidad: 'bot', entidadId: botId });
    return { activo: false };
  }
}

export class ConectarMeta extends UseCase {
  constructor({ bots, meta, cifrador, bitacora, metaConfigurada }) {
    super();
    Object.assign(this, { bots, meta, cifrador, bitacora, metaConfigurada });
  }

  async ejecutar({ actor, botId, token }) {
    if (!this.metaConfigurada) throw new NoConfiguradoError('La app de Meta no está configurada en el servidor (META_APP_SECRET / META_VERIFY_TOKEN)');
    const bot = existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    const pagina = await this.meta.pagina(token).catch((e) => {
      throw new ReglaDeNegocioError('TOKEN_INVALIDO', `Meta no aceptó el token de la página: ${e.message}`);
    });
    await this.meta.suscribir(token, pagina.paginaId);
    await this.bots.actualizar(actor.empresaId, botId, {
      meta: { activo: true, paginaId: pagina.paginaId, instagramId: pagina.instagramId, tokenCifrado: this.cifrador.cifrar(token) },
    });
    await this.bitacora.registrar(actor, 'canal.meta', { entidad: 'bot', entidadId: bot.id, detalle: pagina.nombre });
    return { activo: true, pagina: pagina.nombre, paginaId: pagina.paginaId, instagram: Boolean(pagina.instagramId) };
  }
}

export class DesconectarMeta extends UseCase {
  constructor({ bots, bitacora }) {
    super();
    Object.assign(this, { bots, bitacora });
  }

  async ejecutar({ actor, botId }) {
    existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    await this.bots.actualizar(actor.empresaId, botId, { meta: { activo: false, paginaId: '', instagramId: '', tokenCifrado: '' } });
    await this.bitacora.registrar(actor, 'canal.meta.quitar', { entidad: 'bot', entidadId: botId });
    return { activo: false };
  }
}

/** Carrito abandonado: prender/apagar, a cuántas horas y con qué texto. */
export class ConfigurarRecuperacion extends UseCase {
  constructor({ bots, bitacora }) {
    super();
    Object.assign(this, { bots, bitacora });
  }

  async ejecutar({ actor, botId, activo, horas, texto }) {
    const bot = existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    const recuperacion = { activo: activo ?? bot.recuperacion?.activo ?? false, horas: horas ?? bot.recuperacion?.horas ?? 2, texto: texto ?? bot.recuperacion?.texto ?? '' };
    await this.bots.actualizar(actor.empresaId, botId, { recuperacion });
    await this.bitacora.registrar(actor, 'bot.recuperacion', { entidad: 'bot', entidadId: botId, detalle: recuperacion.activo ? `a las ${recuperacion.horas} h` : 'apagado' });
    return recuperacion;
  }
}

/** Atiende un mensaje de un canal sin n8n: transcribe si es audio, corre el flujo publicado y contesta por el mismo canal. */
async function atenderYContestar({ atender, mensajero, voz }, { bot, canal, contacto, nombre, texto, descargarAudio }) {
  if (!bot.publicado?.nodos?.length) return { ignorado: 'el bot no tiene un flujo publicado' };
  let final = texto;
  if (final == null && descargarAudio) {
    final = await voz.aTexto(descargarAudio);
    if (!final) {
      await mensajero.enviar({ bot, canal, contacto, nombre, respuestas: [{ texto: SIN_AUDIO }] });
      return { ignorado: 'nota de voz sin transcribir' };
    }
  }
  const { respuestas, ignorado } = await atender.ejecutar({ bot, definicion: bot.publicado, canal, contacto, nombre, texto: final, notaDeVoz: texto == null });
  if (respuestas.length) await mensajero.enviar({ bot, canal, contacto, respuestas, registrar: false });
  return { ignorado, respuestas: respuestas.length };
}

export class RecibirTelegram extends UseCase {
  constructor({ bots, telegram, cifrador, generador, atender, mensajero, voz, normalizarTelegram }) {
    super();
    Object.assign(this, { bots, telegram, cifrador, generador, atender, mensajero, voz, normalizarTelegram });
  }

  async ejecutar({ botId, secreto, cuerpo }) {
    const bot = await this.bots.conSecretos(botId);
    if (!bot?.telegram?.activo || !this.generador.iguales(secreto, bot.telegram.secreto)) throw new NoAutenticadoError('Webhook de Telegram inválido');
    const m = this.normalizarTelegram(cuerpo);
    if (m.ignorar) return { ignorado: m.ignorar };
    const token = this.cifrador.descifrar(bot.telegram.tokenCifrado);
    return atenderYContestar(this, {
      bot,
      canal: 'telegram',
      contacto: m.contacto,
      nombre: m.nombre,
      texto: m.texto,
      descargarAudio: m.audio ? () => this.telegram.descargarArchivo(token, m.audio.fileId) : null,
    });
  }
}

export class RecibirMeta extends UseCase {
  constructor({ bots, meta, atender, mensajero, voz, normalizarMeta, verificarFirmaMeta }) {
    super();
    Object.assign(this, { bots, meta, atender, mensajero, voz, normalizarMeta, verificarFirmaMeta });
  }

  async ejecutar({ firma, crudo, cuerpo }) {
    if (!this.verificarFirmaMeta(crudo, firma)) throw new NoAutenticadoError('Firma de Meta inválida');
    const resultados = [];
    for (const m of this.normalizarMeta(cuerpo)) {
      const bot = await this.bots.porCuentaMeta(m.cuenta);
      if (!bot) continue;
      resultados.push(
        await atenderYContestar(this, {
          bot,
          canal: m.canal,
          contacto: m.contacto,
          nombre: '',
          texto: m.texto,
          descargarAudio: m.audio ? () => this.meta.descargar(m.audio.url) : null,
        }),
      );
    }
    return { atendidos: resultados.length };
  }
}
