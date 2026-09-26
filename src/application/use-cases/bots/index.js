import { UseCase } from '../../shared/UseCase.js';
import { EstadoInvalidoError, ReglaDeNegocioError } from '../../../domain/shared/errors.js';
import { Flujo } from '../../../domain/flujo/Flujo.js';
import { PLANTILLAS } from '../../../domain/flujo/plantillas.js';
import { plantillaDeGiro } from '../../../domain/empresa/giros.js';
import { sugerenciasPara } from '../../services/sugerencias.js';
import { exigirAdmin, existe } from '../../services/permisos.js';

const sinPublicar = (bot) => (bot.borrador?.version ?? 0) > (bot.publicado?.version ?? -1);

/** Lo que ve el frontend de un bot (nunca el token del motor). */
function vista(bot, { conFlujo = false } = {}) {
  const { tokenMotor: _, borrador, publicado, telegram, meta, ...resto } = bot;
  return {
    ...resto,
    publicado: publicado ? { version: publicado.version, fecha: publicado.fecha } : null,
    borrador: conFlujo ? borrador : { version: borrador?.version ?? 0, fecha: borrador?.fecha },
    cambiosSinPublicar: sinPublicar(bot),
    telegram: { activo: Boolean(telegram?.activo), usuario: telegram?.usuario ?? '' },
    meta: { activo: Boolean(meta?.activo), paginaId: meta?.paginaId ?? '', instagram: Boolean(meta?.instagramId) },
  };
}

export class ListarBots extends UseCase {
  constructor({ bots }) {
    super();
    this.bots = bots;
  }

  async ejecutar({ actor }) {
    return (await this.bots.listar(actor.empresaId)).map((b) => vista(b));
  }
}

export class CrearBot extends UseCase {
  constructor({ bots, empresas, generador, bitacora }) {
    super();
    Object.assign(this, { bots, empresas, generador, bitacora });
  }

  /** Sin plantilla elegida, se usa la recomendada para el giro de la empresa. */
  async ejecutar({ actor, nombre, descripcion = '', plantilla, flujo }) {
    plantilla ??= plantillaDeGiro((await this.empresas.obtener(actor.empresaId))?.giro);
    const inicial = flujo ?? PLANTILLAS[plantilla]();
    const base = nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20);
    const bot = await this.bots.crear(actor.empresaId, {
      nombre,
      descripcion,
      instancia: `fb-${base || 'bot'}-${this.generador.sufijo()}`,
      tokenMotor: this.generador.token(),
      borrador: { nodos: inicial.nodos, conexiones: inicial.conexiones, version: 1, fecha: new Date() },
    });
    await this.bitacora?.registrar(actor, 'bot.crear', { entidad: 'bot', entidadId: bot.id, detalle: nombre });
    return vista(bot, { conFlujo: true });
  }
}

export class ObtenerBot extends UseCase {
  constructor({ bots }) {
    super();
    this.bots = bots;
  }

  async ejecutar({ actor, botId }) {
    const bot = existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    return { ...vista(bot, { conFlujo: true }), problemas: new Flujo(bot.borrador).revisar() };
  }
}

export class EditarBot extends UseCase {
  constructor({ bots }) {
    super();
    this.bots = bots;
  }

  async ejecutar({ actor, botId, ...cambios }) {
    return vista(existe(await this.bots.actualizar(actor.empresaId, botId, cambios), 'Bot no encontrado'));
  }
}

export class BorrarBot extends UseCase {
  constructor({ bots, conversaciones, publicador, evolution, estadisticas, versiones, bitacora }) {
    super();
    Object.assign(this, { bots, conversaciones, publicador, evolution, estadisticas, versiones, bitacora });
  }

  async ejecutar({ actor, botId }) {
    exigirAdmin(actor);
    const bot = existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    await this.publicador.despublicar(bot.n8nWorkflowId);
    if (this.evolution.configurado) await this.evolution.borrar(bot.instancia);
    await this.conversaciones.borrarDeCanal(actor.empresaId, bot.id, 'whatsapp');
    await this.conversaciones.borrarDeCanal(actor.empresaId, bot.id, 'simulador');
    for (const canal of ['web', 'telegram', 'messenger', 'instagram']) await this.conversaciones.borrarDeCanal(actor.empresaId, bot.id, canal);
    await this.estadisticas.borrarDeBot(actor.empresaId, bot.id);
    await this.versiones?.borrarDeBot(actor.empresaId, bot.id);
    await this.bots.borrar(actor.empresaId, bot.id);
    await this.bitacora?.registrar(actor, 'bot.borrar', { entidad: 'bot', entidadId: bot.id, detalle: bot.nombre });
  }
}

/** Guarda el borrador que dibujó el editor. Siempre se puede guardar; publicar exige que no tenga errores. */
export class GuardarFlujo extends UseCase {
  constructor({ bots }) {
    super();
    this.bots = bots;
  }

  async ejecutar({ actor, botId, nodos, conexiones }) {
    const bot = existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    const borrador = { nodos, conexiones, version: (bot.borrador?.version ?? 0) + 1, fecha: new Date() };
    await this.bots.actualizar(actor.empresaId, botId, { borrador });
    return { version: borrador.version, fecha: borrador.fecha, problemas: new Flujo(borrador).revisar() };
  }
}

/**
 * Publica: congela el borrador como versión activa y crea/actualiza el workflow del bot en n8n.
 * Si Evolution está configurada, apunta el webhook de la instancia de WhatsApp a ese workflow.
 */
export class PublicarBot extends UseCase {
  constructor({ bots, publicador, evolution, versiones, bitacora }) {
    super();
    Object.assign(this, { bots, publicador, evolution, versiones, bitacora });
  }

