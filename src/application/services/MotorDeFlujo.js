import { TIPOS_DE_NODO } from '../../domain/flujo/tiposDeNodo.js';
import { interpolar, elegirOpcion, disparaInicio, validarRespuesta, normalizar, dinero } from '../../domain/flujo/texto.js';
import { cumpleCondicion, describirCondicion } from '../../domain/flujo/condiciones.js';
import { agregarAlCarrito, totalCarrito, resumenCarrito } from '../../domain/pedidos/carrito.js';
import { diasDisponibles, espaciosDelDia, rangoBusqueda, nombreDia, aLocal } from '../../domain/agenda/disponibilidad.js';
import { ESTADO_PEDIDO_TEXTO, ESTADO_CITA_TEXTO, PAGO_TEXTO, PALABRAS_SI, PALABRAS_NO } from '../../domain/avisos/textos.js';
import { validarDatos, valorLegible } from '../../domain/modulos/modulos.js';

/** Freno contra flujos en círculo (mensaje → condición → mensaje...) que no esperan respuesta. */
const MAX_PASOS = 40;
const EXPIRA_MINUTOS = 60;

/**
 * Ejecuta un flujo para UN mensaje entrante y devuelve lo que el bot debe contestar.
 *
 * No sabe de WhatsApp ni de n8n: recibe texto y devuelve respuestas
 * ({ tipo: 'texto', texto } | { tipo: 'imagen', url, texto }) y la sesión actualizada.
 * Quien lo llama decide si eso sale por WhatsApp (n8n → Evolution) o al simulador del editor.
 *
 * Además devuelve el `recorrido`: qué bloque se ejecutó, qué salida tomó y una explicación
 * en lenguaje sencillo. El simulador lo anima en el lienzo para que cualquiera entienda el flujo.
 * Cada respuesta lleva `paso` (índice del recorrido que la produjo) para sincronizar el chat.
 */
export class MotorDeFlujo {
  /**
   * @param {{
   *   productos: { listarActivos(empresaId: string, categoria?: string): Promise<object[]>, buscarPorIds(empresaId: string, ids: string[]): Promise<object[]> },
   *   pedidos: { crear(datos: object): Promise<{ folio: string, total: number }> },
   *   citas: { ocupadas(empresaId: string, desde: Date, hasta: Date): Promise<{ inicio: Date, fin: Date }[]>, crear(datos: object): Promise<{ folio: string }> },
   *   clienteWebhook: { enviar(url: string, cuerpo: object): Promise<any> },
   *   respondedor?: { responder(entrada: object): Promise<string | null> },
   *   cobros?: { link(entrada: { empresaId: string, pedido: object, canal: string }): Promise<string | null> },
   *   registros?: import('./RegistrosBot.js').RegistrosBot,
   *   reloj?: () => Date,
   * }} deps
   *
   * Además de las respuestas, el motor devuelve `efectos`: cosas que pasan fuera de la plática y que
   * aplica quien lo llama (programar una espera, guardar una encuesta, el permiso de promociones...).
   */
  constructor({ productos, pedidos, citas, clienteWebhook, respondedor, cobros, registros, reloj = () => new Date() }) {
    this.respondedor = respondedor;
    this.cobros = cobros;
    this.registros = registros;
    this.productos = productos;
    this.citas = citas;
    this.pedidos = pedidos;
    this.clienteWebhook = clienteWebhook;
    this.reloj = reloj;
  }

  /**
   * @param {{ flujo: import('../../domain/flujo/Flujo.js').Flujo, sesion: object, texto: string,
   *           contexto: { empresaId: string, botId: string, moneda?: string, canal?: string, nombreEmpresa?: string,
   *                      empresa?: { horario: object, zonaHoraria: string, terminos: object, conocimiento?: string } } }} entrada
   */
  async procesar({ flujo, sesion, texto, contexto }) {
    const ejecucion = { flujo, contexto, texto, respuestas: [], recorrido: [], efectos: [], sesion: structuredClone(sesion) };
    const s = ejecucion.sesion;
    const inicio = flujo.inicio();
    if (!inicio) return this.#resultado(ejecucion);

    if (s.estado === 'humano') {
      this.#paso(ejecucion, inicio, 'La conversación está con una persona: el bot no contesta hasta que la devuelvan.', { error: true });
      return this.#resultado(ejecucion);
    }

    // En un bloque "Esperar" la conversación sigue viva todo el tiempo de espera (más el margen normal)
    const enEspera = s.nodoActual ? flujo.nodo(s.nodoActual) : null;
    const extra = enEspera?.tipo === 'esperar' ? (Number(enEspera.datos?.minutos) || 0) * 60_000 : 0;
    const expira = (inicio.datos?.expiraMinutos ?? EXPIRA_MINUTOS) * 60_000 + extra;
    const vencida = s.actualizadoEn && this.reloj() - new Date(s.actualizadoEn) > expira;
    const pideReinicio = (inicio.datos?.palabrasReinicio ?? []).some((p) => normalizar(p) === normalizar(texto));

    // Bloque que esperaba respuesta (si la conversación sigue viva y el bloque aún existe en el flujo)
    const esperando = s.estado === 'activa' && s.nodoActual && !vencida && !pideReinicio ? flujo.nodo(s.nodoActual) : null;

    let nodo;
    if (esperando) {
      nodo = await this.#responder(ejecucion, esperando, texto);
      if (nodo === ESPERAR) return this.#resultado(ejecucion);
    } else {
      if (!pideReinicio && !disparaInicio(inicio.datos?.palabrasClave, texto)) {
        const claves = inicio.datos.palabrasClave.join(', ');
        this.#paso(ejecucion, inicio, `"${texto}" no tiene las palabras que inician el bot (${claves}), así que no contesta.`, { error: true });
        return this.#resultado(ejecucion);
      }
      this.#reiniciar(s, contexto);
      nodo = inicio;
    }
    await this.#avanzar(ejecucion, nodo);
    return this.#resultado(ejecucion);
  }

