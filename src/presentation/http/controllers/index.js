import { BaseController } from '../BaseController.js';
import * as esquemas from '../esquemas/index.js';

export class AuthController extends BaseController {
  registrar = this.accion('registrarEmpresa', { body: esquemas.auth.registro, status: 201 });
  login = this.accion('iniciarSesion', { body: esquemas.auth.login });
  perfil = this.accion('obtenerPerfil');
}

export class UsuarioController extends BaseController {
  listar = this.accion('listarUsuarios');
  crear = this.accion('crearUsuario', { body: esquemas.usuarios.crear, status: 201 });
  borrar = this.accion('borrarUsuario', { status: 204 });
}

export class ProductoController extends BaseController {
  listar = this.accion('listarProductos', { query: esquemas.productos.filtro });
  categorias = this.accion('listarCategorias');
  crear = this.accion('crearProducto', { body: esquemas.productos.crear, status: 201 });
  editar = this.accion('editarProducto', { body: esquemas.productos.editar });
  borrar = this.accion('borrarProducto', { status: 204 });
}

export class BotController extends BaseController {
  listar = this.accion('listarBots');
  crear = this.accion('crearBot', { body: esquemas.bots.crear, status: 201 });
  obtener = this.accion('obtenerBot');
  editar = this.accion('editarBot', { body: esquemas.bots.editar });
  borrar = this.accion('borrarBot', { status: 204 });
  guardarFlujo = this.accion('guardarFlujo', { body: esquemas.bots.flujo });
  publicar = this.accion('publicarBot');
  exportar = this.accion('exportarWorkflow');
  conectar = this.accion('conectarWhatsApp');
  estadoWhatsApp = this.accion('estadoWhatsApp');
  desconectar = this.accion('desconectarWhatsApp');
  simular = this.accion('simularMensaje', { body: esquemas.bots.simular });
  reiniciarSimulador = this.accion('reiniciarSimulador', { status: 204 });
  configurarWeb = this.accion('configurarChatWeb', { body: esquemas.web.configurar });
  resultados = this.accion('obtenerResultados', { query: esquemas.bots.resultados });
  versiones = this.accion('listarVersiones');
  restaurarVersion = this.accion('restaurarVersion');
  conectarTelegram = this.accion('conectarTelegram', { body: esquemas.canales.telegram });
  desconectarTelegram = this.accion('desconectarTelegram');
  conectarMeta = this.accion('conectarMeta', { body: esquemas.canales.meta });
  desconectarMeta = this.accion('desconectarMeta');
  recuperacion = this.accion('configurarRecuperacion', { body: esquemas.canales.recuperacion });
}

export class ConversacionController extends BaseController {
  listar = this.accion('listarConversaciones', { query: esquemas.conversaciones.filtro });
  obtener = this.accion('obtenerConversacion');
  devolver = this.accion('devolverAlBot');
  tomar = this.accion('tomarConversacion');
  responder = this.accion('responderComoAsesor', { body: esquemas.conversaciones.responder });
}

export class PedidoController extends BaseController {
  listar = this.accion('listarPedidos', { query: esquemas.pedidos.filtro });
  cambiarEstado = this.accion('cambiarEstadoPedido', { body: esquemas.pedidos.estado });
  pagado = this.accion('marcarPedidoPagado');
}

export class TableroController extends BaseController {
  resumen = this.accion('obtenerResumen');
}

/** Entrada de n8n: el cuerpo es el webhook crudo de Evolution, se pasa tal cual. */
export class MotorController extends BaseController {
  mensaje = this.accion('procesarMensajeEntrante', { extra: (req) => ({ token: req.get('x-bot-token'), cuerpo: req.body }) });
}

export class EmpresaController extends BaseController {
  giros = this.accion('listarGiros');
  obtener = this.accion('obtenerEmpresa');
  editar = this.accion('actualizarEmpresa', { body: esquemas.empresa.editar });
}

export class CitaController extends BaseController {
  listar = this.accion('listarCitas', { query: esquemas.citas.filtro });
  crear = this.accion('crearCita', { body: esquemas.citas.crear, status: 201 });
  editar = this.accion('actualizarCita', { body: esquemas.citas.editar });
}

