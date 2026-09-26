import { Flujo } from '../../domain/flujo/Flujo.js';
import { aLocal } from '../../domain/agenda/disponibilidad.js';
import { normalizar } from '../../domain/flujo/texto.js';
import { PALABRAS_ALTA, PALABRAS_BAJA, PALABRAS_NO, PALABRAS_SI } from '../../domain/avisos/textos.js';
import { CANALES_REALES } from '../shared/canales.js';

/**
 * Un mensaje entrante de principio a fin: carga la conversación, corre el motor
 * y guarda estado + historial. Lo comparten todos los canales y el simulador (borrador).
 *
 * Antes del motor:
 *  - empresa suspendida → el bot no contesta;
 *  - BAJA / ALTA → permiso de promociones;
 *  - una respuesta pendiente fuera del flujo (confirmar un recordatorio de cita, calificar un pedido).
 * Después del motor aplica sus `efectos` (esperas programadas, encuestas, permisos, compras, recordatorios).
 */
export class AtenderMensaje {
  constructor({ motor, conversaciones, empresas, estadisticas, contactos, encuestas, citas, programador, avisos, reloj = () => new Date() }) {
    Object.assign(this, { motor, conversaciones, empresas, estadisticas, contactos, encuestas, citas, programador, avisos, reloj });
  }

  /**
   * @param {{ bot: object, definicion: { nodos: object[], conexiones: object[] }, canal: string,
   *           contacto: string, nombre?: string, texto: string }} entrada
   */
  async ejecutar({ bot, definicion, canal, contacto, nombre = '', texto, notaDeVoz = false }) {
    const clave = { empresaId: bot.empresaId, botId: bot.id, canal, contacto };
    const real = CANALES_REALES.includes(canal);
    const empresa = await this.empresas.obtener(bot.empresaId);
    const previa = await this.conversaciones.buscarPorContacto(bot.id, canal, contacto);
    const flujo = new Flujo(definicion);
    const ahora = this.reloj();
    const textoHistorial = notaDeVoz ? `Nota de voz: "${texto}"` : texto;

    if (real) {
      const motivo = !empresa || empresa.activa === false ? 'empresa suspendida' : null;
      if (motivo) return { respuestas: [], recorrido: [], efectos: [], conversacion: previa ?? { estado: 'nueva' }, flujo, ignorado: motivo };
      await this.contactos?.registrar({ empresaId: bot.empresaId, botId: bot.id, canal, contacto, nombre }).catch(() => {});

      const directa = await this.#fueraDelFlujo({ bot, empresa, canal, contacto, previa, texto });
      if (directa) {
        const mensajes = [{ de: 'contacto', texto: textoHistorial, fecha: ahora }, ...directa.respuestas.map((r) => ({ de: 'bot', texto: r.texto, fecha: ahora }))];
        const base = previa ?? { contacto, nombre, estado: 'nueva', nodoActual: null, variables: {}, carrito: [] };
        const conversacion = await this.conversaciones.guardar(clave, { ...base, ...directa.cambios, actualizadoEn: previa?.actualizadoEn ?? ahora }, mensajes);
        return { respuestas: directa.respuestas, recorrido: [], efectos: [], conversacion, flujo };
      }
    }

    const sesion = previa ?? { contacto, nombre, estado: 'nueva', nodoActual: null, variables: {}, carrito: [] };
    if (nombre) sesion.nombre = nombre;

    const { respuestas, recorrido, efectos = [], sesion: nueva } = await this.motor.procesar({ flujo, sesion, texto, contexto: this.contexto(bot, empresa, canal) });

    const mensajes = [
      { de: 'contacto', texto: textoHistorial, fecha: ahora },
      ...respuestas.map((r) => ({ de: 'bot', texto: r.texto ?? '', url: r.url, fecha: ahora })),
    ];
    const camino = canal === 'simulador' ? null : await this.#registrarCamino(bot, empresa, previa?.camino, recorrido);
    const conversacion = await this.conversaciones.guardar(clave, camino ? { ...nueva, camino } : nueva, mensajes);

    if (real) {
      await this.aplicarEfectos({ bot, canal, contacto, nombre: conversacion.nombre, conversacion, efectos });
    }
    return { respuestas, recorrido, efectos, conversacion, flujo };
  }

  /** Lo que el motor necesita saber de la empresa y del canal. */
  contexto(bot, empresa, canal) {
    return {
      empresaId: bot.empresaId,
      botId: bot.id,
      canal,
      moneda: empresa?.moneda ?? 'MXN',
      nombreEmpresa: empresa?.nombre ?? '',
      empresa: { horario: empresa?.horario, zonaHoraria: empresa?.zonaHoraria, terminos: empresa?.terminos ?? {}, conocimiento: empresa?.conocimiento ?? '' },
    };
  }

