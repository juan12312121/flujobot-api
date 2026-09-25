import { TIPOS_DE_NODO } from '../../domain/flujo/tiposDeNodo.js';
import { interpolar, elegirOpcion, disparaInicio, validarRespuesta, normalizar, dinero } from '../../domain/flujo/texto.js';
import { cumpleCondicion, describirCondicion } from '../../domain/flujo/condiciones.js';
import { agregarAlCarrito, totalCarrito, resumenCarrito } from '../../domain/pedidos/carrito.js';
import { diasDisponibles, espaciosDelDia, rangoBusqueda, nombreDia } from '../../domain/agenda/disponibilidad.js';

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
   *   reloj?: () => Date,
   * }} deps
   */
  constructor({ productos, pedidos, citas, clienteWebhook, respondedor, reloj = () => new Date() }) {
    this.respondedor = respondedor;
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
    const ejecucion = { flujo, contexto, texto, respuestas: [], recorrido: [], sesion: structuredClone(sesion) };
    const s = ejecucion.sesion;
    const inicio = flujo.inicio();
    if (!inicio) return this.#resultado(ejecucion);

    if (s.estado === 'humano') {
      this.#paso(ejecucion, inicio, 'La conversación está con una persona: el bot no contesta hasta que la devuelvan.', { error: true });
      return this.#resultado(ejecucion);
    }

    const expira = (inicio.datos?.expiraMinutos ?? EXPIRA_MINUTOS) * 60_000;
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
          datos: { ...s.variables },
        });
        s.variables.folio = pedido.folio;
        s.variables.total = dinero(pedido.total, contexto.moneda);
        const conProductos = s.carrito.length > 0;
        s.carrito = [];
        this.#decir(
          ejecucion,
          d.texto ||
            (conProductos
              ? '¡Listo! Tu pedido *{{folio}}* quedó registrado por {{total}}. Te contactaremos pronto.'
              : '¡Gracias! Registramos tu solicitud *{{folio}}*. Te contactaremos pronto.'),
        );
        return ir(
          'siguiente',
          conProductos
            ? `Se registró el pedido ${pedido.folio} por ${s.variables.total}.`
            : `Se registró la solicitud ${pedido.folio} con los datos que dio el cliente.`,
        );
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
    const termino = (contexto.empresa?.terminos?.cita ?? 'cita').toLowerCase();
    this.#decir(ejecucion, d.textoConfirmacion || `¡Listo! Tu ${termino} quedó para el *{{cita.fecha}}* a las *{{cita.hora}}*. Folio: {{cita.folio}}`);
    return salir('agendada', `Se apartó la ${termino} del ${nombreDia(cita.fecha)} a las ${hora} (folio ${creada.folio}).`);
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

  #resultado({ respuestas, recorrido, sesion }) {
    sesion.actualizadoEn = this.reloj();
    return { respuestas, recorrido, sesion };
  }
}

const NOMBRE_DATO = { numero: 'número', email: 'correo', telefono: 'teléfono', texto: 'texto' };

/** "Corte de cabello (45 min) — desde $150.00" */
function lineaCatalogo(p, moneda) {
  const precio = p.precio > 0 ? ` — ${p.precioDesde ? 'desde ' : ''}${dinero(p.precio, moneda)}` : '';
  const duracion = p.tipo === 'servicio' && p.duracionMin ? ` (${p.duracionMin} min)` : '';
  return `${p.nombre}${duracion}${precio}${p.descripcion ? `\n    _${p.descripcion}_` : ''}`;
}

const ESPERAR = Symbol('esperar');
const DETENER = Symbol('detener');
