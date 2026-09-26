/**
 * Módulos personalizados: cada empresa arma sus propias secciones (órdenes de servicio, inventario,
 * membresías...) con los campos que necesite, sin programar. Aquí viven las reglas: tipos de campo,
 * validación de la definición y de los datos de cada registro, y las plantillas de arranque.
 */

export const TIPOS_CAMPO = ['texto', 'textoLargo', 'numero', 'dinero', 'fecha', 'opcion', 'sino', 'telefono', 'email', 'imagen'];

export const MAX_CAMPOS = 20;

/** "Número de placas" → "numero_de_placas" (id estable del campo dentro del módulo). */
export function idDeCampo(nombre) {
  return (
    String(nombre)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || 'campo'
  );
}

/** "Órdenes de servicio" → "ordenes-de-servicio" (va en la URL del panel). */
export const claveDeModulo = (nombre) => idDeCampo(nombre).replace(/_/g, '-').slice(0, 40);

/**
 * Limpia la definición de campos: ids únicos, opciones solo en "opcion", "avisar" solo en opción.
 * @returns {{ campos: object[], errores: string[] }}
 */
export function normalizarCampos(entrada) {
  const errores = [];
  const vistos = new Set();
  const campos = [];
  for (const c of entrada ?? []) {
    const nombre = String(c.nombre ?? '').trim().slice(0, 60);
    if (!nombre) {
      errores.push('Hay un campo sin nombre');
      continue;
    }
    if (!TIPOS_CAMPO.includes(c.tipo)) {
      errores.push(`El campo "${nombre}" tiene un tipo desconocido`);
      continue;
    }
    let id = c.id && /^[a-z0-9_]{1,40}$/.test(c.id) ? c.id : idDeCampo(nombre);
    for (let i = 2; vistos.has(id); i++) id = `${idDeCampo(nombre).slice(0, 36)}_${i}`;
    vistos.add(id);
    const opciones = c.tipo === 'opcion' ? [...new Set((c.opciones ?? []).map((o) => String(o).trim()).filter(Boolean))].slice(0, 20) : [];
    if (c.tipo === 'opcion' && opciones.length === 0) errores.push(`El campo "${nombre}" necesita al menos una opción`);
    campos.push({
      id,
      nombre,
      tipo: c.tipo,
      opciones,
      requerido: Boolean(c.requerido),
      enLista: c.enLista !== false,
      avisar: c.tipo === 'opcion' && Boolean(c.avisar),
    });
  }
  if (campos.length === 0) errores.push('El módulo necesita al menos un campo');
  if (campos.length > MAX_CAMPOS) errores.push(`Máximo ${MAX_CAMPOS} campos por módulo`);
  return { campos: campos.slice(0, MAX_CAMPOS), errores };
}

const esFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

/**
 * Valida y convierte los datos de un registro según los campos del módulo.
 * `parcial`: solo revisa los campos que vienen (al editar); los requeridos faltantes no cuentan.
 * @returns {{ datos: object, errores: { campo: string, mensaje: string }[] }}
 */
export function validarDatos(campos, entrada = {}, { parcial = false } = {}) {
  const datos = {};
  const errores = [];
  const error = (c, mensaje) => errores.push({ campo: c.id, mensaje: `${c.nombre}: ${mensaje}` });
  for (const c of campos) {
    if (!(c.id in entrada)) {
      if (!parcial && c.requerido) error(c, 'es obligatorio');
      continue;
    }
    const crudo = entrada[c.id];
    const vacio = crudo === null || crudo === undefined || (typeof crudo === 'string' && crudo.trim() === '');
    if (vacio) {
      if (c.requerido) error(c, 'es obligatorio');
      else datos[c.id] = c.tipo === 'sino' ? false : null;
      continue;
    }
    const texto = String(crudo).trim();
    switch (c.tipo) {
      case 'numero':
      case 'dinero': {
        const n = Number(texto.replace(/[$,\s]/g, ''));
        if (!Number.isFinite(n)) error(c, 'debe ser un número');
        else datos[c.id] = c.tipo === 'dinero' ? Math.round(n * 100) / 100 : n;
        break;
      }
      case 'fecha':
        if (!esFecha(texto)) error(c, 'debe ser una fecha AAAA-MM-DD');
        else datos[c.id] = texto;
        break;
      case 'opcion': {
        const opcion = c.opciones.find((o) => o.toLowerCase() === texto.toLowerCase());
        if (!opcion) error(c, `debe ser una de: ${c.opciones.join(', ')}`);
        else datos[c.id] = opcion;
        break;
      }
      case 'sino':
        datos[c.id] = crudo === true || ['si', 'sí', 'true', '1'].includes(texto.toLowerCase());
        break;
      case 'telefono':
        if (texto.replace(/\D/g, '').length < 7) error(c, 'no parece un teléfono');
        else datos[c.id] = texto.replace(/[^\d+]/g, '');
        break;
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto)) error(c, 'no parece un correo');
        else datos[c.id] = texto.toLowerCase();
        break;
      case 'imagen':
        if (!/^https?:\/\//.test(texto)) error(c, 'debe ser una URL de imagen');
        else datos[c.id] = texto;
        break;
      case 'textoLargo':
        datos[c.id] = texto.slice(0, 3000);
        break;
      default:
        datos[c.id] = texto.slice(0, 300);
    }
  }
  return { datos, errores };
}

/** Texto plano de un registro para buscar ("placas ABC", "Juan"...). */
export const textoBusqueda = (folio, datos) =>
  [folio, ...Object.values(datos ?? {})]
    .filter((v) => v !== null && v !== undefined && typeof v !== 'boolean')
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .slice(0, 4000);

