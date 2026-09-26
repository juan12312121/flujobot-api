import { UseCase } from '../../shared/UseCase.js';
import { NoEncontradoError } from '../../shared/errors.js';
import { ReglaDeNegocioError } from '../../../domain/shared/errors.js';
import { Flujo } from '../../../domain/flujo/Flujo.js';
import { existe } from '../../services/permisos.js';
import { sugerenciasPara } from '../../services/sugerencias.js';

/**
 * Chat web: el globito que cada negocio pega en su página con una línea de código.
 * Usa el MISMO flujo publicado que WhatsApp; cada visitante es una conversación (canal "web").
 */

const NO_DISPONIBLE = 'Este chat no está disponible';

/** Panel: prender/apagar el chat web del bot y cambiar su título y saludo. La clave se crea la primera vez. */
export class ConfigurarChatWeb extends UseCase {
  constructor({ bots, generador }) {
    super();
    Object.assign(this, { bots, generador });
  }

  async ejecutar({ actor, botId, activo, titulo, saludo }) {
    const bot = existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    const web = {
      activo: activo ?? bot.web?.activo ?? false,
      clave: bot.web?.clave || this.generador.token(),
      titulo: titulo ?? bot.web?.titulo ?? '',
      saludo: saludo ?? bot.web?.saludo ?? '',
    };
    await this.bots.actualizar(actor.empresaId, botId, { web });
    return web;
  }
}

/** Público: lo que el globito necesita para pintarse (nombre, colores, logo, saludo). */
export class ObtenerChatPublico extends UseCase {
  constructor({ bots, empresas }) {
    super();
    Object.assign(this, { bots, empresas });
  }

  async ejecutar({ clave }) {
    const bot = await this.bots.porClaveWeb(clave);
    if (!bot?.web?.activo || !bot.publicado?.nodos?.length) throw new NoEncontradoError(NO_DISPONIBLE);
    const empresa = await this.empresas.obtener(bot.empresaId);
    const flujo = new Flujo(bot.publicado);
    return {
      titulo: bot.web.titulo || empresa?.nombre || bot.nombre,
      saludo: bot.web.saludo || '¡Hola! Escríbenos y te respondemos al momento.',
      empresa: {
        nombre: empresa?.nombre ?? '',
        logoUrl: empresa?.marca?.logoUrl ?? '',
        colorPrimario: empresa?.marca?.colorPrimario ?? '#12a150',
      },
      sugerencias: sugerenciasPara(flujo, { estado: 'nueva' }),
    };
  }
}

/** Público: un mensaje del visitante. Responde como lo haría por WhatsApp. */
export class EnviarMensajeChatPublico extends UseCase {
  constructor({ bots, atender }) {
    super();
    Object.assign(this, { bots, atender });
  }

  async ejecutar({ clave, visitante, texto, nombre }) {
    const bot = await this.bots.porClaveWeb(clave);
    if (!bot?.web?.activo || !bot.publicado?.nodos?.length) throw new NoEncontradoError(NO_DISPONIBLE);
    if (!texto?.trim()) throw new ReglaDeNegocioError('MENSAJE_VACIO', 'Escribe un mensaje');

    const { respuestas, conversacion, flujo } = await this.atender.ejecutar({
      bot,
      definicion: bot.publicado,
      canal: 'web',
      contacto: `web-${visitante}`,
      nombre: nombre ?? '',
      texto: texto.trim(),
    });
    return {
      respuestas: respuestas.map(({ tipo, texto: t, url }) => ({ tipo, texto: t, url })),
      sugerencias: sugerenciasPara(flujo, conversacion),
      estado: conversacion.estado,
      // El globito pide lo nuevo "desde" aquí (lo que escriba un asesor o un aviso)
      fecha: conversacion.historial?.at(-1)?.fecha ?? new Date(),
    };
  }
}

/** Público: lo que un asesor (o un aviso) le escribió al visitante después de `desde`. El globito pregunta cada pocos segundos. */
export class MensajesNuevosChatPublico extends UseCase {
  constructor({ bots, conversaciones }) {
    super();
    Object.assign(this, { bots, conversaciones });
  }

  async ejecutar({ clave, visitante, desde }) {
    const bot = await this.bots.porClaveWeb(clave);
    if (!bot?.web?.activo) throw new NoEncontradoError(NO_DISPONIBLE);
    const corte = desde ? new Date(desde) : new Date(Date.now() - 60_000);
    const { mensajes, estado } = await this.conversaciones.mensajesDesde(bot.id, 'web', `web-${visitante}`, corte);
    return {
      mensajes: mensajes.map((m) => ({ de: m.de, autor: m.de === 'asesor' ? 'Asesor' : '', texto: m.texto, url: m.url, fecha: m.fecha })),
      estado,
      fecha: mensajes.at(-1)?.fecha ?? corte,
    };
  }
}
