import { UseCase } from '../../shared/UseCase.js';
import { CANALES_REALES } from '../../shared/canales.js';
import { existe } from '../../services/permisos.js';

/** Bandeja de conversaciones (todos los canales): seguimiento y atención de una persona del equipo. */

export class ListarConversaciones extends UseCase {
  constructor({ conversaciones }) {
    super();
    this.conversaciones = conversaciones;
  }

  async ejecutar({ actor, botId, estado, canal }) {
    const filtro = { canal: canal ? canal : { $in: CANALES_REALES }, ...(botId ? { botId } : {}), ...(estado ? { estado } : {}) };
    const lista = await this.conversaciones.listar(actor.empresaId, filtro, { orden: { actualizadoEn: -1 }, limite: 200 });
    return lista.map(({ historial = [], variables: _v, ...c }) => ({ ...c, ultimoMensaje: historial.at(-1) ?? null, mensajes: historial.length }));
  }
}

export class ObtenerConversacion extends UseCase {
  constructor({ conversaciones }) {
    super();
    this.conversaciones = conversaciones;
  }

  async ejecutar({ actor, conversacionId }) {
    return existe(await this.conversaciones.obtener(actor.empresaId, conversacionId), 'Conversación no encontrada');
  }
}

/** Una persona del equipo toma la plática: el bot deja de contestar a ese cliente. */
export class TomarConversacion extends UseCase {
  constructor({ conversaciones, bitacora }) {
    super();
    Object.assign(this, { conversaciones, bitacora });
  }

  async ejecutar({ actor, conversacionId }) {
    const c = existe(await this.conversaciones.obtener(actor.empresaId, conversacionId), 'Conversación no encontrada');
    const actualizada = await this.conversaciones.actualizar(actor.empresaId, c.id, { estado: 'humano', nodoActual: null, atendidaPor: actor.email ?? '' });
    await this.bitacora.registrar(actor, 'conversacion.tomar', { entidad: 'conversacion', entidadId: c.id, detalle: `${c.nombre || c.contacto} (${c.canal})` });
    return actualizada;
  }
}

/** El asesor escribe desde el panel; sale por el canal del cliente (WhatsApp, Telegram, Messenger, Instagram o el chat web). */
export class ResponderComoAsesor extends UseCase {
  constructor({ conversaciones, bots, mensajero, bitacora }) {
    super();
    Object.assign(this, { conversaciones, bots, mensajero, bitacora });
  }

  async ejecutar({ actor, conversacionId, texto, imagenUrl }) {
    const c = existe(await this.conversaciones.obtener(actor.empresaId, conversacionId), 'Conversación no encontrada');
    const bot = existe(await this.bots.obtener(actor.empresaId, c.botId), 'El bot de esta conversación ya no existe');
    const r = await this.mensajero.enviar({
      bot,
      canal: c.canal,
      contacto: c.contacto,
      respuestas: [{ texto, url: imagenUrl || undefined }],
      de: 'asesor',
      autor: actor.email ?? '',
      // Si el asesor escribe, la plática es suya: el bot se calla hasta que la devuelvan
      cambios: { estado: 'humano', nodoActual: null, atendidaPor: actor.email ?? '', actualizadoEn: new Date() },
    });
    if (c.atendidaPor !== actor.email) {
      await this.bitacora.registrar(actor, 'conversacion.responder', { entidad: 'conversacion', entidadId: c.id, detalle: `${c.nombre || c.contacto} (${c.canal})` });
    }
    return { enviado: r.ok, error: r.error ?? null, conversacion: r.conversacion };
  }
}

/** El asesor terminó: el bot vuelve a contestar desde el Inicio en el siguiente mensaje. */
export class DevolverAlBot extends UseCase {
  constructor({ conversaciones, bitacora }) {
    super();
    Object.assign(this, { conversaciones, bitacora });
  }

  async ejecutar({ actor, conversacionId }) {
    const c = existe(
      await this.conversaciones.actualizar(actor.empresaId, conversacionId, { estado: 'terminada', nodoActual: null, atendidaPor: '' }),
      'Conversación no encontrada',
    );
    await this.bitacora.registrar(actor, 'conversacion.devolver', { entidad: 'conversacion', entidadId: c.id, detalle: `${c.nombre || c.contacto} (${c.canal})` });
    return c;
  }
}