export class AsistenteController extends BaseController {
  generar = this.accion('generarFlujoConIA', { body: esquemas.asistente.generar });
  tarea = this.accion('generarTareaN8n', { body: esquemas.asistente.tarea });
  publicarTarea = this.accion('publicarTareaN8n', { body: esquemas.asistente.publicarTarea });
}

export class ChatWebController extends BaseController {
  publico = this.accion('obtenerChatPublico');
  mensaje = this.accion('enviarMensajeChatPublico', { body: esquemas.web.mensaje });
  nuevos = this.accion('mensajesNuevosChatPublico', { query: esquemas.web_nuevos });
}

export class CampanaController extends BaseController {
  listar = this.accion('listarCampanas');
  crear = this.accion('crearCampana', { body: esquemas.campanas.crear, status: 201 });
  editar = this.accion('editarCampana', { body: esquemas.campanas.editar });
  borrar = this.accion('borrarCampana', { status: 204 });
  programar = this.accion('programarCampana', { body: esquemas.campanas.programar });
  cancelar = this.accion('cancelarCampana');
  contar = this.accion('contarSegmento', { query: esquemas.campanas.segmento });
  contactos = this.accion('listarContactos', { query: esquemas.campanas.contactos });
}

export class ModuloController extends BaseController {
  plantillas = this.accion('listarPlantillasModulo');
  listar = this.accion('listarModulos');
  obtener = this.accion('obtenerModulo');
  crear = this.accion('crearModulo', { body: esquemas.modulos.crear, status: 201 });
  editar = this.accion('editarModulo', { body: esquemas.modulos.editar });
  borrar = this.accion('borrarModulo', { status: 204 });
  registros = this.accion('listarRegistros', { query: esquemas.modulos.filtro });
  crearRegistro = this.accion('crearRegistro', { body: esquemas.modulos.registro, status: 201 });
  editarRegistro = this.accion('editarRegistro', { body: esquemas.modulos.registro });
  borrarRegistro = this.accion('borrarRegistro', { status: 204 });
}

export class GestionController extends BaseController {
  encuestas = this.accion('listarEncuestas', { query: esquemas.gestion.encuestas });
  actividad = this.accion('listarActividad', { query: esquemas.gestion.actividad });
  cobros = this.accion('obtenerCobros');
  configurarCobros = this.accion('configurarCobros', { body: esquemas.plataforma.cobros });
}

export class AdminController extends BaseController {
  empresas = this.accion('listarEmpresasAdmin', { query: esquemas.plataforma.adminFiltro });
  editarEmpresa = this.accion('actualizarEmpresaAdmin', { body: esquemas.plataforma.adminEditar });
}

/**
 * Webhooks de afuera (Telegram, Meta, pasarelas de pago, cron). Contestan rápido: Telegram y Meta
 * reintentan si tardan, así que el mensaje se atiende después de responder 200.
 */
export class EntradaController extends BaseController {
  telegram = (req, res) => {
    res.status(200).json({ ok: true });
    this.casos.recibirTelegram
      .ejecutar({ botId: req.params.botId, secreto: req.get('x-telegram-bot-api-secret-token'), cuerpo: req.body })
      .catch((e) => console.warn('Telegram:', e.message));
  };

  metaVerificar = (req, res) => {
    const ok = req.query['hub.mode'] === 'subscribe' && this.casos.verificarTokenMeta(req.query['hub.verify_token']);
    if (!ok) return res.status(403).send('Token de verificación inválido');
    return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
  };

  meta = (req, res) => {
    res.status(200).json({ ok: true });
    this.casos.recibirMeta
      .ejecutar({ firma: req.get('x-hub-signature-256'), crudo: req.rawBody?.toString('utf8') ?? '', cuerpo: req.body })
      .catch((e) => console.warn('Meta:', e.message));
  };

  pago = this.accion('recibirAvisoPago', {
    extra: (req) => ({ query: req.query, cuerpo: req.body, crudo: req.rawBody?.toString('utf8') ?? '', firma: req.get('stripe-signature') }),
  });


  tick = this.accion('correrProgramador', { extra: (req) => ({ secreto: req.get('x-cron-secreto') }) });
}

export class ArchivoController extends BaseController {
  firma = this.accion('firmarSubidaImagen', { body: esquemas.archivos.firma });
}