  async ejecutar({ actor, botId }) {
    const bot = existe(await this.bots.conToken(actor.empresaId, botId), 'Bot no encontrado');
    const problemas = new Flujo(bot.borrador).revisar();
    const errores = problemas.filter((p) => p.nivel === 'error');
    if (errores.length) throw new EstadoInvalidoError('FLUJO_CON_ERRORES', 'Corrige los errores del flujo antes de publicar', errores);

    const r = await this.publicador.publicar(bot);
    const avisos = [];
    if (r.modo === 'manual') avisos.push('n8n no está configurado: descarga el workflow e impórtalo en tu n8n.');
    if (r.webhookUrl && this.evolution.configurado) {
      await this.evolution.configurarWebhook(bot.instancia, r.webhookUrl).catch((e) => avisos.push(`No se pudo apuntar el webhook de WhatsApp: ${e.message}`));
    }
    const actualizado = await this.bots.actualizar(actor.empresaId, botId, {
      publicado: { ...bot.borrador, fecha: new Date() },
      n8nWorkflowId: r.workflowId,
      webhookUrl: r.webhookUrl,
    });
    // Cada publicación queda guardada para poder regresar a ella desde "Versiones"
    if (this.versiones) {
      await this.versiones.crear(actor.empresaId, { botId: bot.id, version: bot.borrador.version, nodos: bot.borrador.nodos, conexiones: bot.borrador.conexiones, publicadaPor: actor.email ?? '' });
      await this.versiones.podar(bot.id);
    }
    await this.bitacora?.registrar(actor, 'bot.publicar', { entidad: 'bot', entidadId: bot.id, detalle: `${bot.nombre} v${bot.borrador.version}` });
    return { bot: vista(actualizado), modo: r.modo, webhookUrl: r.webhookUrl, avisos, problemas };
  }
}

/** JSON del workflow de n8n, para importarlo a mano cuando la API de n8n no está configurada. */
export class ExportarWorkflow extends UseCase {
  constructor({ bots, publicador }) {
    super();
    Object.assign(this, { bots, publicador });
  }

  async ejecutar({ actor, botId }) {
    return this.publicador.workflow(existe(await this.bots.conToken(actor.empresaId, botId), 'Bot no encontrado'));
  }
}

const ESTADOS_WHATSAPP = { open: 'conectado', connecting: 'esperando_qr' };

export class ConectarWhatsApp extends UseCase {
  constructor({ bots, evolution }) {
    super();
    Object.assign(this, { bots, evolution });
  }

  async ejecutar({ actor, botId }) {
    const bot = existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    const estado = await this.evolution.estado(bot.instancia);
    if (estado === 'open') {
      await this.bots.actualizar(actor.empresaId, botId, { whatsapp: 'conectado' });
      return { estado: 'conectado', qr: null };
    }
    const { qr, codigo } = await this.evolution.conectar(bot.instancia);
    if (bot.webhookUrl) await this.evolution.configurarWebhook(bot.instancia, bot.webhookUrl).catch(() => {});
    await this.bots.actualizar(actor.empresaId, botId, { whatsapp: 'esperando_qr' });
    return { estado: 'esperando_qr', qr, codigo };
  }
}

export class EstadoWhatsApp extends UseCase {
  constructor({ bots, evolution }) {
    super();
    Object.assign(this, { bots, evolution });
  }

  async ejecutar({ actor, botId }) {
    const bot = existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    if (!this.evolution.configurado) return { estado: bot.whatsapp, configurado: false };
    const whatsapp = ESTADOS_WHATSAPP[await this.evolution.estado(bot.instancia)] ?? 'desconectado';
    if (whatsapp !== bot.whatsapp) await this.bots.actualizar(actor.empresaId, botId, { whatsapp });
    return { estado: whatsapp, configurado: true };
  }
}

export class DesconectarWhatsApp extends UseCase {
  constructor({ bots, evolution }) {
    super();
    Object.assign(this, { bots, evolution });
  }

  async ejecutar({ actor, botId }) {
    const bot = existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    await this.evolution.desconectar(bot.instancia);
    await this.bots.actualizar(actor.empresaId, botId, { whatsapp: 'desconectado' });
    return { estado: 'desconectado' };
  }
}

/**
 * Chat de prueba dentro del editor: corre el BORRADOR, sin WhatsApp ni n8n.
 * Devuelve también el recorrido (para animarlo en el lienzo) y respuestas sugeridas.
 */
export class SimularMensaje extends UseCase {
  constructor({ bots, atender }) {
    super();
    Object.assign(this, { bots, atender });
  }

  async ejecutar({ actor, botId, texto, nombre }) {
    const bot = existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    if (!bot.borrador?.nodos?.length) throw new ReglaDeNegocioError('FLUJO_VACIO', 'El flujo está vacío');
    const { respuestas, recorrido, conversacion, flujo } = await this.atender.ejecutar({
      bot,
      definicion: bot.borrador,
      canal: 'simulador',
      contacto: `sim-${actor.id}`,
      nombre: nombre ?? 'Cliente de prueba',
      texto,
    });
    const { estado, nodoActual, variables, carrito } = conversacion;
    return { respuestas, recorrido, sugerencias: sugerenciasPara(flujo, conversacion), estado, nodoActual, variables, carrito };
  }
}

export class ReiniciarSimulador extends UseCase {
  constructor({ bots, conversaciones }) {
    super();
    Object.assign(this, { bots, conversaciones });
  }

  async ejecutar({ actor, botId }) {
    existe(await this.bots.obtener(actor.empresaId, botId), 'Bot no encontrado');
    await this.conversaciones.borrarDeCanal(actor.empresaId, botId, 'simulador');
  }
}