/** Valor de un campo como lo lee una persona ("$1,200.00", "Sí", "12 de marzo"...). */
export function valorLegible(campo, valor, moneda = 'MXN') {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (campo.tipo === 'sino') return valor ? 'Sí' : 'No';
  if (campo.tipo === 'dinero') {
    const t = Number(valor).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return moneda === 'MXN' ? `$${t}` : `${t} ${moneda}`;
  }
  if (campo.tipo === 'fecha') {
    return new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${valor}T12:00:00Z`));
  }
  return String(valor);
}

const campo = (nombre, tipo, extra = {}) => ({ nombre, tipo, enLista: false, ...extra });
const enLista = { enLista: true };

/** Módulos de arranque: se crean con un clic y luego se ajustan. */
export const PLANTILLAS_MODULO = {
  ordenes_servicio: {
    nombre: 'Órdenes de servicio',
    singular: 'Orden de servicio',
    icono: 'servicios',
    prefijo: 'OS',
    descripcion: 'Equipos o vehículos que entran a reparación, con su estado.',
    campos: [
      campo('Cliente', 'texto', { requerido: true, ...enLista }),
      campo('Teléfono', 'telefono', enLista),
      campo('Equipo o vehículo', 'texto', { requerido: true, ...enLista }),
      campo('Placas o número de serie', 'texto', enLista),
      campo('Falla reportada', 'textoLargo'),
      campo('Presupuesto', 'dinero', enLista),
      campo('Estado', 'opcion', { opciones: ['Recibido', 'En diagnóstico', 'En reparación', 'Listo para entregar', 'Entregado'], avisar: true, ...enLista }),
    ],
  },
  inventario: {
    nombre: 'Inventario',
    singular: 'Artículo',
    icono: 'paquete',
    prefijo: 'IN',
    descripcion: 'Existencias de refacciones, insumos o mercancía.',
    campos: [
      campo('Artículo', 'texto', { requerido: true, ...enLista }),
      campo('Código', 'texto', enLista),
      campo('Existencia', 'numero', enLista),
      campo('Mínimo', 'numero'),
      campo('Precio', 'dinero', enLista),
      campo('Proveedor', 'texto'),
    ],
  },
  membresias: {
    nombre: 'Membresías',
    singular: 'Membresía',
    icono: 'tarjeta',
    prefijo: 'MB',
    descripcion: 'Socios, alumnos o suscriptores con fecha de vencimiento.',
    campos: [
      campo('Socio', 'texto', { requerido: true, ...enLista }),
      campo('Teléfono', 'telefono', enLista),
      campo('Plan', 'opcion', { opciones: ['Mensual', 'Trimestral', 'Anual'], ...enLista }),
      campo('Inicio', 'fecha'),
      campo('Vence', 'fecha', enLista),
      campo('Estado', 'opcion', { opciones: ['Activa', 'Por vencer', 'Vencida', 'Cancelada'], avisar: true, ...enLista }),
    ],
  },
  cotizaciones: {
    nombre: 'Cotizaciones',
    singular: 'Cotización',
    icono: 'formulario',
    prefijo: 'CT',
    descripcion: 'Solicitudes de precio que se responden después.',
    campos: [
      campo('Cliente', 'texto', { requerido: true, ...enLista }),
      campo('Teléfono', 'telefono', enLista),
      campo('Correo', 'email'),
      campo('Qué necesita', 'textoLargo', { requerido: true }),
      campo('Monto', 'dinero', enLista),
      campo('Estado', 'opcion', { opciones: ['Nueva', 'Enviada', 'Aceptada', 'Rechazada'], avisar: true, ...enLista }),
    ],
  },
  garantias: {
    nombre: 'Garantías',
    singular: 'Garantía',
    icono: 'escudo',
    prefijo: 'GA',
    descripcion: 'Reclamos de garantía y su seguimiento.',
    campos: [
      campo('Cliente', 'texto', { requerido: true, ...enLista }),
      campo('Teléfono', 'telefono', enLista),
      campo('Producto', 'texto', { requerido: true, ...enLista }),
      campo('Fecha de compra', 'fecha'),
      campo('Problema', 'textoLargo'),
      campo('Estado', 'opcion', { opciones: ['Recibida', 'En revisión', 'Aprobada', 'Rechazada', 'Resuelta'], avisar: true, ...enLista }),
    ],
  },
  encargos: {
    nombre: 'Encargos',
    singular: 'Encargo',
    icono: 'registro',
    prefijo: 'EN',
    descripcion: 'Pedidos especiales con anticipo y fecha de entrega (pasteles, trabajos a medida...).',
    campos: [
      campo('Cliente', 'texto', { requerido: true, ...enLista }),
      campo('Teléfono', 'telefono', enLista),
      campo('Descripción', 'textoLargo', { requerido: true }),
      campo('Fecha de entrega', 'fecha', enLista),
      campo('Anticipo', 'dinero', enLista),
      campo('Estado', 'opcion', { opciones: ['Recibido', 'En proceso', 'Listo', 'Entregado'], avisar: true, ...enLista }),
    ],
  },
  mascotas: {
    nombre: 'Mascotas',
    singular: 'Mascota',
    icono: 'salud',
    prefijo: 'MS',
    descripcion: 'Expedientes de pacientes para veterinarias y estéticas caninas.',
    campos: [
      campo('Nombre', 'texto', { requerido: true, ...enLista }),
      campo('Especie', 'opcion', { opciones: ['Perro', 'Gato', 'Otro'], ...enLista }),
      campo('Raza', 'texto'),
      campo('Dueño', 'texto', { requerido: true, ...enLista }),
      campo('Teléfono', 'telefono', enLista),
      campo('Notas', 'textoLargo'),
    ],
  },
};
