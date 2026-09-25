import { conectarMongo, desconectarMongo } from '../infrastructure/database/mongo.js';
import {
  EmpresaRepository,
  UsuarioRepository,
  ProductoRepository,
  BotRepository,
  ConversacionRepository,
  PedidoRepository,
  CitaRepository,
  EstadisticaRepository,
} from '../infrastructure/persistence/repositories/index.js';
import { BcryptPasswordHasher, JwtTokenService, CryptoGenerador } from '../infrastructure/security/index.js';
import { FetchClienteWebhook } from '../infrastructure/http/FetchClienteWebhook.js';
import { N8nPublicador } from '../infrastructure/n8n/N8nPublicador.js';
import { construirTarea } from '../infrastructure/n8n/construirTarea.js';
import { EvolutionCliente } from '../infrastructure/whatsapp/EvolutionCliente.js';
import { normalizarEntrante } from '../infrastructure/whatsapp/normalizarEntrante.js';
import { OpenRouterCliente } from '../infrastructure/ia/OpenRouterCliente.js';
import { CloudinaryAlmacen } from '../infrastructure/storage/CloudinaryAlmacen.js';

import { MotorDeFlujo } from '../application/services/MotorDeFlujo.js';
import { AtenderMensaje } from '../application/services/AtenderMensaje.js';
import { RespondedorIA } from '../application/services/RespondedorIA.js';
import { RegistrarEmpresa } from '../application/use-cases/auth/RegistrarEmpresa.js';
import { IniciarSesion } from '../application/use-cases/auth/IniciarSesion.js';
import { ObtenerPerfil } from '../application/use-cases/auth/ObtenerPerfil.js';
import * as usuariosUC from '../application/use-cases/usuarios/index.js';
import * as productosUC from '../application/use-cases/productos/index.js';
import * as botsUC from '../application/use-cases/bots/index.js';
import * as conversacionesUC from '../application/use-cases/conversaciones/index.js';
import * as pedidosUC from '../application/use-cases/pedidos/index.js';
import * as empresaUC from '../application/use-cases/empresa/index.js';
import * as citasUC from '../application/use-cases/citas/index.js';
import * as webUC from '../application/use-cases/web/index.js';
import { ProcesarMensajeEntrante } from '../application/use-cases/motor/ProcesarMensajeEntrante.js';
import { ObtenerResumen } from '../application/use-cases/tablero/ObtenerResumen.js';
import { FirmarSubidaImagen } from '../application/use-cases/archivos/FirmarSubidaImagen.js';
import { ObtenerResultados } from '../application/use-cases/bots/ObtenerResultados.js';
import { GenerarFlujoConIA } from '../application/use-cases/asistente/GenerarFlujoConIA.js';
import { GenerarTareaN8n, PublicarTareaN8n } from '../application/use-cases/asistente/tareas.js';

import * as C from '../presentation/http/controllers/index.js';
import * as R from '../presentation/http/routers/index.js';
import { autenticar, limiteAuth, limiteGeneral, limiteMotor, limiteIA, limiteChatPublico } from '../presentation/http/middlewares.js';

/** Clase → instancia con la llave en camelCase: ListarBots → listarBots. */
const instanciar = (modulo, deps) =>
  Object.fromEntries(Object.entries(modulo).map(([nombre, Clase]) => [nombre[0].toLowerCase() + nombre.slice(1), new Clase(deps)]));

