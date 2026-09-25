/**
 * Horarios libres para agendar. Funciones puras: reciben el horario de la empresa,
 * las citas ocupadas y "ahora"; no saben de Mongo ni de WhatsApp.
 *
 * horario = { dias: [1..6] (0 = domingo), apertura: '09:00', cierre: '19:00', intervaloMin: 30, capacidad: 1 }
 */

const MARGEN_MIN = 30; // no ofrecer horarios que empiezan en menos de media hora

/** Minutos que la zona está adelantada respecto a UTC en ese instante (México = -360). */
function desfase(zona, instante) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(instante)
      .map((x) => [x.type, x.value]),
  );
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((comoUtc - Math.floor(instante.getTime() / 60000) * 60000) / 60000);
}

/** '2026-09-29' + '10:30' en la zona de la empresa → Date (UTC). */
export function localAUtc(fecha, hora, zona) {
  const [y, m, d] = fecha.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  const aprox = Date.UTC(y, m - 1, d, h, mi);
  const primero = aprox - desfase(zona, new Date(aprox)) * 60000;
  return new Date(aprox - desfase(zona, new Date(primero)) * 60000); // segunda vuelta por cambios de horario
}

/** Date → { fecha: 'YYYY-MM-DD', hora: 'HH:MM' } vistos en la zona de la empresa. */
export function aLocal(instante, zona) {
  const local = new Date(instante.getTime() + desfase(zona, instante) * 60000);
  const iso = local.toISOString();
  return { fecha: iso.slice(0, 10), hora: iso.slice(11, 16) };
}

const diaSemana = (fecha) => new Date(`${fecha}T12:00:00Z`).getUTCDay();

const sumarDias = (fecha, n) => new Date(Date.parse(`${fecha}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const aMinutos = (hora) => {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
};
const aHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** "lunes 29 de septiembre" */
export function nombreDia(fecha) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${fecha}T12:00:00Z`));
}

/**
 * Horarios libres de un día.
 * @param {{ horario: object, zona: string, fecha: string, ahora: Date, ocupadas: { inicio: Date, fin: Date }[], duracionMin?: number }} p
 * @returns {{ hora: string, inicio: Date, fin: Date }[]}
 */
export function espaciosDelDia({ horario, zona, fecha, ahora, ocupadas, duracionMin }) {
  if (!horario.dias.includes(diaSemana(fecha))) return [];
  const paso = Math.max(5, horario.intervaloMin ?? 30);
  const dura = Math.max(5, duracionMin ?? paso);
  const capacidad = Math.max(1, horario.capacidad ?? 1);
  const limite = ahora.getTime() + MARGEN_MIN * 60000;
  const espacios = [];
  for (let m = aMinutos(horario.apertura); m + dura <= aMinutos(horario.cierre); m += paso) {
    const inicio = localAUtc(fecha, aHora(m), zona);
    const fin = new Date(inicio.getTime() + dura * 60000);
    if (inicio.getTime() < limite) continue;
    const encimadas = ocupadas.filter((c) => c.inicio < fin && c.fin > inicio).length;
    if (encimadas < capacidad) espacios.push({ hora: aHora(m), inicio, fin });
  }
  return espacios;
}

/** Próximos días (hasta `maxDias`) que tienen al menos un horario libre, buscando `diasAdelante` días. */
export function diasDisponibles({ horario, zona, ahora, ocupadas, duracionMin, diasAdelante = 14, maxDias = 6 }) {
  const hoy = aLocal(ahora, zona).fecha;
  const dias = [];
  for (let i = 0; i <= diasAdelante && dias.length < maxDias; i++) {
    const fecha = sumarDias(hoy, i);
    const espacios = espaciosDelDia({ horario, zona, fecha, ahora, ocupadas, duracionMin });
    if (espacios.length) dias.push({ fecha, nombre: nombreDia(fecha), libres: espacios.length });
  }
  return dias;
}

/** Rango UTC que cubre la búsqueda (para pedir las citas ocupadas de una sola vez). */
export function rangoBusqueda(ahora, diasAdelante = 14) {
  return { desde: new Date(ahora.getTime() - 86400000), hasta: new Date(ahora.getTime() + (diasAdelante + 2) * 86400000) };
}
