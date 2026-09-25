import { TIPOS_DE_NODO, VALIDACIONES_PREGUNTA, OPERADORES, puertosDe } from './tiposDeNodo.js';

/**
 * Definición de un flujo: nodos (bloques) + conexiones (flechas), tal como la dibuja el editor.
 *
 *   nodo      = { id, tipo, datos, posicion: { x, y } }
 *   conexion  = { id, origen, puerto, destino }
 *
 * No sabe nada de JointJS: el editor traduce su grafo a esta forma y de vuelta.
 */
export class Flujo {
  constructor({ nodos = [], conexiones = [] } = {}) {
    this.nodos = nodos;
    this.conexiones = conexiones;
  }

  nodo(id) {
    return this.nodos.find((n) => n.id === id) ?? null;
  }

  inicio() {
    return this.nodos.find((n) => n.tipo === 'inicio') ?? null;
  }

  /** Nodo al que lleva el puerto `puerto` de `origenId`, o null si esa salida no está conectada. */
  siguiente(origenId, puerto) {
    const c = this.conexiones.find((x) => x.origen === origenId && x.puerto === puerto);
    return c ? this.nodo(c.destino) : null;
  }

  /**
   * Revisa el flujo completo. Devuelve problemas con nivel:
   *  - `error`: no se puede publicar (el bot se rompería).
   *  - `aviso`: se puede publicar, pero algo quedó a medias (una salida sin conectar).
   */
  revisar() {
    const problemas = [];
    const error = (nodoId, mensaje) => problemas.push({ nivel: 'error', nodoId, mensaje });
    const aviso = (nodoId, mensaje) => problemas.push({ nivel: 'aviso', nodoId, mensaje });

    const inicios = this.nodos.filter((n) => n.tipo === 'inicio');
    if (inicios.length === 0) error(null, 'El flujo necesita un bloque de Inicio');
    if (inicios.length > 1) error(inicios[1].id, 'Solo puede haber un bloque de Inicio');

    const ids = new Set();
    for (const n of this.nodos) {
      if (ids.has(n.id)) error(n.id, 'Hay dos bloques con el mismo id');
      ids.add(n.id);
      if (!TIPOS_DE_NODO[n.tipo]) {
        error(n.id, `Tipo de bloque desconocido: ${n.tipo}`);
        continue;
      }
      this.#revisarDatos(n, error);
      for (const puerto of puertosDe(n)) {
        if (!this.siguiente(n.id, puerto)) aviso(n.id, `La salida "${etiquetaPuerto(n, puerto)}" no está conectada`);
      }
    }

    for (const c of this.conexiones) {
      const origen = this.nodo(c.origen);
      if (!origen || !this.nodo(c.destino)) error(c.origen ?? null, 'Hay una flecha que apunta a un bloque que ya no existe');
      else if (!puertosDe(origen).includes(c.puerto)) error(origen.id, `La salida "${c.puerto}" no existe en este bloque`);
    }
    const repetidas = new Set();
    for (const c of this.conexiones) {
      const llave = `${c.origen}|${c.puerto}`;
      if (repetidas.has(llave)) error(c.origen, 'Una salida solo puede ir a un bloque');
      repetidas.add(llave);
    }

    const inicio = inicios[0];
    if (inicio) {
      const alcanzables = this.#alcanzables(inicio.id);
      for (const n of this.nodos) if (!alcanzables.has(n.id)) aviso(n.id, 'Este bloque no se alcanza desde el Inicio');
    }
    return problemas;
  }

  tieneErrores() {
    return this.revisar().some((p) => p.nivel === 'error');
  }

  #revisarDatos(n, error) {
    const d = n.datos ?? {};
    const vacio = (v) => typeof v !== 'string' || v.trim() === '';
    switch (n.tipo) {
      case 'mensaje':
        if (vacio(d.texto) && vacio(d.imagenUrl)) error(n.id, 'El mensaje está vacío');
        break;
      case 'menu':
        if (vacio(d.texto)) error(n.id, 'El menú necesita un texto');
        if (!Array.isArray(d.opciones) || d.opciones.length === 0) error(n.id, 'El menú necesita al menos una opción');
        else if (d.opciones.some((o) => vacio(o.etiqueta))) error(n.id, 'Hay una opción del menú sin texto');
        break;
      case 'pregunta':
        if (vacio(d.texto)) error(n.id, 'La pregunta está vacía');
        if (vacio(d.variable) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(d.variable)) error(n.id, 'La variable debe ser una palabra sin espacios (ej. nombre, direccion)');
        if (d.validacion && !VALIDACIONES_PREGUNTA.includes(d.validacion)) error(n.id, 'Validación desconocida');
        break;
      case 'condicion':
        if (vacio(d.variable)) error(n.id, 'La condición necesita una variable');
        if (!OPERADORES.includes(d.operador)) error(n.id, 'Operador desconocido');
        break;
      case 'webhook':
        if (vacio(d.url) || !/^https?:\/\//.test(d.url)) error(n.id, 'La tarea necesita la URL del webhook de n8n');
        break;
      default:
        break;
    }
  }

  #alcanzables(desde) {
    const vistos = new Set([desde]);
    const pendientes = [desde];
    while (pendientes.length) {
      const id = pendientes.pop();
      for (const c of this.conexiones) {
        if (c.origen === id && !vistos.has(c.destino)) {
          vistos.add(c.destino);
          pendientes.push(c.destino);
        }
      }
    }
    return vistos;
  }
}

const ETIQUETAS = { siguiente: 'Siguiente', agregado: 'Agregó producto', listo: 'Terminó', vacio: 'Carrito vacío', si: 'Sí', no: 'No', ok: 'Éxito', error: 'Falló', agendada: 'Agendó', sin_espacio: 'Sin horario / canceló', respondio: 'Respondió', no_sabe: 'No supo' };

function etiquetaPuerto(nodo, puerto) {
  if (!puerto.startsWith('opcion:')) return ETIQUETAS[puerto] ?? puerto;
  const id = puerto.slice('opcion:'.length);
  return nodo.datos?.opciones?.find((o) => o.id === id)?.etiqueta ?? puerto;
}
