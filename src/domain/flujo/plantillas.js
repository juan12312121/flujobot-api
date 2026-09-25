/**
 * Flujos de arranque para que un bot nuevo no empiece con el lienzo en blanco.
 * Cada plantilla es una función para que cada bot reciba su propia copia.
 */
export const PLANTILLAS = {
  vacio: () => ({
    nodos: [{ id: 'inicio', tipo: 'inicio', datos: { palabrasClave: [], palabrasReinicio: ['reiniciar'] }, posicion: { x: 80, y: 200 } }],
    conexiones: [],
  }),

  tienda: () => ({
    nodos: [
      { id: 'inicio', tipo: 'inicio', datos: { palabrasClave: [], palabrasReinicio: ['reiniciar', 'menu principal'] }, posicion: { x: 40, y: 300 } },
      {
        id: 'menu',
        tipo: 'menu',
        datos: {
          texto: '¡Hola {{nombre}}! Soy el asistente de *{{empresa}}*. ¿En qué te ayudo?',
          opciones: [
            { id: 'catalogo', etiqueta: 'Ver catálogo y pedir', palabras: ['catalogo', 'productos', 'pedir'] },
            { id: 'info', etiqueta: 'Horarios y ubicación', palabras: ['horario', 'ubicacion'] },
            { id: 'asesor', etiqueta: 'Hablar con un asesor', palabras: ['asesor', 'humano'] },
          ],
        },
        posicion: { x: 340, y: 260 },
      },
      { id: 'catalogo', tipo: 'catalogo', datos: { texto: '*Nuestros productos:*', mostrarImagen: true }, posicion: { x: 680, y: 60 } },
      {
        id: 'mas',
        tipo: 'menu',
        datos: {
          texto: '¿Quieres algo más?',
          opciones: [
            { id: 'otro', etiqueta: 'Agregar otro producto' },
            { id: 'terminar', etiqueta: 'Terminar mi pedido' },
          ],
        },
        posicion: { x: 1020, y: 40 },
      },
      { id: 'carrito', tipo: 'carrito', datos: { texto: '*Tu pedido:*' }, posicion: { x: 1020, y: 260 } },
      { id: 'nombre', tipo: 'pregunta', datos: { texto: '¿A nombre de quién va el pedido?', variable: 'cliente', validacion: 'texto' }, posicion: { x: 1360, y: 260 } },
      { id: 'direccion', tipo: 'pregunta', datos: { texto: '¿A qué dirección lo enviamos?', variable: 'direccion', validacion: 'texto' }, posicion: { x: 1360, y: 410 } },
      { id: 'pedido', tipo: 'pedido', datos: { texto: '¡Gracias {{cliente}}! Tu pedido *{{folio}}* por {{total}} quedó registrado. Lo enviamos a: {{direccion}}' }, posicion: { x: 1360, y: 560 } },
      { id: 'fin', tipo: 'fin', datos: { texto: 'Escribe cualquier cosa cuando quieras volver al menú.' }, posicion: { x: 1020, y: 560 } },
      { id: 'info', tipo: 'mensaje', datos: { texto: 'Abrimos de lunes a sábado de 9:00 a 19:00.\nEstamos en el centro de la ciudad.' }, posicion: { x: 680, y: 300 } },
      { id: 'asesor', tipo: 'humano', datos: { texto: 'Te comunico con un asesor, en un momento te atiende.' }, posicion: { x: 680, y: 470 } },
    ],
    conexiones: [
      { id: 'c1', origen: 'inicio', puerto: 'siguiente', destino: 'menu' },
      { id: 'c2', origen: 'menu', puerto: 'opcion:catalogo', destino: 'catalogo' },
      { id: 'c3', origen: 'menu', puerto: 'opcion:info', destino: 'info' },
      { id: 'c4', origen: 'menu', puerto: 'opcion:asesor', destino: 'asesor' },
      { id: 'c5', origen: 'catalogo', puerto: 'agregado', destino: 'mas' },
      { id: 'c6', origen: 'catalogo', puerto: 'listo', destino: 'carrito' },
      { id: 'c7', origen: 'mas', puerto: 'opcion:otro', destino: 'catalogo' },
      { id: 'c8', origen: 'mas', puerto: 'opcion:terminar', destino: 'carrito' },
      { id: 'c9', origen: 'carrito', puerto: 'siguiente', destino: 'nombre' },
      { id: 'c10', origen: 'carrito', puerto: 'vacio', destino: 'menu' },
      { id: 'c11', origen: 'nombre', puerto: 'siguiente', destino: 'direccion' },
      { id: 'c12', origen: 'direccion', puerto: 'siguiente', destino: 'pedido' },
      { id: 'c13', origen: 'pedido', puerto: 'siguiente', destino: 'fin' },
      { id: 'c14', origen: 'info', puerto: 'siguiente', destino: 'fin' },
    ],
  }),

  /** Salones, consultorios, talleres: elegir servicio → nombre → día y hora. */
  citas: () => ({
    nodos: [
      nodo('inicio', 'inicio', 40, 300, { palabrasClave: [], palabrasReinicio: ['reiniciar', 'menu principal'] }),
      nodo('menu', 'menu', 340, 260, {
        texto: '¡Hola {{nombre}}! Bienvenido a *{{empresa}}*. ¿Qué necesitas?',
        opciones: [
          { id: 'agendar', etiqueta: 'Agendar una cita', palabras: ['cita', 'agendar', 'reservar'] },
          { id: 'info', etiqueta: 'Horarios y ubicación', palabras: ['horario', 'ubicacion', 'direccion'] },
          { id: 'asesor', etiqueta: 'Hablar con alguien', palabras: ['asesor', 'humano'] },
        ],
      }),
      nodo('servicio', 'catalogo', 680, 40, { texto: '¿Qué servicio te interesa?', modo: 'elegir' }),
      nodo('nombre', 'pregunta', 1020, 40, { texto: '¿A nombre de quién agendamos?', variable: 'cliente', validacion: 'texto' }),
      nodo('cita', 'cita', 1360, 40, { texto: '¿Qué día te acomoda, {{cliente}}?', diasAdelante: 14 }),
      nodo('fin', 'fin', 1360, 300, { texto: 'Si necesitas cambiar algo, escríbenos. ¡Te esperamos!' }),
      nodo('info', 'mensaje', 680, 300, { texto: 'Atendemos de lunes a sábado de 9:00 a 19:00.\nEscribe aquí tu dirección.' }),
      nodo('asesor', 'humano', 680, 470, { texto: 'En un momento alguien de nuestro equipo te atiende.' }),
    ],
    conexiones: unir([
      ['inicio', 'siguiente', 'menu'],
      ['menu', 'opcion:agendar', 'servicio'],
      ['menu', 'opcion:info', 'info'],
      ['menu', 'opcion:asesor', 'asesor'],
      ['servicio', 'agregado', 'nombre'],
      ['servicio', 'listo', 'menu'],
      ['nombre', 'siguiente', 'cita'],
      ['cita', 'agendada', 'fin'],
      ['cita', 'sin_espacio', 'asesor'],
      ['info', 'siguiente', 'fin'],
    ]),
  }),

  /** Cualquier negocio: preguntas frecuentes + pasar a una persona. */
  informacion: () => ({
    nodos: [
      nodo('inicio', 'inicio', 40, 300, { palabrasClave: [], palabrasReinicio: ['reiniciar', 'menu principal'] }),
      nodo('menu', 'menu', 340, 240, {
        texto: '¡Hola {{nombre}}! Soy el asistente de *{{empresa}}*. ¿Sobre qué quieres saber?',
        opciones: [
          { id: 'horario', etiqueta: 'Horarios', palabras: ['horario', 'hora', 'abren'] },
          { id: 'ubicacion', etiqueta: 'Ubicación', palabras: ['ubicacion', 'direccion', 'donde'] },
          { id: 'preguntas', etiqueta: 'Preguntas frecuentes', palabras: ['preguntas', 'precio', 'costos'] },
          { id: 'asesor', etiqueta: 'Hablar con alguien', palabras: ['asesor', 'humano'] },
        ],
      }),
      nodo('horario', 'mensaje', 680, 40, { texto: ' Lunes a viernes de 9:00 a 18:00 y sábados de 9:00 a 14:00.' }),
      nodo('ubicacion', 'mensaje', 680, 190, { texto: ' Escribe aquí tu dirección y un enlace de Google Maps.' }),
      nodo('preguntas', 'mensaje', 680, 340, { texto: '*¿Cuánto cuesta?* …\n*¿Aceptan tarjeta?* …\n*¿Tienen estacionamiento?* …' }),
      nodo('asesor', 'humano', 680, 500, { texto: 'En un momento alguien de nuestro equipo te atiende.' }),
      nodo('mas', 'menu', 1020, 190, {
        texto: '¿Te ayudo con algo más?',
        opciones: [
          { id: 'si', etiqueta: 'Sí, ver el menú' },
          { id: 'no', etiqueta: 'No, gracias' },
        ],
      }),
      nodo('fin', 'fin', 1360, 210, { texto: '¡Gracias por escribirnos!' }),
    ],
    conexiones: unir([
      ['inicio', 'siguiente', 'menu'],
      ['menu', 'opcion:horario', 'horario'],
      ['menu', 'opcion:ubicacion', 'ubicacion'],
      ['menu', 'opcion:preguntas', 'preguntas'],
      ['menu', 'opcion:asesor', 'asesor'],
      ['horario', 'siguiente', 'mas'],
      ['ubicacion', 'siguiente', 'mas'],
      ['preguntas', 'siguiente', 'mas'],
      ['mas', 'opcion:si', 'menu'],
      ['mas', 'opcion:no', 'fin'],
    ]),
  }),

  /** Escuelas, inmobiliarias, cotizaciones: capturar los datos del interesado. */
  prospectos: () => ({
    nodos: [
      nodo('inicio', 'inicio', 40, 300, { palabrasClave: [], palabrasReinicio: ['reiniciar', 'menu principal'] }),
      nodo('menu', 'menu', 340, 260, {
        texto: '¡Hola {{nombre}}! Gracias por escribir a *{{empresa}}*. ¿Cómo te ayudamos?',
        opciones: [
          { id: 'opciones', etiqueta: 'Ver opciones', palabras: ['opciones', 'catalogo', 'ver'] },
          { id: 'info', etiqueta: 'Quiero que me contacten', palabras: ['informacion', 'info', 'cotizar'] },
          { id: 'asesor', etiqueta: 'Hablar con alguien ahora', palabras: ['asesor', 'humano'] },
        ],
      }),
      nodo('opciones', 'catalogo', 680, 40, { texto: '*Estas son nuestras opciones:*', modo: 'elegir', mostrarImagen: true }),
      nodo('asesor', 'humano', 680, 330, { texto: 'En un momento alguien de nuestro equipo te atiende.' }),
      nodo('nombre', 'pregunta', 1020, 40, { texto: '¿Cuál es tu nombre?', variable: 'cliente', validacion: 'texto' }),
      nodo('correo', 'pregunta', 1020, 190, { texto: '¿A qué correo te enviamos la información?', variable: 'correo', validacion: 'email' }),
      nodo('comentario', 'pregunta', 1020, 340, { texto: '¿Algo más que debamos saber? (horario para llamarte, presupuesto…)', variable: 'comentario', validacion: 'texto' }),
      nodo('solicitud', 'pedido', 1360, 190, { sinProductos: true, texto: '¡Gracias {{cliente}}! Registramos tu solicitud *{{folio}}*. Te contactaremos muy pronto.' }),
      nodo('fin', 'fin', 1360, 380, { texto: '' }),
    ],
    conexiones: unir([
      ['inicio', 'siguiente', 'menu'],
      ['menu', 'opcion:opciones', 'opciones'],
      ['menu', 'opcion:info', 'nombre'],
      ['menu', 'opcion:asesor', 'asesor'],
      ['opciones', 'agregado', 'nombre'],
      ['opciones', 'listo', 'menu'],
      ['nombre', 'siguiente', 'correo'],
      ['correo', 'siguiente', 'comentario'],
      ['comentario', 'siguiente', 'solicitud'],
      ['solicitud', 'siguiente', 'fin'],
    ]),
  }),
};

function nodo(id, tipo, x, y, datos) {
  return { id, tipo, datos, posicion: { x, y } };
}

function unir(flechas) {
  return flechas.map(([origen, puerto, destino], i) => ({ id: `c${i + 1}`, origen, puerto, destino }));
}
