import { UseCase } from '../../shared/UseCase.js';
import { ServicioExternoError } from '../../shared/errors.js';
import { Flujo } from '../../../domain/flujo/Flujo.js';
import { TIPOS_DE_NODO } from '../../../domain/flujo/tiposDeNodo.js';
import { acomodar } from '../../../domain/flujo/acomodar.js';
import { GIROS } from '../../../domain/empresa/giros.js';

const MAX_BLOQUES = 30;
const INTENTOS = 3;
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Lo que la IA necesita saber de cada bloque. Es el "manual" que le damos junto con la petición. */
const SISTEMA = `Eres el asistente de FlujoBot, una herramienta para que pymes (tiendas, salones, consultorios,
talleres, escuelas, inmobiliarias...) armen su bot de WhatsApp sin saber programar.
Conviertes lo que la persona describe con sus palabras en un FLUJO de bloques conectados.

## Bloques disponibles (campo "tipo") con sus "datos" y sus salidas ("puerto")
- inicio: arranca el bot. datos: { "palabrasClave": [], "palabrasReinicio": ["reiniciar", "menu principal"] }. Salida: "siguiente". Siempre exactamente UNO, con id "inicio".
- mensaje: envía un texto. datos: { "texto": "..." }. Salida: "siguiente".
- menu: muestra opciones numeradas y espera. datos: { "texto": "pregunta", "opciones": [{ "id": "corto_sin_espacios", "etiqueta": "Texto corto" }] }. Una salida por opción: "opcion:<id de la opción>". Máximo 8 opciones, etiquetas de 2 a 5 palabras.
- pregunta: pide un dato y lo guarda. datos: { "texto": "¿...?", "variable": "palabra_sin_espacios", "validacion": "texto" | "numero" | "email" | "telefono" }. Salida: "siguiente".
- catalogo: muestra los productos o servicios de la empresa. datos: { "texto": "encabezado", "modo": "carrito" | "elegir", "categoria": "" }. modo "carrito" = arma un pedido con varios productos; modo "elegir" = escoge uno (ideal para servicios antes de agendar). Salidas: "agregado" (agregó o eligió) y "listo" (escribió 0 / terminó).
- carrito: muestra el resumen del pedido. datos: { "texto": "*Tu pedido:*" }. Salidas: "siguiente" y "vacio".
- pedido: registra un pedido o solicitud con folio. datos: { "texto": "confirmación, puede usar {{folio}}, {{total}} y {{linkPago}}", "sinProductos": true|false, "cobrar": true|false }. sinProductos true = solicitud/prospecto/cotización sin carrito. cobrar true = manda un link de pago en línea (solo si la persona pide cobrar o pagar en línea). Salida: "siguiente".
- cita: ofrece días y horas libres según el horario de la empresa y aparta la cita. datos: { "texto": "¿Qué día te acomoda?", "diasAdelante": 14 }. Salidas: "agendada" y "sin_espacio".
- condicion: compara una variable. datos: { "variable": "nombre_variable", "operador": "igual" | "distinto" | "contiene" | "mayor" | "menor" | "existe", "valor": "..." }. Salidas: "si" y "no".
- webhook: tarea automática en n8n (avisar a un sistema, consultar un estatus...). datos: { "url": "https://tu-n8n/webhook/nombre-de-la-tarea" }. Salidas: "ok" y "error". Úsalo SOLO si la persona pide conectar con otro sistema.
- ia: el cliente pregunta con sus palabras y la IA contesta con la información del negocio. datos: { "texto": "¿Qué te gustaría saber?", "textoNoSabe": "..." }. Salidas: "respondio" y "no_sabe".
- estado: "¿cómo va mi pedido?": muestra el estado de los últimos pedidos y citas del cliente. datos: { "texto": "Esto es lo que encontré:", "que": "ambos" | "pedidos" | "citas" }. Salidas: "encontrado" y "nada".
- esperar: espera a que el cliente conteste un tiempo; si no contesta, sigue por otra salida (seguimientos, recordatorios). datos: { "texto": "mensaje opcional", "minutos": 120 }. Salidas: "respondio" (guarda {{respuesta}}) y "sin_respuesta".
- encuesta: pide calificar la atención del 1 al 5. datos: { "texto": "...", "pedirComentario": true|false }. Salidas: "buena" (4-5) y "mala" (1-3).
- permiso: pregunta si acepta recibir promociones (sin permiso no entra a las campañas). datos: { "texto": "..." }. Salidas: "acepto" y "no_acepto".
- registro: guarda lo que dio el cliente en un MÓDULO de la empresa (ver "Módulos" abajo). datos: { "moduloId": "id del módulo", "campos": { "idDelCampo": "{{variable}}" }, "texto": "confirmación con {{folio}}" }. Salida: "siguiente". Pide antes los datos con bloques "pregunta".
- consulta: muestra al cliente sus registros de un módulo (p. ej. "¿cómo va mi reparación?"). datos: { "moduloId": "id del módulo", "texto": "..." }. Salidas: "encontrado" y "nada".
- humano: pasa la conversación a una persona del equipo. datos: { "texto": "..." }. Sin salidas.
- fin: termina la conversación. datos: { "texto": "despedida" }. Sin salidas.

## Variables que se pueden usar en los textos con {{ }}
{{nombre}} (nombre de WhatsApp del cliente), {{empresa}}, {{opcion}}, {{producto.nombre}}, {{producto.precio}}, {{total}}, {{folio}},
{{cita.fecha}}, {{cita.hora}}, {{cita.folio}}, {{respuesta}} (bloque esperar), {{linkPago}} y cualquier variable que guarde un bloque "pregunta".

## Reglas
0. Haz SOLO lo que la persona pidió. NO agregues funciones que no mencionó (reservaciones, citas, asesor,
   preguntas frecuentes, ubicación...), aunque el giro del negocio las sugiera: los datos de la empresa son contexto, no pedidos.
   Si el bot tiene UN solo propósito (p. ej. "tomar pedidos"), NO pongas un menú inicial: saluda y ve directo a eso.
   Usa un menú inicial solo si la persona pidió 2 o más cosas distintas.
1. Conecta TODAS las salidas de todos los bloques. Cada rama termina en "fin", en "humano" o regresa a un menú.
2. Después de mostrar información (horarios, precios, ubicación) ofrece volver al menú o terminar.
3. Textos en español de México, cordiales, breves y claros, SIN emojis. Usa *negritas* de WhatsApp con moderación.
4. Si la empresa tiene catálogo y el cliente debe elegir productos o servicios, usa el bloque "catalogo" (se actualiza solo con los precios reales), NO un menú con los nombres escritos a mano. Si no tiene catálogo, usa "catalogo" solo si la persona habla de productos/servicios que se eligen. Solo usa "cita" si la persona habla de citas, reservaciones o visitas.
5. Antes de "pedido" o "cita" pide los datos necesarios con bloques "pregunta" (nombre, dirección, correo...).
   Si juntas datos para que el negocio dé seguimiento (inscripción, cotización, prospecto), TERMINA con un bloque "pedido" con "sinProductos": true; si no, esos datos se pierden.
   Para comparar montos usa la variable {{total}} con operador "mayor" o "menor" (se compara como número).
6. Máximo ${MAX_BLOQUES} bloques. Ids cortos, en minúsculas y sin espacios (ej. "menu", "pedir_nombre").
7. Si te dan un flujo actual para modificar, conserva los ids y textos de lo que no cambia y devuelve el flujo COMPLETO.

## Respuesta: SOLO un objeto JSON compacto (sin sangrías ni saltos de línea) con esta forma
{
  "resumen": "Explicación en 2 a 4 frases sencillas, para alguien sin experiencia, de qué hace el bot.",
  "supuestos": ["Cosas que supusiste porque la persona no las dijo (máximo 4)."],
  "nodos": [{ "id": "inicio", "tipo": "inicio", "datos": { } }],
  "conexiones": [{ "origen": "inicio", "puerto": "siguiente", "destino": "menu" }]
}`;