  /** Efectos del motor que tocan el mundo real (en el simulador no se aplican). */
  async aplicarEfectos({ bot, canal, contacto, nombre, conversacion, efectos }) {
    const quien = { empresaId: bot.empresaId, canal, contacto };
    for (const e of efectos) {
      try {
        if (e.tipo === 'esperar' && this.programador) {
          await this.programador.programar({
            empresaId: bot.empresaId,
            tipo: 'reanudar_espera',
            clave: `espera:${conversacion.id}`,
            ejecutarEn: new Date(this.reloj().getTime() + e.minutos * 60_000),
            datos: { empresaId: bot.empresaId, conversacionId: conversacion.id, token: e.token },
          });
        } else if (e.tipo === 'encuesta' && this.encuestas) {
          await this.encuestas.crear(bot.empresaId, { botId: bot.id, canal, contacto, nombre, calificacion: e.calificacion, comentario: e.comentario ?? '', origen: 'flujo' });
        } else if (e.tipo === 'permiso') {
          await this.contactos?.permiso(quien, e.acepta);
        } else if (e.tipo === 'compra') {
          await this.contactos?.compra(quien);
        } else if (e.tipo === 'cita') {
          await this.avisos?.programarRecordatorios(e.citaId, bot.empresaId);
        }
      } catch (err) {
        console.warn(`No se aplicó el efecto ${e.tipo}:`, err.message);
      }
    }
  }

  /** BAJA/ALTA y respuestas a recordatorios o encuestas de pedido. Devuelve { respuestas, cambios } o null. */
  async #fueraDelFlujo({ bot, empresa, canal, contacto, previa, texto }) {
    const t = normalizar(texto);
    const quien = { empresaId: bot.empresaId, canal, contacto };
    if (PALABRAS_BAJA.includes(t)) {
      await this.contactos?.permiso(quien, false);
      return { respuestas: [{ tipo: 'texto', texto: 'Listo, ya no te mandaremos promociones. Si cambias de opinión escribe *ALTA*.' }], cambios: {} };
    }
    if (PALABRAS_ALTA.includes(t)) {
      await this.contactos?.permiso(quien, true);
      return { respuestas: [{ tipo: 'texto', texto: '¡Listo! Te avisaremos de promociones y novedades. Escribe *BAJA* cuando quieras dejar de recibirlas.' }], cambios: {} };
    }

    const p = previa?.pendiente;
    if (!p || new Date(p.hasta) < this.reloj()) return null;
    const si = PALABRAS_SI.includes(t);
    const no = PALABRAS_NO.includes(t);

    if (p.tipo === 'confirmar_cita' && (si || no) && this.citas) {
      const cita = await this.citas.obtener(bot.empresaId, p.citaId);
      if (!cita || !['pendiente', 'confirmada'].includes(cita.estado)) return { respuestas: [], cambios: { pendiente: null } };
      const termino = (empresa?.terminos?.cita ?? 'cita').toLowerCase();
      const zona = empresa?.zonaHoraria ?? 'America/Mexico_City';
      const hora = aLocal(new Date(cita.inicio), zona).hora;
      if (si) {
        await this.citas.actualizar(bot.empresaId, cita.id, { estado: 'confirmada' });
        return { respuestas: [{ tipo: 'texto', texto: `¡Gracias! Tu ${termino} de las ${hora} quedó confirmada. Te esperamos.` }], cambios: { pendiente: null } };
      }
      await this.citas.actualizar(bot.empresaId, cita.id, { estado: 'cancelada' });
      await this.avisos?.cancelarRecordatorios(cita.id);
      return {
        respuestas: [{ tipo: 'texto', texto: `Listo, cancelamos tu ${termino} de las ${hora}. Si quieres agendar otra, escríbenos.` }],
        cambios: { pendiente: null, estado: 'terminada', nodoActual: null },
      };
    }

    if (p.tipo === 'calificar_pedido' && /^[1-5]$/.test(t) && this.encuestas) {
      const n = Number(t);
      await this.encuestas.crear(bot.empresaId, { botId: bot.id, canal, contacto, nombre: previa?.nombre ?? '', calificacion: n, origen: 'pedido', folio: p.folio ?? '' });
      const texto = n >= 4 ? '¡Gracias por tu calificación! Nos alegra que te haya gustado.' : 'Gracias por decirnos. Vamos a revisar qué pasó para mejorar.';
      return { respuestas: [{ tipo: 'texto', texto }], cambios: { pendiente: null } };
    }
    return null;
  }

  /**
   * Resultados del lienzo: suma 1 a los bloques y flechas que esta conversación pisa por PRIMERA vez
   * (así se cuentan conversaciones, no reintentos). Si la conversación volvió a empezar, el camino se reinicia.
   */
  async #registrarCamino(bot, empresa, previo, recorrido) {
    if (!this.estadisticas || recorrido.length === 0) return previo ?? { nodos: [], flechas: [] };
    const reinicio = recorrido[0].tipo === 'inicio' && recorrido[0].puerto;
    const camino = reinicio || !previo ? { nodos: [], flechas: [] } : { nodos: [...previo.nodos], flechas: [...previo.flechas] };
    const nuevos = { nodos: [], flechas: [] };
    for (const paso of recorrido) {
      if (paso.error && !paso.puerto && paso.tipo === 'inicio') continue; // el bot no arrancó
      if (!camino.nodos.includes(paso.nodoId)) {
        camino.nodos.push(paso.nodoId);
        nuevos.nodos.push(paso.nodoId);
      }
      const flecha = paso.puerto ? `${paso.nodoId}|${paso.puerto}` : null;
      if (flecha && !camino.flechas.includes(flecha)) {
        camino.flechas.push(flecha);
        nuevos.flechas.push(flecha);
      }
    }
    const dia = aLocal(new Date(), empresa?.zonaHoraria ?? 'America/Mexico_City').fecha;
    await this.estadisticas.sumar({ empresaId: bot.empresaId, botId: bot.id, dia, ...nuevos }).catch((e) => console.warn('No se guardaron resultados:', e.message));
    return camino;
  }
}
