import { BaseRouter } from '../BaseRouter.js';

export class AuthRouter extends BaseRouter {
  constructor(controller, { autenticar, limiteAuth }) {
    super(controller);
    this.autenticar = autenticar;
    this.limiteAuth = limiteAuth;
  }

  rutas() {
    this.post('/registro', this.limiteAuth, 'registrar');
    this.post('/login', this.limiteAuth, 'login');
    this.get('/perfil', this.autenticar, 'perfil');
  }
}

export class UsuarioRouter extends BaseRouter {
  rutas() {
    this.crud(':usuarioId', ['listar', 'crear', 'borrar']);
  }
}

export class ProductoRouter extends BaseRouter {
  rutas() {
    this.get('/categorias', 'categorias');
    this.crud(':productoId');
  }
}

export class BotRouter extends BaseRouter {
  rutas() {
    this.put('/:botId/flujo', 'guardarFlujo');
    this.put('/:botId/web', 'configurarWeb');
    this.get('/:botId/resultados', 'resultados');
    this.get('/:botId/versiones', 'versiones');
    this.post('/:botId/versiones/:versionId/restaurar', 'restaurarVersion');
    this.put('/:botId/telegram', 'conectarTelegram');
    this.delete('/:botId/telegram', 'desconectarTelegram');
    this.put('/:botId/meta', 'conectarMeta');
    this.delete('/:botId/meta', 'desconectarMeta');
    this.put('/:botId/recuperacion', 'recuperacion');
    this.post('/:botId/publicar', 'publicar');
    this.get('/:botId/workflow-n8n', 'exportar');
    this.post('/:botId/whatsapp/conectar', 'conectar');
    this.get('/:botId/whatsapp', 'estadoWhatsApp');
    this.post('/:botId/whatsapp/desconectar', 'desconectar');
    this.post('/:botId/simulador', 'simular');
    this.delete('/:botId/simulador', 'reiniciarSimulador');
    this.crud(':botId');
  }
}

export class ConversacionRouter extends BaseRouter {
  rutas() {
    this.post('/:conversacionId/devolver-al-bot', 'devolver');
    this.post('/:conversacionId/tomar', 'tomar');
    this.post('/:conversacionId/mensajes', 'responder');
    this.crud(':conversacionId', ['listar', 'obtener']);
  }
}

export class PedidoRouter extends BaseRouter {
  rutas() {
    this.patch('/:pedidoId/estado', 'cambiarEstado');
    this.post('/:pedidoId/pagado', 'pagado');
    this.crud(':pedidoId', ['listar']);
  }
}

export class TableroRouter extends BaseRouter {
  rutas() {
    this.get('/resumen', 'resumen');
  }
}

export class MotorRouter extends BaseRouter {
  rutas() {
    this.post('/bots/:botId/mensajes', 'mensaje');
  }
}

/** /giros es público (lo necesita el registro); /empresa es la empresa de quien tiene la sesión. */
export class GiroRouter extends BaseRouter {
  rutas() {
    this.get('/', 'giros');
  }
}

export class EmpresaRouter extends BaseRouter {
  rutas() {
    this.get('/', 'obtener');
    this.patch('/', 'editar');
  }
}

export class CitaRouter extends BaseRouter {
  rutas() {
    this.crud(':citaId', ['listar', 'crear', 'editar']);
  }
}

export class AsistenteRouter extends BaseRouter {
  rutas() {
    this.post('/flujos', 'generar');
    this.post('/tareas', 'tarea');
    this.post('/tareas/publicar', 'publicarTarea');
  }
}

/** Chat web público (sin sesión): lo llama el globito desde la página de cada negocio. */
export class ChatPublicoRouter extends BaseRouter {
  rutas() {
    this.get('/:clave', 'publico');
    this.post('/:clave/mensajes', 'mensaje');
    this.get('/:clave/mensajes', 'nuevos');
  }
}

export class CampanaRouter extends BaseRouter {
  rutas() {
    this.get('/segmento', 'contar');
    this.get('/contactos', 'contactos');
    this.post('/:campanaId/programar', 'programar');
    this.post('/:campanaId/cancelar', 'cancelar');
    this.crud(':campanaId', ['listar', 'crear', 'editar', 'borrar']);
  }
}

/** Encuestas, bitácora, plan y cobros de la empresa. */
export class GestionRouter extends BaseRouter {
  rutas() {
    this.get('/encuestas', 'encuestas');
    this.get('/actividad', 'actividad');
    this.get('/plan', 'plan');
    this.post('/plan/pagar', 'pagarPlan');
    this.get('/cobros', 'cobros');
    this.put('/cobros', 'configurarCobros');
  }
}

export class AdminRouter extends BaseRouter {
  rutas() {
    this.get('/empresas', 'empresas');
    this.patch('/empresas/:empresaId', 'editarEmpresa');
  }
}

/** Webhooks públicos de otros servicios (validan su propia firma o secreto). */
export class EntradaRouter extends BaseRouter {
  rutas() {
    this.post('/telegram/:botId', 'telegram');
    this.get('/meta', 'metaVerificar');
    this.post('/meta', 'meta');
    this.post('/pagos/plataforma', 'pagoPlataforma');
    this.post('/pagos/:proveedor/:empresaId', 'pago');
  }
}

export class InternoRouter extends BaseRouter {
  rutas() {
    this.post('/tick', 'tick');
  }
}

/** Imágenes: el navegador pide una firma y sube directo a Cloudinary. */
export class ArchivoRouter extends BaseRouter {
  rutas() {
    this.post('/firma', 'firma');
  }
}
