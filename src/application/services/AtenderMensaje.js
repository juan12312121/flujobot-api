import { Flujo } from '../../domain/flujo/Flujo.js';
import { aLocal } from '../../domain/agenda/disponibilidad.js';

/**
 * Un mensaje entrante de principio a fin: carga la conversación, corre el motor
 * y guarda estado + historial. Lo comparten WhatsApp (flujo publicado) y el simulador (borrador).
 */
export class AtenderMensaje {
  /**
   * @param {{ motor: import('./MotorDeFlujo.js').MotorDeFlujo, conversaciones: object, empresas: object }} deps
   */
  constructor({ motor, conversaciones, empresas, estadisticas }) {
    this.motor = motor;
    this.conversaciones = conversaciones;
    this.empresas = empresas;
    this.estadisticas = estadisticas;
  }

  /**
   * @param {{ bot: object, definicion: { nodos: object[], conexiones: object[] }, canal: 'whatsapp' | 'web' | 'simulador',
   *           contacto: string, nombre?: string, texto: string }} entrada
   */
  async ejecutar({ bot, definicion, canal, contacto, nombre = '', texto }) {
    const clave = { empresaId: bot.empresaId, botId: bot.id, canal, contacto };
    const empresa = await this.empresas.obtener(bot.empresaId);
    const previa = await this.conversaciones.buscarPorContacto(bot.id, canal, contacto);
    const sesion = previa ?? { contacto, nombre, estado: 'nueva', nodoActual: null, variables: {}, carrito: [] };
    if (nombre) sesion.nombre = nombre;

    const flujo = new Flujo(definicion);
    const { respuestas, recorrido, sesion: nueva } = await this.motor.procesar({
      flujo,
      sesion,
      texto,
      contexto: {
        empresaId: bot.empresaId,
        botId: bot.id,
        canal,
        moneda: empresa?.moneda ?? 'MXN',
        nombreEmpresa: empresa?.nombre ?? '',
        empresa: { horario: empresa?.horario, zonaHoraria: empresa?.zonaHoraria, terminos: empresa?.terminos ?? {}, conocimiento: empresa?.conocimiento ?? '' },
      },
    });

    const ahora = new Date();
    const mensajes = [
      { de: 'contacto', texto, fecha: ahora },
      ...respuestas.map((r) => ({ de: 'bot', texto: r.texto ?? '', url: r.url, fecha: ahora })),
    ];
    const camino = canal === 'simulador' ? null : await this.#registrarCamino(bot, empresa, previa?.camino, recorrido);
    const conversacion = await this.conversaciones.guardar(clave, camino ? { ...nueva, camino } : nueva, mensajes);
    return { respuestas, recorrido, conversacion, flujo };
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
