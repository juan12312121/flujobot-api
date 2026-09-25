/**
 * Prueba real del asistente de IA (usa OPENROUTER_API_KEY del .env; cada caso cuesta unos centavos).
 *
 *   node scripts/probar-asistente.js
 */
import 'dotenv/config';
import { OpenRouterCliente } from '../src/infrastructure/ia/OpenRouterCliente.js';
import { GenerarFlujoConIA } from '../src/application/use-cases/asistente/GenerarFlujoConIA.js';
import { configuracionInicial } from '../src/domain/empresa/giros.js';

const { env } = await import('../src/infrastructure/config/env.js');
const ia = new OpenRouterCliente({ apiKey: env.OPENROUTER_API_KEY, modelos: env.OPENROUTER_MODELOS, maxTokens: env.OPENROUTER_MAX_TOKENS, urlSitio: 'http://localhost:4400' });

const CASOS = [
  {
    empresa: { nombre: 'Barbería El Güero', ...configuracionInicial('belleza') },
    catalogo: [
      { nombre: 'Corte clásico', tipo: 'servicio' },
      { nombre: 'Corte y barba', tipo: 'servicio' },
      { nombre: 'Afeitado con toalla caliente', tipo: 'servicio' },
    ],
    descripcion: 'Tengo una barbería. Quiero que los clientes puedan agendar un corte eligiendo el servicio, ver los precios y la ubicación, y si quieren hablar con el barbero que los pase conmigo.',
  },
  {
    empresa: { nombre: 'Colegio Montessori Sol', ...configuracionInicial('educacion') },
    catalogo: [],
    descripcion: 'Somos una escuela. Los papás preguntan por colegiaturas, horarios y requisitos de inscripción. Queremos juntar nombre del papá, edad del niño y correo para que control escolar les llame.',
  },
  {
    empresa: { nombre: 'Tortas La Esquina', ...configuracionInicial('restaurante') },
    catalogo: [
      { nombre: 'Torta de pierna', tipo: 'producto', categoria: 'Tortas' },
      { nombre: 'Torta cubana', tipo: 'producto', categoria: 'Tortas' },
      { nombre: 'Agua de jamaica', tipo: 'producto', categoria: 'Bebidas' },
    ],
    descripcion: 'quiero que me hagan pedidos para llevar a domicilio, que pidan varias cosas, me den su dirección y teléfono. Si piden más de 300 pesos el envío es gratis',
  },
];

for (const caso of CASOS) {
  const uc = new GenerarFlujoConIA({
    ia,
    empresas: { obtener: async () => caso.empresa },
    productos: { buscar: async () => caso.catalogo },
  });
  const inicio = Date.now();
  try {
    const r = await uc.ejecutar({ actor: { empresaId: 'e' }, descripcion: caso.descripcion });
    const errores = r.problemas.filter((p) => p.nivel === 'error');
    const avisos = r.problemas.filter((p) => p.nivel === 'aviso');
    console.log(`\n■ ${caso.empresa.nombre}  (${((Date.now() - inicio) / 1000).toFixed(1)} s, ${r.modelo})`);
    console.log(`  ${r.nodos.length} bloques: ${r.nodos.map((n) => `${n.id}[${n.tipo}]`).join(', ')}`);
    console.log(`  errores: ${errores.length}  avisos: ${avisos.length}${avisos.length ? ` → ${avisos.map((a) => a.mensaje).join(' | ')}` : ''}`);
    console.log(`  resumen: ${r.resumen}`);
    if (r.supuestos?.length) console.log(`  supuestos: ${r.supuestos.join(' | ')}`);
    if (errores.length) console.log('  ERRORES:', errores);
  } catch (e) {
    console.log(`\n■ ${caso.empresa.nombre}: FALLÓ → ${e.message}`);
  }
}
