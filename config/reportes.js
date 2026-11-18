/**
 * Archivo: config/reportes.js
 * Propósito: Catálogo centralizado de reportes generales, consultas específicas y conjuntas (Actualización 1.4 + Mejoras M1-M6).
 */
const CATALOGO_REPORTES = [
  // ==========================================
  // 1. REPORTES GENERALES (CU02.8 + M1, M2, M3)
  // ==========================================
  {
    slug: 'balance-prendas',
    titulo: 'Balance Financiero por Prenda y Períodos',
    descripcion: 'Analiza inversión, ventas y ganancia/pérdida por prenda con agrupación Mensual, Anual o Total acumulado, matriz pivote y evolución individual.',
    tipo: 'General',
    seccion: 'Reportes Generales (CU02.8)',
    ruta: '/admin/reportes/balance-prendas',
    requiereSeleccionPrevia: false
  },
  {
    slug: 'ventas-periodo',
    titulo: 'Ventas e Ingresos Detallados por Período',
    descripcion: 'Resumen diario, mensual o anual de pedidos, unidades, descuentos por puntos, ticket promedio y desglose expandible de cada venta y sus líneas.',
    tipo: 'General',
    seccion: 'Reportes Generales (CU02.8)',
    ruta: '/admin/reportes/ventas-periodo',
    requiereSeleccionPrevia: false
  },
  {
    slug: 'perdidas-bajas',
    titulo: 'Pérdidas por Productos Dados de Baja',
    descripcion: 'Cuantifica el dinero perdido por stock descartado al momento de la baja (unidades × costo promedio ponderado) frente al balance histórico de la prenda.',
    tipo: 'General',
    seccion: 'Reportes Generales (CU02.8)',
    ruta: '/admin/reportes/perdidas-bajas',
    requiereSeleccionPrevia: false
  },

  // ==========================================
  // 2. CONSULTAS ESPECÍFICAS (CU02.4 + M4, M5, M6)
  // ==========================================
  {
    slug: 'stock-bajo',
    titulo: 'Productos con Stock Bajo por Talla y Color',
    descripcion: 'Lista operativa de variantes de productos activos con stock crítico y filtro por fecha de último movimiento (venta o compra).',
    tipo: 'Específica',
    seccion: 'Consultas Específicas (CU02.4)',
    ruta: '/admin/reportes/stock-bajo',
    requiereSeleccionPrevia: false
  },
  {
    slug: 'historial-cliente',
    titulo: 'Historial de Compras de un Cliente',
    descripcion: 'Buscador en vivo por nombre, documento o correo con ficha del cliente, pedidos y líneas detalladas por talla y color.',
    tipo: 'Específica',
    seccion: 'Consultas Específicas (CU02.4)',
    ruta: '/admin/reportes/historial-cliente',
    requiereSeleccionPrevia: true
  },
  {
    slug: 'mas-vendidos-temporada',
    titulo: 'Productos Más Vendidos por Temporada',
    descripcion: 'Ranking de prendas con mayor volumen de unidades vendidas e ingresos por temporada, conmutable por producto o por talla y color.',
    tipo: 'Específica',
    seccion: 'Consultas Específicas (CU02.4)',
    ruta: '/admin/reportes/mas-vendidos-temporada',
    requiereSeleccionPrevia: false
  },
  {
    slug: 'clientes-fidelizacion',
    titulo: 'Clientes con Mayor Puntaje de Fidelización',
    descripcion: 'Listado de clientes ordenados por su saldo actual de puntos y puntaje ganado dentro del período filtrado.',
    tipo: 'Específica',
    seccion: 'Consultas Específicas (CU02.4)',
    ruta: '/admin/reportes/clientes-fidelizacion',
    requiereSeleccionPrevia: false
  },
  {
    slug: 'pedidos-pendientes',
    titulo: 'Pedidos Pendientes de Entrega',
    descripcion: 'Órdenes activas en preparación o tránsito pendientes de entrega final, con detalle de prendas (talla/color) y enlace al pedido.',
    tipo: 'Específica',
    seccion: 'Consultas Específicas (CU02.4)',
    ruta: '/admin/reportes/pedidos-pendientes',
    requiereSeleccionPrevia: false
  },

  // ==========================================
  // 3. CONSULTAS CONJUNTAS (CU02.4 + M4, M6)
  // ==========================================
  {
    slug: 'disponibilidad-tiempo-real',
    titulo: 'Disponibilidad en Tiempo Real (Inventario vs. Catálogo)',
    descripcion: 'Auditoría operativa de prendas activas en tienda frente a su stock físico desglosado en matriz de tallas y colores.',
    tipo: 'Conjunta',
    seccion: 'Consultas Conjuntas (CU02.4)',
    ruta: '/admin/reportes/disponibilidad-tiempo-real',
    requiereSeleccionPrevia: false
  },
  {
    slug: 'pago-zona-entrega',
    titulo: 'Relación Método de Pago vs. Zona de Entrega',
    descripcion: 'Cruza los medios de pago con la logística empleada y permite desplegar los pedidos que componen cada celda.',
    tipo: 'Conjunta',
    seccion: 'Consultas Conjuntas (CU02.4)',
    ruta: '/admin/reportes/pago-zona-entrega',
    requiereSeleccionPrevia: false
  },
  {
    slug: 'desempeno-temporada',
    titulo: 'Desempeño de Productos de una Temporada',
    descripcion: 'Muestra todas las prendas de una temporada seleccionada con unidades vendidas, ingreso generado y desglose por talla y color.',
    tipo: 'Conjunta',
    seccion: 'Consultas Conjuntas (CU02.4)',
    ruta: '/admin/reportes/desempeno-temporada',
    requiereSeleccionPrevia: true
  },
  {
    slug: 'clientes-multitemporada',
    titulo: 'Clientes Compradores en Más de una Temporada',
    descripcion: 'Identifica clientes recurrentes que han adquirido prendas de 2 o más temporadas distintas, con sus pedidos y variantes (talla/color).',
    tipo: 'Conjunta',
    seccion: 'Consultas Conjuntas (CU02.4)',
    ruta: '/admin/reportes/clientes-multitemporada',
    requiereSeleccionPrevia: false
  }
];

function obtenerReportePorSlug(slug) {
  return CATALOGO_REPORTES.find((r) => r.slug === slug) || null;
}

module.exports = {
  CATALOGO_REPORTES,
  obtenerReportePorSlug
};