/**
 * Asistente de IA: convierte una descripción en lenguaje natural en un flujo listo para el lienzo.
 * No guarda nada: devuelve la propuesta y la persona decide si la aplica.
 */
export class GenerarFlujoConIA extends UseCase {
  constructor({ ia, empresas, productos, modulos }) {
    super();
    Object.assign(this, { ia, empresas, productos, modulos });
  }

  /**
   * @param {{ actor: object, descripcion: string, base?: { nodos: object[], conexiones: object[] } }} entrada
   */
  async ejecutar({ actor, descripcion, base }) {
    const [empresa, catalogo, modulos] = await Promise.all([
      this.empresas.obtener(actor.empresaId),
      this.productos.buscar(actor.empresaId, { soloActivos: true }),
      this.modulos ? this.modulos.deEmpresa(actor.empresaId) : [],
    ]);
    const mensajes = [{ role: 'user', content: this.#peticion({ descripcion, base, empresa, catalogo, modulos }) }];

    let propuesta;
    let problemas = [];
    let modelo;
    for (let intento = 1; intento <= INTENTOS; intento++) {
      const r = await this.ia.completarJson({ sistema: SISTEMA, mensajes });
      modelo = r.modelo;
      if (r.cortado) {
        // Se quedó sin espacio a medio JSON: pedir una versión más compacta
        if (intento === INTENTOS) throw new ServicioExternoError('El flujo salió demasiado largo. Describe una parte a la vez o pide algo más sencillo.');
        mensajes.push({ role: 'user', content: 'Tu respuesta anterior se cortó por larga. Hazlo más compacto: máximo 16 bloques, textos breves y JSON sin espacios.' });
        continue;
      }
      propuesta = limpiar(leerJson(r.texto));
      problemas = new Flujo(propuesta).revisar();
      const errores = problemas.filter((p) => p.nivel === 'error');
      if (errores.length === 0 || intento === INTENTOS) break;
      // Le regresamos sus errores para que los corrija (los mensajes de revisar() ya están en español)
      mensajes.push({ role: 'assistant', content: r.texto });
      mensajes.push({
        role: 'user',
        content: `El flujo tiene estos errores:\n${errores.map((e) => `- ${e.nodoId ?? 'flujo'}: ${e.mensaje}`).join('\n')}\nCorrígelos y devuelve el JSON completo.`,
      });
    }

    const { nodos, conexiones } = acomodar(propuesta);
    return { resumen: propuesta.resumen, supuestos: propuesta.supuestos, nodos, conexiones, problemas, modelo };
  }

  #peticion({ descripcion, base, empresa, catalogo, modulos = [] }) {
    const t = empresa?.terminos ?? {};
    const h = empresa?.horario;
    const lineas = [
      `## Lo que pide la persona\n${descripcion}`,
      `## Datos de la empresa`,
      `- Nombre: ${empresa?.nombre ?? ''}`,
      `- Giro: ${GIROS[empresa?.giro]?.nombre ?? 'otro'}`,
      // Solo vocabulario para los textos: si se da como lista de "funciones", la IA las agrega aunque nadie las pidió
      `- Palabras que usa el negocio en sus textos: lo que ofrece = "${t.items ?? 'Productos'}", un pedido = "${t.pedido ?? 'Pedido'}"${
        empresa?.modulos?.agenda ? `, una cita = "${t.cita ?? 'Cita'}"` : ''
      }.`,
      h ? `- Horario: ${h.dias.map((d) => DIAS[d]).join(', ')} de ${h.apertura} a ${h.cierre}.` : '',
      catalogo.length
        ? `- Catálogo (${catalogo.length}): ${catalogo
            .slice(0, 25)
            .map((p) => `${p.nombre}${p.tipo === 'servicio' ? ' (servicio)' : ''}${p.categoria ? ` [${p.categoria}]` : ''}`)
            .join('; ')}`
        : '- Todavía no tiene catálogo cargado.',
      modulos.length
        ? `- Módulos (usa "registro"/"consulta" solo si lo que pide encaja con uno): ${modulos
            .map((m) => `${m.nombre} [moduloId ${m.id}] campos: ${m.campos.map((c) => `${c.id} (${c.tipo})`).join(', ')}`)
            .join(' | ')}`
        : '',
    ];
    if (base?.nodos?.length) {
      const actual = { nodos: base.nodos.map(({ id, tipo, datos }) => ({ id, tipo, datos })), conexiones: base.conexiones.map(({ origen, puerto, destino }) => ({ origen, puerto, destino })) };
      lineas.push(`## Flujo actual (modifícalo según lo que pide)\n${JSON.stringify(actual)}`);
    }
    return lineas.filter(Boolean).join('\n');
  }
}

/**
 * Saca el objeto JSON aunque venga envuelto en ```json ... ```, con texto alrededor o con el
 * "razonamiento" que algunos modelos gratuitos escriben antes (<think>...</think>).
 */
function leerJson(texto) {
  const limpio = texto.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const bloque = limpio.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? limpio;
  const candidatos = [bloque, limpio];
  for (const c of candidatos) {
    const inicio = c.indexOf('{');
    const fin = c.lastIndexOf('}');
    if (inicio < 0 || fin <= inicio) continue;
    try {
      return JSON.parse(c.slice(inicio, fin + 1));
    } catch {
      /* se intenta con el siguiente candidato */
    }
  }
  throw new ServicioExternoError('La IA devolvió un flujo que no se pudo leer. Intenta describirlo de otra forma.');
}

const slug = (t, respaldo) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || respaldo;

/** Deja solo bloques y flechas válidos: tipos conocidos, ids únicos, flechas entre bloques que existen. */
function limpiar(bruto) {
  const vistos = new Set();
  const nodos = [];
  for (const [i, n] of (Array.isArray(bruto?.nodos) ? bruto.nodos : []).slice(0, MAX_BLOQUES).entries()) {
    if (!TIPOS_DE_NODO[n?.tipo]) continue;
    let id = slug(n.id, `${n.tipo}_${i}`);
    while (vistos.has(id)) id = `${id}_${i}`;
    vistos.add(id);
    const datos = n.datos && typeof n.datos === 'object' ? { ...n.datos } : {};
    // El bot contesta a cualquier mensaje: las palabras clave de inicio las decide el negocio en el editor
    if (n.tipo === 'inicio') Object.assign(datos, { palabrasClave: [], palabrasReinicio: datos.palabrasReinicio?.length ? datos.palabrasReinicio : ['reiniciar', 'menu principal'] });
    const opciones = new Map(); // id original de la opción → id limpio
    if (n.tipo === 'menu') {
      const ids = new Set();
      datos.opciones = (Array.isArray(datos.opciones) ? datos.opciones : []).slice(0, 8).map((o, j) => {
        let oid = slug(o?.id ?? o?.etiqueta, `op${j + 1}`);
        while (ids.has(oid)) oid = `${oid}_${j}`;
        ids.add(oid);
        opciones.set(String(o?.id ?? ''), oid);
        return { id: oid, etiqueta: String(o?.etiqueta ?? `Opción ${j + 1}`).slice(0, 60) };
      });
    }
    nodos.push({ id, tipo: n.tipo, datos, idOriginal: n.id, opciones });
  }
  // Las flechas pueden venir con los ids originales: traducirlos a los limpios
  const traducir = new Map(nodos.map((n) => [n.idOriginal, n.id]));
  const porId = new Map(nodos.map((n) => [n.id, n]));
  const existe = new Set(nodos.map((n) => n.id));
  const conexiones = [];
  for (const c of Array.isArray(bruto?.conexiones) ? bruto.conexiones : []) {
    const origen = traducir.get(c?.origen) ?? c?.origen;
    const destino = traducir.get(c?.destino) ?? c?.destino;
    if (!existe.has(origen) || !existe.has(destino) || typeof c.puerto !== 'string') continue;
    let puerto = c.puerto;
    if (puerto.startsWith('opcion:')) {
      const original = puerto.slice('opcion:'.length);
      puerto = `opcion:${porId.get(origen).opciones.get(original) ?? slug(original, original)}`;
    }
    conexiones.push({ id: `c${conexiones.length + 1}`, origen, puerto, destino });
  }
  return {
    resumen: typeof bruto?.resumen === 'string' ? bruto.resumen : '',
    supuestos: Array.isArray(bruto?.supuestos) ? bruto.supuestos.filter((x) => typeof x === 'string').slice(0, 4) : [],
    nodos: nodos.map(({ idOriginal: _i, opciones: _o, ...n }) => n),
    conexiones,
  };
}