  /**
   * Se cumplió el tiempo de un bloque "Esperar" sin que el cliente contestara: sigue por "No respondió".
   * `token` evita reanudar una espera vieja (el cliente ya contestó o la conversación volvió a empezar).
   */
  async reanudar({ flujo, sesion, contexto, token }) {
    const ejecucion = { flujo, contexto, texto: '', respuestas: [], recorrido: [], efectos: [], sesion: structuredClone(sesion) };
    const s = ejecucion.sesion;
    const nodo = s.estado === 'activa' && s.nodoActual ? flujo.nodo(s.nodoActual) : null;
    if (nodo?.tipo !== 'esperar' || s.variables?._espera?.token !== token) return { ...this.#resultado(ejecucion), vigente: false };
    delete s.variables._espera;
    const paso = this.#paso(ejecucion, nodo, 'Se cumplió el tiempo de espera y el cliente no contestó, así que se fue por "No respondió".', { puerto: 'sin_respuesta' });
    await this.#avanzar(ejecucion, flujo.siguiente(nodo.id, paso.puerto));
    return { ...this.#resultado(ejecucion), vigente: true };
  }

  /** Vuelve a mostrar lo que el bot estaba preguntando (p. ej. al recordarle un carrito abandonado). */
  async recordar({ flujo, sesion, contexto }) {
    const ejecucion = { flujo, contexto, texto: '', respuestas: [], recorrido: [], efectos: [], sesion: structuredClone(sesion) };
    const nodo = ejecucion.sesion.nodoActual ? flujo.nodo(ejecucion.sesion.nodoActual) : null;
    if (nodo && TIPOS_DE_NODO[nodo.tipo]?.espera) await this.#mostrar(ejecucion, nodo, { reintento: true });
    return this.#resultado(ejecucion);
  }

  /** Recorre bloques que no esperan respuesta hasta topar con uno que sí (o con el final). */
  async #avanzar(ejecucion, nodo) {
    const s = ejecucion.sesion;
    for (let paso = 0; paso < MAX_PASOS; paso++) {
      if (!nodo) {
        this.#nota(ejecucion, 'Esa salida no está conectada a otro bloque, así que la conversación termina aquí.');
        return this.#terminar(s);
      }
      if (TIPOS_DE_NODO[nodo.tipo]?.espera) {
        if (nodo.tipo === 'cita') delete s.variables._cita; // llegar a la agenda siempre empieza por el día
        const sigue = await this.#mostrar(ejecucion, nodo);
        if (sigue === ESPERAR) {
          s.nodoActual = nodo.id;
          return;
        }
        nodo = sigue; // p. ej. catálogo vacío: se salta a "listo"
        continue;
      }
      const siguiente = await this.#ejecutar(ejecucion, nodo);
      if (siguiente === DETENER) return;
      nodo = siguiente;
    }
    this.#nota(ejecucion, 'El flujo dio demasiadas vueltas sin preguntar nada: revisa que no haya un círculo de flechas.', { error: true });
    this.#decir(ejecucion, 'El flujo dio demasiadas vueltas sin preguntar nada. Revisa las flechas en el editor.');
    this.#terminar(s);
  }

  /** Bloques que actúan y siguen de largo. Devuelven el siguiente nodo, null (fin) o DETENER. */
  async #ejecutar(ejecucion, nodo) {
    const { flujo, sesion: s, contexto } = ejecucion;
    const d = nodo.datos ?? {};
    const paso = this.#paso(ejecucion, nodo);
    const ir = (puerto, explicacion) => {
      paso.puerto = puerto;
      paso.texto = explicacion;
      return flujo.siguiente(nodo.id, puerto);
    };

    switch (nodo.tipo) {
      case 'inicio':
        if (d.bienvenida) this.#decir(ejecucion, d.bienvenida);
        return ir('siguiente', `El cliente escribió "${ejecucion.texto}" y el bot empezó la conversación.`);

      case 'mensaje':
        if (d.imagenUrl) this.#emitir(ejecucion, { tipo: 'imagen', url: d.imagenUrl, texto: this.#texto(ejecucion, d.texto ?? '') });
        else this.#decir(ejecucion, d.texto);
        return ir('siguiente', d.imagenUrl ? 'El bot envió una imagen con su texto.' : 'El bot envió un mensaje.');

      case 'carrito':
        if (s.carrito.length === 0) {
          this.#decir(ejecucion, d.textoVacio || 'Tu carrito está vacío.');
          return ir('vacio', 'El carrito estaba vacío, así que se fue por "Carrito vacío".');
        }
        this.#decir(ejecucion, `${this.#texto(ejecucion, d.texto || '*Tu pedido:*')}\n${resumenCarrito(s.carrito, contexto.moneda)}`, false);
        return ir('siguiente', `Se mostró el resumen del carrito: ${s.carrito.length} producto(s), total ${dinero(totalCarrito(s.carrito), contexto.moneda)}.`);

      case 'pedido': {
        // Sin productos solo se registra si el bloque lo permite (solicitudes, prospectos, cotizaciones)
        if (s.carrito.length === 0 && !d.sinProductos) {
          this.#decir(ejecucion, 'No hay productos en el carrito para hacer un pedido.');
          paso.error = true;
          return ir('siguiente', 'No se registró nada porque el carrito estaba vacío (activa "registrar sin productos" si es una solicitud).');
        }
        const pedido = await this.pedidos.crear({
          empresaId: contexto.empresaId,
          botId: contexto.botId,
          contacto: s.contacto,
          nombreContacto: s.nombre,
          canal: contexto.canal ?? 'whatsapp',
          items: s.carrito,
          total: totalCarrito(s.carrito),
          datos: Object.fromEntries(Object.entries(s.variables).filter(([k]) => !k.startsWith('_'))),
          recuperado: Boolean(s.carritoRecordado),
        });
        s.variables.folio = pedido.folio;
        s.variables.total = dinero(pedido.total, contexto.moneda);
        const conProductos = s.carrito.length > 0;
        s.carrito = [];
        ejecucion.efectos.push({ tipo: 'compra', pedidoId: pedido.id, folio: pedido.folio });

        // Cobro en línea: link de Mercado Pago / Stripe en {{linkPago}}
        let cobro = '';
        if (d.cobrar && pedido.total > 0) {
          const link = this.cobros ? await this.cobros.link({ empresaId: contexto.empresaId, pedido, canal: contexto.canal }).catch(() => null) : null;
          if (link) {
            s.variables.linkPago = link;
            cobro = link.startsWith('https://') ? ' Se generó el link de pago.' : '';
          } else {
            paso.error = true;
            cobro = ' No se pudo generar el link de pago (revisa "Cobros" en Mi empresa).';
          }
        }
        const textoFabrica = conProductos
          ? d.cobrar && s.variables.linkPago
            ? '¡Listo! Tu pedido *{{folio}}* quedó registrado por {{total}}.\n\nPágalo aquí: {{linkPago}}'
            : '¡Listo! Tu pedido *{{folio}}* quedó registrado por {{total}}. Te contactaremos pronto.'
          : '¡Gracias! Registramos tu solicitud *{{folio}}*. Te contactaremos pronto.';
        this.#decir(ejecucion, d.texto || textoFabrica);
        return ir(
          'siguiente',
          (conProductos
            ? `Se registró el pedido ${pedido.folio} por ${s.variables.total}.`
            : `Se registró la solicitud ${pedido.folio} con los datos que dio el cliente.`) + cobro,
        );
      }

      case 'registro': {
        const modulo = d.moduloId && this.registros ? await this.registros.modulo(contexto.empresaId, d.moduloId) : null;
        if (!modulo) {
          paso.error = true;
          return ir('siguiente', 'El módulo de este bloque ya no existe, así que no se guardó nada.');
        }
        const entrada = {};
        for (const c of modulo.campos) {
          const plantilla = d.campos?.[c.id];
          if (plantilla) entrada[c.id] = this.#texto(ejecucion, plantilla);
          // Sin mapear, el teléfono se llena solo con el número de WhatsApp de quien escribe
          else if (c.tipo === 'telefono' && contexto.canal === 'whatsapp') entrada[c.id] = s.contacto;
        }
        // Lo que no sea válido se omite en vez de perder el registro completo
        const { datos, errores } = validarDatos(modulo.campos, entrada, { parcial: true });
        const r = await this.registros.guardar({
          empresaId: contexto.empresaId,
          modulo,
          datos,
          canal: contexto.canal ?? 'whatsapp',
          contacto: s.contacto,
          nombreContacto: s.variables.cliente || s.nombre || '',
          botId: contexto.botId,
        });
        s.variables.folio = r.folio;
        s.variables.registro = { folio: r.folio, ...datos };
        this.#decir(ejecucion, d.texto || `¡Listo! Quedó registrado con el folio *{{folio}}*.`);
        const omitidos = errores.length ? ` Se omitieron datos no válidos (${errores.map((e) => e.mensaje).join('; ')}).` : '';
        if (errores.length) paso.error = true;
        return ir('siguiente', `Se guardó en "${modulo.nombre}" con el folio ${r.folio}.${omitidos}`);
      }

      case 'consulta': {
        const modulo = d.moduloId && this.registros ? await this.registros.modulo(contexto.empresaId, d.moduloId) : null;
        if (!modulo) {
          paso.error = true;
          this.#decir(ejecucion, d.textoNada || 'Por ahora no puedo consultar eso.');
          return ir('nada', 'El módulo de este bloque ya no existe.');
        }
        const lista = await this.registros.delContacto(contexto.empresaId, modulo, s.contacto);
        if (lista.length === 0) {
          this.#decir(ejecucion, d.textoNada || `No encontré ningún registro de ${modulo.nombre.toLowerCase()} con tus datos.`);
          return ir('nada', `El bot buscó en "${modulo.nombre}" y no encontró nada de este cliente.`);
        }
        const mostrar = modulo.campos.filter((c) => (d.mostrar?.length ? d.mostrar.includes(c.id) : c.enLista) && c.tipo !== 'telefono').slice(0, 5);
        const lineas = lista.map((r) => `• *${r.folio}* — ${mostrar.map((c) => `${c.nombre}: ${valorLegible(c, r.datos?.[c.id], contexto.moneda)}`).join(' · ')}`);
        s.variables.registro = { folio: lista[0].folio, ...lista[0].datos };
        this.#decir(ejecucion, `${this.#texto(ejecucion, d.texto || 'Esto es lo que encontré:')}\n\n${lineas.join('\n')}`, false);
        return ir('encontrado', `El bot le mostró ${lista.length} registro(s) de "${modulo.nombre}".`);
      }

      case 'estado': {
        const zona = contexto.empresa?.zonaHoraria ?? 'America/Mexico_City';
        const que = d.que ?? 'ambos';
        const [pedidos, citas] = await Promise.all([
          que !== 'citas' && this.pedidos.delContacto ? this.pedidos.delContacto(contexto.empresaId, s.contacto, 3) : [],
          que !== 'pedidos' && this.citas?.proximasDelContacto ? this.citas.proximasDelContacto(contexto.empresaId, s.contacto, this.reloj()) : [],
        ]);
        if (pedidos.length === 0 && citas.length === 0) {
          this.#decir(ejecucion, d.textoNada || 'No encontré pedidos ni citas con este número. Si crees que es un error, escríbenos.');
          return ir('nada', 'El bot buscó pedidos y citas de este cliente y no encontró ninguno.');
        }
        const t = contexto.empresa?.terminos ?? {};
        const lineas = [];
        if (pedidos.length) {
          lineas.push(`*${t.pedidos ?? 'Pedidos'}:*`);
          for (const p of pedidos) {
            const pago = PAGO_TEXTO[p.pago?.estado] ? ` (${PAGO_TEXTO[p.pago.estado]})` : '';
            lineas.push(`• *${p.folio}* — ${ESTADO_PEDIDO_TEXTO[p.estado] ?? p.estado}${p.total > 0 ? ` — ${dinero(p.total, contexto.moneda)}` : ''}${pago}`);
          }
        }
        if (citas.length) {
          if (lineas.length) lineas.push('');
          lineas.push(`*${t.citas ?? 'Citas'}:*`);
          for (const c of citas) {
            const l = aLocal(new Date(c.inicio), zona);
            lineas.push(`• *${c.folio}* — ${nombreDia(l.fecha)} a las ${l.hora}${c.servicio ? ` (${c.servicio})` : ''} — ${ESTADO_CITA_TEXTO[c.estado] ?? c.estado}`);
          }
        }
        if (pedidos[0]) s.variables.ultimoPedido = { folio: pedidos[0].folio, estado: ESTADO_PEDIDO_TEXTO[pedidos[0].estado] ?? pedidos[0].estado };
        this.#decir(ejecucion, `${this.#texto(ejecucion, d.texto || 'Esto es lo que encontré:')}\n\n${lineas.join('\n')}`, false);
        return ir('encontrado', `El bot le mostró al cliente el estado de ${pedidos.length} pedido(s) y ${citas.length} cita(s).`);
      }

      case 'condicion': {
        const cumple = cumpleCondicion(d, s.variables);
        return ir(cumple ? 'si' : 'no', `Se revisó si ${describirCondicion(d, s.variables)}: ${cumple ? 'sí' : 'no'}.`);
      }

      case 'webhook':
        try {
          const r = await this.clienteWebhook.enviar(d.url, {
            botId: contexto.botId,
            contacto: s.contacto,
            nombre: s.nombre,
            variables: s.variables,
            carrito: s.carrito,
          });
          if (r && typeof r === 'object') {
            if (r.variables && typeof r.variables === 'object') Object.assign(s.variables, r.variables);
            if (typeof r.respuesta === 'string' && r.respuesta.trim()) this.#decir(ejecucion, r.respuesta);
          }
          return ir('ok', 'Se ejecutó la tarea automática en n8n y respondió bien.');
        } catch (e) {
          s.variables.error = e.message;
          paso.error = true;
          return ir('error', `La tarea automática en n8n falló (${e.message}), así que se fue por "Falló".`);
        }

      case 'humano':
        this.#decir(ejecucion, d.texto || 'Te comunico con un asesor, en un momento te atiende.');
        s.estado = 'humano';
        s.nodoActual = null;
        paso.texto = 'La conversación pasó a una persona del equipo. El bot deja de contestar a este cliente.';
        return DETENER;

      case 'fin':
        if (d.texto) this.#decir(ejecucion, d.texto);
        this.#terminar(s);
        paso.texto = 'La conversación terminó. Si el cliente vuelve a escribir, empieza desde el Inicio.';
        return DETENER;

      default:
        return null;
    }
  }

