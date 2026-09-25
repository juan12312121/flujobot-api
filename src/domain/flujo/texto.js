/** Reglas puras de texto del bot: plantillas, comparación de respuestas y validación de datos. */

/** Quita acentos, mayúsculas y espacios de más para comparar lo que escribe la gente. */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Hola {{nombre}}" → "Hola Ana". Variables desconocidas quedan vacías. Acepta rutas: {{producto.precio}}. */
export function interpolar(plantilla, variables) {
  return String(plantilla ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, ruta) => {
    const valor = ruta.split('.').reduce((obj, k) => (obj == null ? undefined : obj[k]), variables);
    return valor == null ? '' : String(valor);
  });
}

/**
 * ¿Qué opción eligió? Acepta el número ("2"), el texto exacto ("Ver catálogo")
 * o una palabra clave de la opción. Devuelve la opción o null.
 */
export function elegirOpcion(opciones, respuesta) {
  const r = normalizar(respuesta);
  if (!r) return null;
  const numero = Number.parseInt(r, 10);
  if (String(numero) === r && numero >= 1 && numero <= opciones.length) return opciones[numero - 1];
  return (
    opciones.find((o) => normalizar(o.etiqueta) === r) ??
    opciones.find((o) => (o.palabras ?? []).some((p) => normalizar(p) === r)) ??
    null
  );
}

/** ¿El mensaje dispara el bot? Sin palabras clave, cualquier mensaje lo inicia. */
export function disparaInicio(palabrasClave, texto) {
  const lista = (palabrasClave ?? []).map(normalizar).filter(Boolean);
  if (lista.length === 0) return true;
  const t = normalizar(texto);
  return lista.some((p) => t === p || t.split(' ').includes(p) || t.includes(p));
}

const VALIDADORES = {
  texto: (v) => v.trim().length > 0,
  numero: (v) => /^-?\d+([.,]\d+)?$/.test(v.trim()),
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
  telefono: (v) => v.replace(/\D/g, '').length >= 10,
};

/** Valida y limpia la respuesta a una pregunta. Devuelve { ok, valor }. */
export function validarRespuesta(tipo, respuesta) {
  const v = String(respuesta ?? '');
  const valido = (VALIDADORES[tipo] ?? VALIDADORES.texto)(v);
  if (!valido) return { ok: false };
  if (tipo === 'numero') return { ok: true, valor: Number(v.trim().replace(',', '.')) };
  if (tipo === 'telefono') return { ok: true, valor: v.replace(/\D/g, '') };
  return { ok: true, valor: v.trim() };
}

/** Formato de dinero para los mensajes: 1234.5 → "$1,234.50". */
export function dinero(monto, moneda = 'MXN') {
  const texto = Number(monto ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'MXN' ? `$${texto}` : `${texto} ${moneda}`;
}
