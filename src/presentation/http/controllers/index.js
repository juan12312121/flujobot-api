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
}

export class ConversacionController extends BaseController {
  listar = this.accion('listarConversaciones', { query: esquemas.conversaciones.filtro });
  obtener = this.accion('obtenerConversacion');
  devolver = this.accion('devolverAlBot');
}

export class PedidoController extends BaseController {
  listar = this.accion('listarPedidos', { query: esquemas.pedidos.filtro });
  cambiarEstado = this.accion('cambiarEstadoPedido', { body: esquemas.pedidos.estado });
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
}