  /** Pregunta de un bloque que espera. Devuelve ESPERAR, o el nodo al que saltar si no hay nada que preguntar. */
  async #mostrar(ejecucion, nodo, { reintento = false } = {}) {
    const { flujo, sesion: s, contexto } = ejecucion;
    const d = nodo.datos ?? {};
    const paso = reintento ? null : this.#paso(ejecucion, nodo);
    const esperar = (explicacion) => {
      if (paso) Object.assign(paso, { texto: explicacion, espera: true });
      return ESPERAR;
    };

    switch (nodo.tipo) {
      case 'menu': {
        const lista = d.opciones.map((o, i) => `*${i + 1}.* ${o.etiqueta}`).join('\n');
        this.#decir(ejecucion, `${this.#texto(ejecucion, d.texto)}\n\n${lista}`, false);
        return esperar(`El bot mostró un menú con ${d.opciones.length} opciones y espera a que el cliente elija una.`);
      }
      case 'pregunta':
        this.#decir(ejecucion, d.texto);
        return esperar(`El bot preguntó un dato y espera la respuesta para guardarla como "${d.variable}".`);
      case 'catalogo': {
        const productos = await this.productos.listarActivos(contexto.empresaId, d.categoria || undefined);
        if (productos.length === 0) {
          this.#decir(ejecucion, d.textoVacio || 'Por ahora no tenemos productos disponibles.');
          if (paso) Object.assign(paso, { puerto: 'listo', error: true, texto: 'No hay nada disponible en el catálogo, así que se fue por "Terminó".' });
          return flujo.siguiente(nodo.id, 'listo');
        }
        s.variables._catalogo = productos.map((p) => p.id);
        s.variables._catalogoNombres = productos.map((p) => p.nombre);
        const lista = productos.map((p, i) => `*${i + 1}.* ${lineaCatalogo(p, contexto.moneda)}`).join('\n');
        const pie =
          d.pie ||
          (d.modo === 'elegir'
            ? 'Escribe el *número* de tu elección, o *0* para regresar.'
            : 'Escribe el *número* (y la cantidad, ej. "2 3"), o *0* para terminar.');
        this.#decir(ejecucion, `${this.#texto(ejecucion, d.texto || '*Nuestro catálogo:*')}\n\n${lista}\n\n${pie}`, false);
        return esperar(`El bot mostró ${productos.length} opciones del catálogo y espera a que el cliente escriba un número.`);
      }
      case 'cita':
        return this.#mostrarAgenda(ejecucion, nodo, paso);
      case 'ia':
        this.#decir(ejecucion, d.texto || '¿Qué te gustaría saber? Escríbeme tu pregunta.');
        return esperar('El bot invitó al cliente a escribir su pregunta con sus propias palabras.');
      case 'esperar': {
        if (d.texto && !reintento) this.#decir(ejecucion, d.texto);
        const minutos = Number(d.minutos) || 60;
        if (!reintento) {
          const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
          s.variables._espera = { token, hasta: new Date(this.reloj().getTime() + minutos * 60_000).toISOString() };
          ejecucion.efectos.push({ tipo: 'esperar', nodoId: nodo.id, minutos, token });
        }
        const simulador = contexto.canal === 'simulador' ? ' En el simulador puedes escribir /pasar para ver qué pasa si no contesta.' : '';
        return esperar(`El bot espera ${duracion(minutos)} a que el cliente conteste.${simulador}`);
      }
      case 'encuesta': {
        const e = s.variables._encuesta;
        if (e?.paso === 'comentario') {
          this.#decir(ejecucion, d.textoComentario || '¿Quieres dejarnos un comentario? Escríbelo, o responde *no*.');
          return esperar('El bot pidió un comentario opcional.');
        }
        s.variables._encuesta = { paso: 'calificacion' };
        this.#decir(ejecucion, d.texto || '¿Cómo calificarías la atención? Responde con un número del *1* (malo) al *5* (excelente).');
        return esperar('El bot pidió al cliente que califique la atención del 1 al 5.');
      }
      case 'permiso':
        this.#decir(
          ejecucion,
          `${this.#texto(ejecucion, d.texto || '¿Te gustaría recibir nuestras promociones y novedades por aquí?')}\n\n*1.* Sí, quiero recibirlas\n*2.* No, gracias`,
          false,
        );
        return esperar('El bot pidió permiso para mandarle promociones (sin permiso no entra a las campañas).');
      default:
        return ESPERAR;
    }
  }

  /** Procesa la respuesta del contacto al bloque que esperaba. Devuelve el siguiente nodo, null (fin) o ESPERAR. */
  async #responder(ejecucion, nodo, texto) {
    const { flujo, sesion: s, contexto } = ejecucion;
    const d = nodo.datos ?? {};
    const paso = this.#paso(ejecucion, nodo);
    const salir = (puerto, explicacion) => {
      Object.assign(paso, { puerto, texto: explicacion });
      return flujo.siguiente(nodo.id, puerto) ?? null;
    };
    const reintentar = async (aviso, explicacion) => {
      Object.assign(paso, { texto: explicacion, error: true, espera: true });
      this.#decir(ejecucion, aviso);
      await this.#mostrar(ejecucion, nodo, { reintento: true });
      return ESPERAR;
    };

    switch (nodo.tipo) {
      case 'menu': {
        const opcion = elegirOpcion(d.opciones, texto);
        if (!opcion && d.responderConIA) {
          const respuesta = await this.#preguntarIA(ejecucion, texto);
          if (respuesta) {
            Object.assign(paso, { texto: `"${texto}" no era una opción: la IA lo contestó con la información del negocio y el bot volvió a mostrar el menú.`, espera: true });
            this.#decir(ejecucion, respuesta, false);
            await this.#mostrar(ejecucion, nodo, { reintento: true });
            return ESPERAR;
          }
        }
        if (!opcion) {
          return reintentar(
            d.error || 'No entendí tu respuesta. Escribe el número de una opción.',
            `"${texto}" no es ninguna opción del menú, así que el bot lo vuelve a mostrar.`,
          );
        }
        s.variables.opcion = opcion.etiqueta;
        return salir(`opcion:${opcion.id}`, `El cliente eligió "${opcion.etiqueta}".`);
      }
      case 'pregunta': {
        const r = validarRespuesta(d.validacion ?? 'texto', texto);
        if (!r.ok) {
          return reintentar(
            d.error || 'Ese dato no parece válido, ¿lo intentas de nuevo?',
            `"${texto}" no parece un ${NOMBRE_DATO[d.validacion] ?? 'dato'} válido, así que el bot lo vuelve a pedir.`,
          );
        }
        s.variables[d.variable] = r.valor;
        return salir('siguiente', `El cliente respondió "${r.valor}" y se guardó como "${d.variable}".`);
      }
      case 'cita':
        return this.#responderAgenda(ejecucion, nodo, texto, reintentar, salir, paso);
      case 'esperar': {
        delete s.variables._espera;
        if (contexto.canal === 'simulador' && normalizar(texto) === '/pasar') {
          return salir('sin_respuesta', 'Simulaste que el cliente no contestó a tiempo, así que se fue por "No respondió".');
        }
        s.variables.respuesta = texto;
        return salir('respondio', `El cliente contestó "${texto}" antes de que se cumpliera el tiempo.`);
      }
      case 'encuesta': {
        const e = s.variables._encuesta ?? { paso: 'calificacion' };
        if (e.paso === 'comentario') {
          const comentario = PALABRAS_NO.includes(normalizar(texto)) ? '' : texto.trim().slice(0, 500);
          delete s.variables._encuesta;
          ejecucion.efectos.push({ tipo: 'encuesta', calificacion: e.calificacion, comentario });
          return this.#cerrarEncuesta(ejecucion, d, e.calificacion, salir, comentario);
        }
        const n = Number.parseInt(normalizar(texto), 10);
        if (!(n >= 1 && n <= 5) || String(n) !== normalizar(texto)) {
          return reintentar('Responde con un número del 1 al 5, por favor.', `"${texto}" no es una calificación del 1 al 5.`);
        }
        s.variables.calificacion = n;
        if (d.pedirComentario) {
          s.variables._encuesta = { paso: 'comentario', calificacion: n };
          Object.assign(paso, { texto: `El cliente calificó con ${n}; el bot le pide un comentario.`, espera: true });
          await this.#mostrar(ejecucion, nodo, { reintento: true });
          return ESPERAR;
        }
        delete s.variables._encuesta;
        ejecucion.efectos.push({ tipo: 'encuesta', calificacion: n, comentario: '' });
        return this.#cerrarEncuesta(ejecucion, d, n, salir);
      }
      case 'permiso': {
        const t = normalizar(texto);
        const si = PALABRAS_SI.includes(t) || /^si\b/.test(t);
        const no = PALABRAS_NO.includes(t) || /^no\b/.test(t);
        if (!si && !no) return reintentar('Responde *1* para sí o *2* para no.', `"${texto}" no es sí ni no.`);
        ejecucion.efectos.push({ tipo: 'permiso', acepta: si });
        s.variables.aceptaPromos = si ? 'sí' : 'no';
        if (si) this.#decir(ejecucion, d.textoSi || '¡Listo! Te avisaremos de promociones. Puedes escribir *BAJA* cuando quieras dejar de recibirlas.');
        else if (d.textoNo) this.#decir(ejecucion, d.textoNo);
        return salir(si ? 'acepto' : 'no_acepto', si ? 'El cliente aceptó recibir promociones.' : 'El cliente no quiso recibir promociones.');
      }
      case 'ia': {
        s.variables.pregunta = texto;
        const respuesta = await this.#preguntarIA(ejecucion, texto);
        if (!respuesta) {
          if (d.textoNoSabe) this.#decir(ejecucion, d.textoNoSabe);
          return salir('no_sabe', `La IA no encontró la respuesta a "${texto}" en la información del negocio, así que se fue por "No supo".`);
        }
        s.variables.respuestaIA = respuesta;
        this.#decir(ejecucion, respuesta, false);
        return salir('respondio', `El cliente preguntó "${texto}" y la IA contestó usando la información del negocio.`);
      }
      case 'catalogo': {
        const t = normalizar(texto);
        if (['0', 'listo', 'terminar', 'nada', 'no'].includes(t)) return salir('listo', 'El cliente terminó de elegir (escribió 0).');
        const m = t.match(/^(\d+)(?:\s*(?:x|,|\s)\s*(\d+))?$/);
        const ids = s.variables._catalogo ?? [];
        const indice = m ? Number(m[1]) - 1 : -1;
        if (indice < 0 || indice >= ids.length) {
          return reintentar(
            'Escribe el número de un producto de la lista, o *0* para terminar.',
            `"${texto}" no es un número de la lista, así que el bot vuelve a mostrar el catálogo.`,
          );
        }
        const [producto] = await this.productos.buscarPorIds(contexto.empresaId, [ids[indice]]);
        if (!producto || !producto.activo) return reintentar('Ese producto ya no está disponible, elige otro.', 'Eligió algo que ya no está disponible.');
        s.variables.producto = {
          nombre: producto.nombre,
          precio: dinero(producto.precio, contexto.moneda),
          descripcion: producto.descripcion ?? '',
          duracionMin: producto.duracionMin ?? null,
        };
        if (d.modo === 'elegir') {
          // Un solo producto o servicio, sin carrito (p. ej. elegir el servicio y luego agendar)
          const eleccion = this.#texto(ejecucion, d.textoAgregado || 'Elegiste *{{producto.nombre}}*.');
          if (d.mostrarImagen && producto.imagenUrl) this.#emitir(ejecucion, { tipo: 'imagen', url: producto.imagenUrl, texto: eleccion });
          else this.#decir(ejecucion, eleccion, false);
          return salir('agregado', `El cliente eligió "${producto.nombre}".`);
        }
        const cantidad = Math.min(Math.max(Number(m[2] ?? 1), 1), 99);
        s.carrito = agregarAlCarrito(s.carrito, producto, cantidad);
        s.variables.cantidad = cantidad;
        s.variables.total = dinero(totalCarrito(s.carrito), contexto.moneda);
        const confirmacion = this.#texto(ejecucion, d.textoAgregado || 'Agregué *{{cantidad}} x {{producto.nombre}}* a tu pedido. Total: {{total}}');
        if (d.mostrarImagen && producto.imagenUrl) this.#emitir(ejecucion, { tipo: 'imagen', url: producto.imagenUrl, texto: confirmacion });
        else this.#decir(ejecucion, confirmacion, false);
        return salir('agregado', `Se agregaron ${cantidad} x "${producto.nombre}" al carrito (total ${s.variables.total}).`);
      }
      default:
        return null;
    }
  }

  // ───── Agenda: dos pasos dentro del mismo bloque (día → hora), guardados en variables._cita ─────

  #agenda(contexto, nodo, sesion) {
    const e = contexto.empresa ?? {};
    const horario = e.horario ?? { dias: [1, 2, 3, 4, 5], apertura: '09:00', cierre: '18:00', intervaloMin: 30, capacidad: 1 };
    const duracionMin = Number(nodo.datos?.duracionMin) || sesion.variables.producto?.duracionMin || horario.intervaloMin;
    return { horario, zona: e.zonaHoraria ?? 'America/Mexico_City', duracionMin, diasAdelante: Number(nodo.datos?.diasAdelante) || 14 };
  }

  async #ocupadas(contexto, diasAdelante) {
    const { desde, hasta } = rangoBusqueda(this.reloj(), diasAdelante);
    return this.citas.ocupadas(contexto.empresaId, desde, hasta);
  }

  async #mostrarAgenda(ejecucion, nodo, paso) {
    const { flujo, sesion: s, contexto } = ejecucion;
    const d = nodo.datos ?? {};
    const a = this.#agenda(contexto, nodo, s);
    const ocupadas = await this.#ocupadas(contexto, a.diasAdelante);
    const cita = s.variables._cita;
    const esperar = (explicacion) => {
      if (paso) Object.assign(paso, { texto: explicacion, espera: true });
      return ESPERAR;
    };

    if (cita?.paso === 'hora') {
      const espacios = espaciosDelDia({ ...a, fecha: cita.fecha, ahora: this.reloj(), ocupadas }).slice(0, 24);
      cita.horas = espacios.map((x) => x.hora);
      const lista = cita.horas.map((h, i) => `*${i + 1}.* ${h}`).join('\n');
      this.#decir(ejecucion, `Horarios libres el *${nombreDia(cita.fecha)}*:\n\n${lista}\n\nEscribe el número del horario, o *0* para elegir otro día.`, false);
      return esperar(`El bot mostró ${cita.horas.length} horarios libres del ${nombreDia(cita.fecha)} y espera que elija uno.`);
    }

    const dias = diasDisponibles({ ...a, ahora: this.reloj(), ocupadas });
    if (dias.length === 0) {
      this.#decir(ejecucion, d.textoSinEspacio || 'Por ahora no tenemos horarios disponibles.');
      if (paso) Object.assign(paso, { puerto: 'sin_espacio', error: true, texto: 'No hay horarios libres en los próximos días, así que se fue por "Sin horario".' });
      return flujo.siguiente(nodo.id, 'sin_espacio');
    }
    s.variables._cita = { paso: 'dia', dias: dias.map((x) => x.fecha) };
    const lista = dias.map((x, i) => `*${i + 1}.* ${x.nombre}`).join('\n');
    this.#decir(ejecucion, `${this.#texto(ejecucion, d.texto || '¿Qué día te acomoda?')}\n\n${lista}\n\nEscribe el número del día, o *0* si prefieres no agendar.`, false);
    return esperar(`El bot revisó la agenda (${a.duracionMin} min por cita) y ofreció ${dias.length} días con lugar.`);
  }

  async #responderAgenda(ejecucion, nodo, texto, reintentar, salir, paso) {
    const { sesion: s, contexto } = ejecucion;
    const d = nodo.datos ?? {};
    const cita = s.variables._cita ?? { paso: 'dia', dias: [] };
    const t = normalizar(texto);
    const n = /^\d+$/.test(t) ? Number(t) : NaN;

    if (cita.paso === 'dia') {
      if (n === 0) {
        delete s.variables._cita;
        return salir('sin_espacio', 'El cliente prefirió no agendar (escribió 0).');
      }
      const fecha = cita.dias[n - 1];
      if (!fecha) return reintentar('Escribe el número de uno de los días de la lista.', `"${texto}" no es uno de los días de la lista.`);
      s.variables._cita = { paso: 'hora', fecha };
      Object.assign(paso, { texto: `El cliente eligió el ${nombreDia(fecha)}; ahora el bot le muestra las horas libres.`, espera: true });
      await this.#mostrarAgenda(ejecucion, nodo, null);
      return ESPERAR;
    }

    if (n === 0) {
      delete s.variables._cita;
      Object.assign(paso, { texto: 'El cliente quiso cambiar de día; el bot vuelve a mostrar los días.', espera: true });
      await this.#mostrarAgenda(ejecucion, nodo, null);
      return ESPERAR;
    }
    const hora = cita.horas?.[n - 1];
    if (!hora) return reintentar('Escribe el número de uno de los horarios de la lista.', `"${texto}" no es uno de los horarios de la lista.`);

    // Volver a revisar: alguien pudo ganar ese horario mientras el cliente escribía
    const a = this.#agenda(contexto, nodo, s);
    const ocupadas = await this.#ocupadas(contexto, a.diasAdelante);
    const libre = espaciosDelDia({ ...a, fecha: cita.fecha, ahora: this.reloj(), ocupadas }).find((x) => x.hora === hora);
    if (!libre) return reintentar('Uy, ese horario se acaba de ocupar. Elige otro:', 'Ese horario se ocupó mientras el cliente escribía.');

    const creada = await this.citas.crear({
      empresaId: contexto.empresaId,
      botId: contexto.botId,
      canal: contexto.canal ?? 'whatsapp',
      contacto: s.contacto,
      nombreContacto: s.variables.cliente || s.nombre,
      servicio: d.servicio || s.variables.producto?.nombre || '',
      inicio: libre.inicio,
      fin: libre.fin,
      datos: Object.fromEntries(Object.entries(s.variables).filter(([k]) => !k.startsWith('_'))),
    });
    delete s.variables._cita;
    s.variables.cita = { fecha: nombreDia(cita.fecha), hora, folio: creada.folio };
    ejecucion.efectos.push({ tipo: 'cita', citaId: creada.id });
    const termino = (contexto.empresa?.terminos?.cita ?? 'cita').toLowerCase();
    this.#decir(ejecucion, d.textoConfirmacion || `¡Listo! Tu ${termino} quedó para el *{{cita.fecha}}* a las *{{cita.hora}}*. Folio: {{cita.folio}}`);
    return salir('agendada', `Se apartó la ${termino} del ${nombreDia(cita.fecha)} a las ${hora} (folio ${creada.folio}).`);
  }

  #cerrarEncuesta(ejecucion, d, calificacion, salir, comentario = '') {
    const buena = calificacion >= 4;
    this.#decir(ejecucion, (buena ? d.textoBuena : d.textoMala) || '¡Gracias por tu calificación!');
    const extra = comentario ? ` y comentó "${comentario}"` : '';
    return salir(buena ? 'buena' : 'mala', `El cliente calificó con ${calificacion} de 5${extra}.`);
  }

  /** Pregunta libre → respuesta con la información del negocio, o null si no la sabe (o no hay IA). */
  async #preguntarIA({ contexto }, pregunta) {
    if (!this.respondedor) return null;
    const e = contexto.empresa ?? {};
    return this.respondedor.responder({
      pregunta,
      empresaId: contexto.empresaId,
      empresa: { nombre: contexto.nombreEmpresa, conocimiento: e.conocimiento, horario: e.horario, moneda: contexto.moneda },
    });
  }

  // ───── Estado y salida ─────

  #reiniciar(s, contexto) {
    s.estado = 'activa';
    s.nodoActual = null;
    s.variables = { nombre: s.nombre ?? '', telefono: s.contacto, empresa: contexto.nombreEmpresa ?? '' };
    s.carrito = [];
    s.carritoRecordado = null;
  }

  #terminar(s) {
    s.estado = 'terminada';
    s.nodoActual = null;
  }

  /** Abre un paso del recorrido para este bloque; lo que el bot diga a continuación queda ligado a él. */
  #paso(ejecucion, nodo, texto = '', extra = {}) {
    const paso = { nodoId: nodo.id, tipo: nodo.tipo, puerto: null, texto, ...extra };
    ejecucion.recorrido.push(paso);
    return paso;
  }

  /** Nota suelta sobre el último paso (p. ej. "esa salida no está conectada"). */
  #nota(ejecucion, texto, extra = {}) {
    const ultimo = ejecucion.recorrido.at(-1);
    if (ultimo) Object.assign(ultimo, { texto: `${ultimo.texto} ${texto}`.trim(), ...extra });
  }

  #texto(ejecucion, plantilla) {
    return interpolar(plantilla, ejecucion.sesion.variables);
  }

  #emitir(ejecucion, respuesta) {
    ejecucion.respuestas.push({ ...respuesta, paso: Math.max(ejecucion.recorrido.length - 1, 0) });
  }

  #decir(ejecucion, texto, conVariables = true) {
    const final = conVariables ? this.#texto(ejecucion, texto) : String(texto ?? '');
    if (final.trim()) this.#emitir(ejecucion, { tipo: 'texto', texto: final });
  }

  #resultado({ respuestas, recorrido, efectos, sesion }) {
    sesion.actualizadoEn = this.reloj();
    return { respuestas, recorrido, efectos, sesion };
  }
}

const NOMBRE_DATO = { numero: 'número', email: 'correo', telefono: 'teléfono', texto: 'texto' };

/** 90 → "1 h 30 min"; 2880 → "2 días". */
function duracion(minutos) {
  if (minutos % 1440 === 0) return `${minutos / 1440} día${minutos === 1440 ? '' : 's'}`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

/** "Corte de cabello (45 min) — desde $150.00" */
function lineaCatalogo(p, moneda) {
  const precio = p.precio > 0 ? ` — ${p.precioDesde ? 'desde ' : ''}${dinero(p.precio, moneda)}` : '';
  const duracion = p.tipo === 'servicio' && p.duracionMin ? ` (${p.duracionMin} min)` : '';
  return `${p.nombre}${duracion}${precio}${p.descripcion ? `\n    _${p.descripcion}_` : ''}`;
}

const ESPERAR = Symbol('esperar');
const DETENER = Symbol('detener');