/** Raíz de composición: el único lugar que conoce las clases concretas de todas las capas. */
export async function crearContenedor(config) {
  await conectarMongo(config.MONGO_URI);

  const repos = {
    empresas: new EmpresaRepository(),
    usuarios: new UsuarioRepository(),
    productos: new ProductoRepository(),
    bots: new BotRepository(),
    conversaciones: new ConversacionRepository(),
    pedidos: new PedidoRepository(),
    citas: new CitaRepository(),
    estadisticas: new EstadisticaRepository(),
  };
  const tokens = new JwtTokenService(config.JWT_SECRET, config.JWT_EXPIRA);
  const servicios = {
    hasher: new BcryptPasswordHasher(),
    tokens,
    generador: new CryptoGenerador(),
    evolution: new EvolutionCliente({ url: config.EVOLUTION_URL, apiKey: config.EVOLUTION_API_KEY }),
    publicador: new N8nPublicador({
      n8nUrl: config.N8N_URL,
      apiKey: config.N8N_API_KEY,
      apiUrl: config.API_URL_PUBLICA,
      evolutionUrl: config.EVOLUTION_URL,
      credencialEvolutionId: config.N8N_EVOLUTION_CREDENCIAL_ID,
    }),
    normalizar: normalizarEntrante,
    construirTarea,
    almacen: new CloudinaryAlmacen({ cloudName: config.CLOUDINARY_CLOUD_NAME, apiKey: config.CLOUDINARY_API_KEY, apiSecret: config.CLOUDINARY_API_SECRET }),
    ia: new OpenRouterCliente({ apiKey: config.OPENROUTER_API_KEY, modelos: config.OPENROUTER_MODELOS, maxTokens: config.OPENROUTER_MAX_TOKENS, urlSitio: config.URL_FRONTEND }),
  };
  const respondedor = new RespondedorIA({ ia: servicios.ia, productos: repos.productos });
  const motor = new MotorDeFlujo({ productos: repos.productos, pedidos: repos.pedidos, citas: repos.citas, clienteWebhook: new FetchClienteWebhook(), respondedor });
  const deps = { ...repos, ...servicios, atender: new AtenderMensaje({ motor, conversaciones: repos.conversaciones, empresas: repos.empresas, estadisticas: repos.estadisticas }) };

  const casos = {
    registrarEmpresa: new RegistrarEmpresa(deps),
    iniciarSesion: new IniciarSesion(deps),
    obtenerPerfil: new ObtenerPerfil(deps),
    procesarMensajeEntrante: new ProcesarMensajeEntrante(deps),
    obtenerResumen: new ObtenerResumen(deps),
    generarFlujoConIA: new GenerarFlujoConIA(deps),
    obtenerResultados: new ObtenerResultados(deps),
    firmarSubidaImagen: new FirmarSubidaImagen(deps),
    generarTareaN8n: new GenerarTareaN8n(deps),
    publicarTareaN8n: new PublicarTareaN8n(deps),
    ...instanciar(usuariosUC, deps),
    ...instanciar(productosUC, deps),
    ...instanciar(botsUC, deps),
    ...instanciar(conversacionesUC, deps),
    ...instanciar(pedidosUC, deps),
    ...instanciar(empresaUC, deps),
    ...instanciar(citasUC, deps),
    ...instanciar(webUC, deps),
  };

  const conSesion = { middlewares: [limiteGeneral, autenticar(tokens)] };
  const rutas = [
    ['/auth', new R.AuthRouter(new C.AuthController(casos), { autenticar: autenticar(tokens), limiteAuth }).registrar()],
    ['/usuarios', new R.UsuarioRouter(new C.UsuarioController(casos), conSesion).registrar()],
    ['/productos', new R.ProductoRouter(new C.ProductoController(casos), conSesion).registrar()],
    ['/bots', new R.BotRouter(new C.BotController(casos), conSesion).registrar()],
    ['/conversaciones', new R.ConversacionRouter(new C.ConversacionController(casos), conSesion).registrar()],
    ['/pedidos', new R.PedidoRouter(new C.PedidoController(casos), conSesion).registrar()],
    ['/giros', new R.GiroRouter(new C.EmpresaController(casos)).registrar()],
    ['/empresa', new R.EmpresaRouter(new C.EmpresaController(casos), conSesion).registrar()],
    ['/citas', new R.CitaRouter(new C.CitaController(casos), conSesion).registrar()],
    ['/asistente', new R.AsistenteRouter(new C.AsistenteController(casos), { middlewares: [limiteIA, autenticar(tokens)] }).registrar()],
    ['/archivos', new R.ArchivoRouter(new C.ArchivoController(casos), conSesion).registrar()],
    ['/tablero', new R.TableroRouter(new C.TableroController(casos), conSesion).registrar()],
    ['/motor', new R.MotorRouter(new C.MotorController(casos), { middlewares: [limiteMotor] }).registrar()],
  ];

  const rutasPublicas = [['/publico/chat', new R.ChatPublicoRouter(new C.ChatWebController(casos), { middlewares: [limiteChatPublico] }).registrar()]];

  return {
    rutas,
    rutasPublicas,
    config,
    integraciones: { n8n: servicios.publicador.configurado, evolution: servicios.evolution.configurado, ia: servicios.ia.configurado },
    cerrar: desconectarMongo,
  };
}
