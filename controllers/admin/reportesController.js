/**
 * Archivo: controllers/admin/reportesController.js
 * Propósito: Controlador del Centro de Reportes, vistas individuales paginadas, validación de fechas (M4) y exportación CSV (M1-M6).
 */
const { CATALOGO_REPORTES, obtenerReportePorSlug } = require('../../config/reportes');
const ReportesModel = require('../../models/reportesModel');
const { parsearFiltroFechas } = require('../../helpers/filtroFechas');

function escaparCeldaCSV(valor) {
  if (valor === null || valor === undefined) return '""';
  const limpio = String(valor).replace(/"/g, '""');
  return `"${limpio}"`;
}

function generarContenidoCSV(columnas, filas) {
  const encabezado = columnas.map((c) => escaparCeldaCSV(c.etiqueta)).join(';');
  const lineas = filas.map((fila) =>
    columnas
      .map((c) => {
        const val = typeof c.csv === 'function' ? c.csv(fila) : fila[c.campo];
        return escaparCeldaCSV(val);
      })
      .join(';')
  );
  return '\uFEFF' + [encabezado, ...lineas].join('\r\n');
}

class ReportesController {
  // 1.1 Centro de Reportes: No ejecuta ninguna consulta SQL pesada
  static centroReportes(req, res) {
    res.render('admin/reportes/centro', {
      titulo: 'Centro de Reportes y Consultas - PIJIC',
      catalogoReportes: CATALOGO_REPORTES
    });
  }

  static async ejecutarSegunSlug(slug, query, sinPaginar = false) {
    const pagina = Math.max(1, parseInt(query.pagina, 10) || 1);
    const limite = [10, 20, 50].includes(parseInt(query.limite, 10)) ? parseInt(query.limite, 10) : 20;
    const orden = query.orden || '';
    const dir = query.dir || '';

    // Validación transversal de fechas en el servidor (M4)
    const filtroFechas = parsearFiltroFechas(query);

    switch (slug) {
      case 'perdidas-bajas': {
        const res = await ReportesModel.perdidasPorBaja({
          filtroFechas,
          id_temporada: query.id_temporada || '',
          id_categoria: query.id_categoria || '',
          busqueda: query.busqueda || '',
          orden: orden || 'perdida',
          dir: dir || 'DESC',
          pagina,
          limite,
          sinPaginar
        });
        const columnas = [
          { campo: 'id_producto', etiqueta: 'ID', ordenable: 'id' },
          { campo: 'nombre_producto', etiqueta: 'Producto Dado de Baja', ordenable: 'producto', esProductoConEstado: true },
          { campo: 'nombre_categoria', etiqueta: 'Categoría' },
          { campo: 'nombre_temporada', etiqueta: 'Temporada' },
          { campo: 'fecha_baja', etiqueta: 'Fecha de Baja', ordenable: 'fecha_baja', formato: 'fecha' },
          { campo: 'motivo_baja', etiqueta: 'Motivo de Baja' },
          { campo: 'unidades_baja_calc', etiqueta: 'Unidades en Baja', ordenable: 'unidades' },
          { campo: 'costo_baja_calc', etiqueta: 'Costo Unitario (CPP)', ordenable: 'costo', formato: 'cop' },
          { campo: 'perdida_baja_calc', etiqueta: 'Pérdida por Baja', ordenable: 'perdida', formato: 'perdida_baja' },
          { campo: 'balance_ganancia_perdida', etiqueta: 'Balance Histórico (Ventas − Compras)', ordenable: 'balance', formato: 'balance_historico' }
        ];
        return {
          ...res,
          columnas,
          pagina,
          limite,
          orden: orden || 'perdida',
          dir: dir || 'DESC',
          filtroFechas,
          etiquetaFiltroFecha: 'Rango de Fechas de Baja'
        };
      }

      case 'balance-prendas': {
        const agrupacion = ['mensual', 'anual', 'total'].includes(query.agrupacion) ? query.agrupacion : 'total';
        const anio = query.anio || '';
        const id_producto_detalle = query.id_producto_detalle || '';
        const res = await ReportesModel.balancePrendas({
          agrupacion,
          anio,
          filtroFechas,
          id_temporada: query.id_temporada || '',
          id_categoria: query.id_categoria || '',
          busqueda: query.busqueda || '',
          id_producto_detalle,
          orden: orden || 'balance',
          dir: dir || 'DESC',
          pagina,
          limite,
          sinPaginar
        });

        const columnas =
          sinPaginar && (agrupacion === 'mensual' || agrupacion === 'anual')
            ? [
                { campo: 'id_producto', etiqueta: 'ID' },
                { campo: 'nombre_producto', etiqueta: 'Prenda', esProductoConEstado: true },
                { campo: 'nombre_categoria', etiqueta: 'Categoría' },
                { campo: 'nombre_temporada', etiqueta: 'Temporada' },
                { campo: 'periodo', etiqueta: 'Período' },
                { campo: 'unidades_compradas', etiqueta: 'Unids. Compradas' },
                { campo: 'dinero_invertido', etiqueta: 'Dinero Invertido' },
                { campo: 'unidades_vendidas', etiqueta: 'Unids. Vendidas' },
                { campo: 'dinero_ingresado', etiqueta: 'Dinero Ingresado' },
                { campo: 'balance_ganancia_perdida', etiqueta: 'Balance (Ganancia / Pérdida)' }
              ]
            : [
                { campo: 'id_producto', etiqueta: 'ID', ordenable: 'id' },
                { campo: 'nombre_producto', etiqueta: 'Prenda', ordenable: 'producto', esProductoConEstado: true, enlaceDetallePrenda: true },
                { campo: 'nombre_categoria', etiqueta: 'Categoría' },
                { campo: 'nombre_temporada', etiqueta: 'Temporada' },
                { campo: 'unidades_compradas', etiqueta: 'Unids. Compradas', ordenable: 'compradas' },
                { campo: 'dinero_invertido', etiqueta: 'Dinero Invertido', ordenable: 'invertido', formato: 'cop' },
                { campo: 'unidades_vendidas', etiqueta: 'Unids. Vendidas', ordenable: 'vendidas' },
                { campo: 'dinero_ingresado', etiqueta: 'Dinero Ingresado', ordenable: 'ingresado', formato: 'cop' },
                { campo: 'balance_ganancia_perdida', etiqueta: 'Balance (Ganancia / Pérdida)', ordenable: 'balance', formato: 'balance_cop' }
              ];

        return {
          ...res,
          columnas,
          pagina,
          limite,
          orden: orden || 'balance',
          dir: dir || 'DESC',
          filtroFechas,
          etiquetaFiltroFecha: 'Rango de Fechas (Compras y Ventas)',
          filtrosExtra: { agrupacion, anio, id_producto_detalle }
        };
      }

      case 'ventas-periodo': {
        const agrupacion = ['dia', 'mes', 'anio'].includes(query.agrupacion) ? query.agrupacion : 'dia';
        const formato_csv = query.formato_csv === 'detalle' ? 'detalle' : 'resumen';
        const res = await ReportesModel.ventasPorPeriodo({
          agrupacion,
          filtroFechas,
          estado_pedido: query.estado_pedido || '',
          id_metodo_pago: query.id_metodo_pago || '',
          tipo_entrega: query.tipo_entrega || '',
          busqueda_cliente: query.busqueda_cliente || '',
          id_producto: query.id_producto || '',
          periodo_detalle: query.periodo_detalle || '',
          ver_ventas: query.ver_ventas || '',
          orden: orden || 'periodo',
          dir: dir || 'DESC',
          pagina,
          limite,
          sinPaginar,
          formato_csv
        });

        const etiquetaColPeriodo = agrupacion === 'anio' ? 'Año' : agrupacion === 'mes' ? 'Mes (AAAA-MM)' : 'Fecha (Día)';
        const columnas =
          sinPaginar && formato_csv === 'detalle'
            ? [
                { campo: 'id_pedido', etiqueta: 'Pedido #' },
                { campo: 'fecha_pedido', etiqueta: 'Fecha y Hora', formato: 'fecha_hora' },
                { campo: 'cliente_nombre', etiqueta: 'Cliente' },
                { campo: 'cliente_documento', etiqueta: 'Documento' },
                { campo: 'nombre_metodo', etiqueta: 'Método Pago' },
                { campo: 'estado_pedido', etiqueta: 'Estado Pago' },
                { campo: 'estado_entrega', etiqueta: 'Estado Entrega' },
                { campo: 'nombre_producto', etiqueta: 'Producto' },
                { campo: 'nombre_talla', etiqueta: 'Talla' },
                { campo: 'nombre_color', etiqueta: 'Color' },
                { campo: 'cantidad', etiqueta: 'Cantidad' },
                { campo: 'precio_unitario', etiqueta: 'Precio Unitario Histórico' },
                { campo: 'subtotal_linea', etiqueta: 'Subtotal Línea' },
                { campo: 'descuento_puntos_pedido', etiqueta: 'Descuento Puntos Pedido' },
                { campo: 'total_pedido', etiqueta: 'Total Neto Pedido' }
              ]
            : [
                { campo: 'periodo', etiqueta: etiquetaColPeriodo, ordenable: 'periodo', formato: 'periodo_texto' },
                { campo: 'total_pedidos', etiqueta: 'Pedidos Procesados', ordenable: 'pedidos' },
                { campo: 'prendas_vendidas', etiqueta: 'Unidades Vendidas', ordenable: 'prendas' },
                { campo: 'subtotal_bruto', etiqueta: 'Subtotal Bruto', ordenable: 'subtotal', formato: 'cop' },
                { campo: 'descuento_puntos_total', etiqueta: 'Descuento por Puntos', formato: 'cop' },
                { campo: 'ingresos_netos', etiqueta: 'Ingreso Neto', ordenable: 'ingresos', formato: 'cop' },
                { campo: 'ticket_promedio', etiqueta: 'Ticket Promedio', ordenable: 'ticket', formato: 'cop' },
                { campo: 'periodo', etiqueta: 'Detalle de Ventas', formato: 'link_ventas_periodo' }
              ];

        return {
          ...res,
          columnas,
          pagina,
          limite,
          orden: orden || 'periodo',
          dir: dir || 'DESC',
          filtroFechas,
          etiquetaFiltroFecha: 'Rango de Fechas de Pedidos',
          filtrosExtra: {
            agrupacion,
            estado_pedido: query.estado_pedido || '',
            id_metodo_pago: query.id_metodo_pago || '',
            tipo_entrega: query.tipo_entrega || '',
            busqueda_cliente: query.busqueda_cliente || '',
            id_producto: query.id_producto || '',
            periodo_detalle: query.periodo_detalle || '',
            ver_ventas: query.ver_ventas || ''
          }
        };
      }

      case 'stock-bajo': {
        const umbral = query.umbral !== undefined && query.umbral !== '' ? parseInt(query.umbral, 10) : 5;
        const res = await ReportesModel.stockBajo({
          umbral,
          busqueda: query.busqueda || '',
          filtroFechas,
          orden: orden || 'stock',
          dir: dir || 'ASC',
          pagina,
          limite,
          sinPaginar
        });
        const columnas = [
          { campo: 'id_producto', etiqueta: 'ID' },
          { campo: 'nombre_producto', etiqueta: 'Producto (Activo)', ordenable: 'producto' },
          { campo: 'nombre_marca', etiqueta: 'Marca', ordenable: 'marca' },
          { campo: 'nombre_talla', etiqueta: 'Talla', ordenable: 'talla', formato: 'talla_chip' },
          { campo: 'nombre_color', etiqueta: 'Color', ordenable: 'color', formato: 'color_swatch' },
          { campo: 'cantidad_stock', etiqueta: 'Stock Actual', ordenable: 'stock', formato: 'stock_critico' },
          { campo: 'ultimo_movimiento', etiqueta: 'Último Movimiento (Venta/Compra)', ordenable: 'movimiento', formato: 'fecha' }
        ];
        return {
          ...res,
          columnas,
          pagina,
          limite,
          orden: orden || 'stock',
          dir: dir || 'ASC',
          filtroFechas,
          etiquetaFiltroFecha: 'Fecha de Último Movimiento',
          ayudaFiltroFecha: 'El stock es una foto del momento actual; este rango filtra por la última venta o compra registrada del producto.',
          filtrosExtra: { umbral }
        };
      }

      case 'historial-cliente': {
        const res = await ReportesModel.historialCliente({
          id_cliente: query.id_cliente || '',
          q_cliente: query.q_cliente || '',
          filtroFechas,
          orden: orden || 'fecha',
          dir: dir || 'DESC',
          pagina,
          limite,
          sinPaginar
        });

        // Si es exportación CSV, exportar una fila por línea de pedido con pedido, talla y color (M6)
        let filasExportar = res.filas;
        let columnas = [
          { campo: 'id_pedido', etiqueta: 'Pedido #', ordenable: 'pedido', formato: 'link_pedido' },
          { campo: 'fecha_pedido', etiqueta: 'Fecha', ordenable: 'fecha', formato: 'fecha' },
          { campo: 'nombre_metodo', etiqueta: 'Método Pago' },
          { campo: 'estado_pedido', etiqueta: 'Estado Pago', formato: 'badge' },
          { campo: 'estado_entrega', etiqueta: 'Estado Entrega', formato: 'badge' },
          { campo: 'subtotal', etiqueta: 'Subtotal', ordenable: 'subtotal', formato: 'cop' },
          { campo: 'descuento_puntos', etiqueta: 'Descuento Puntos', formato: 'cop' },
          { campo: 'total', etiqueta: 'Total Neto', ordenable: 'total', formato: 'cop' },
          { campo: 'id_pedido', etiqueta: 'Líneas (Talla/Color)', formato: 'boton_expandir_lineas' }
        ];

        if (sinPaginar && res.filas && res.filas.length > 0) {
          filasExportar = [];
          for (const ped of res.filas) {
            for (const l of ped.lineas || []) {
              filasExportar.push({
                id_pedido: ped.id_pedido,
                fecha_pedido: ped.fecha_pedido,
                estado_pedido: ped.estado_pedido,
                estado_entrega: ped.estado_entrega,
                nombre_metodo: ped.nombre_metodo,
                nombre_producto: l.nombre_producto,
                nombre_talla: l.nombre_talla,
                nombre_color: l.nombre_color,
                cantidad: l.cantidad,
                precio_unitario: l.precio_unitario,
                subtotal_linea: l.subtotal_linea,
                descuento_puntos: ped.descuento_puntos,
                total_pedido: ped.total
              });
            }
          }
          columnas = [
            { campo: 'id_pedido', etiqueta: 'Pedido #' },
            { campo: 'fecha_pedido', etiqueta: 'Fecha', formato: 'fecha' },
            { campo: 'nombre_metodo', etiqueta: 'Método Pago' },
            { campo: 'estado_pedido', etiqueta: 'Estado Pago' },
            { campo: 'estado_entrega', etiqueta: 'Estado Entrega' },
            { campo: 'nombre_producto', etiqueta: 'Producto' },
            { campo: 'nombre_talla', etiqueta: 'Talla' },
            { campo: 'nombre_color', etiqueta: 'Color' },
            { campo: 'cantidad', etiqueta: 'Cantidad' },
            { campo: 'precio_unitario', etiqueta: 'Precio Unitario' },
            { campo: 'subtotal_linea', etiqueta: 'Subtotal Línea' },
            { campo: 'descuento_puntos', etiqueta: 'Descuento Puntos Pedido' },
            { campo: 'total_pedido', etiqueta: 'Total Pedido' }
          ];
        }

        return {
          ...res,
          filas: filasExportar,
          columnas,
          pagina,
          limite,
          orden: orden || 'fecha',
          dir: dir || 'DESC',
          filtroFechas,
          etiquetaFiltroFecha: 'Rango de Fechas de Pedidos',
          filtrosExtra: {
            id_cliente: res.clienteFicha ? res.clienteFicha.id_usuario : (query.id_cliente || ''),
            q_cliente: query.q_cliente || ''
          }
        };
      }

      case 'mas-vendidos-temporada': {
        const vista = query.vista === 'variante' ? 'variante' : 'producto';
        const res = await ReportesModel.masVendidosTemporada({
          id_temporada: query.id_temporada || '',
          busqueda: query.busqueda || '',
          vista,
          filtroFechas,
          orden: orden || 'unidades',
          dir: dir || 'DESC',
          pagina,
          limite,
          sinPaginar
        });

        const columnas =
          vista === 'variante'
            ? [
                { campo: 'nombre_temporada', etiqueta: 'Temporada', ordenable: 'temporada' },
                { campo: 'nombre_producto', etiqueta: 'Producto', ordenable: 'producto', esProductoConEstado: true },
                { campo: 'nombre_marca', etiqueta: 'Marca' },
                { campo: 'nombre_talla', etiqueta: 'Talla', ordenable: 'talla', formato: 'talla_chip' },
                { campo: 'nombre_color', etiqueta: 'Color', ordenable: 'color', formato: 'color_swatch' },
                { campo: 'cantidad_pedidos', etiqueta: 'Pedidos' },
                { campo: 'total_unidades_vendidas', etiqueta: 'Unidades Vendidas', ordenable: 'unidades' },
                { campo: 'ingresos_generados', etiqueta: 'Ingresos Brutos', ordenable: 'ingresos', formato: 'cop' }
              ]
            : [
                { campo: 'nombre_temporada', etiqueta: 'Temporada', ordenable: 'temporada' },
                { campo: 'nombre_producto', etiqueta: 'Producto', ordenable: 'producto', esProductoConEstado: true },
                { campo: 'nombre_marca', etiqueta: 'Marca' },
                { campo: 'variantes_vendidas', etiqueta: 'Tallas / Colores Vendidos' },
                { campo: 'cantidad_pedidos', etiqueta: 'Pedidos' },
                { campo: 'total_unidades_vendidas', etiqueta: 'Unidades Vendidas', ordenable: 'unidades' },
                { campo: 'ingresos_generados', etiqueta: 'Ingresos Brutos', ordenable: 'ingresos', formato: 'cop' }
              ];

        return {
          ...res,
          columnas,
          pagina,
          limite,
          orden: orden || 'unidades',
          dir: dir || 'DESC',
          filtroFechas,
          etiquetaFiltroFecha: 'Rango de Fechas de Pedidos',
          filtrosExtra: { vista }
        };
      }

      case 'clientes-fidelizacion': {
        const res = await ReportesModel.clientesFidelizacion({
          busqueda: query.busqueda || '',
          filtroFechas,
          orden: orden || 'puntos',
          dir: dir || 'DESC',
          pagina,
          limite,
          sinPaginar
        });
        const columnas = [
          { campo: 'id_usuario', etiqueta: 'ID' },
          { campo: 'nombre', etiqueta: 'Cliente', ordenable: 'nombre', formato: 'cliente_con_doc' },
          { campo: 'correo', etiqueta: 'Correo Electrónico' },
          { campo: 'puntos_fidelizacion', etiqueta: 'Saldo Puntos Actual', ordenable: 'puntos', formato: 'puntos' },
          { campo: 'puntos_ganados_periodo', etiqueta: 'Puntaje Ganado en el Período', ordenable: 'ganados_periodo', formato: 'puntos_ganados' },
          { campo: 'total_pedidos', etiqueta: 'Pedidos Pagados', ordenable: 'pedidos' },
          { campo: 'total_gastado', etiqueta: 'Total Comprado', ordenable: 'gastado', formato: 'cop' },
          { campo: 'id_usuario', etiqueta: 'Auditoría Puntos', formato: 'link_puntos' }
        ];
        return {
          ...res,
          columnas,
          pagina,
          limite,
          orden: orden || 'puntos',
          dir: dir || 'DESC',
          filtroFechas,
          etiquetaFiltroFecha: 'Período para Puntaje Ganado y Compras'
        };
      }

      case 'pedidos-pendientes': {
        const res = await ReportesModel.pedidosPendientes({
          estado_entrega: query.estado_entrega || '',
          busqueda: query.busqueda || '',
          filtroFechas,
          orden: orden || 'fecha',
          dir: dir || 'ASC',
          pagina,
          limite,
          sinPaginar
        });
        const columnas = [
          { campo: 'id_pedido', etiqueta: 'Pedido #', ordenable: 'pedido', formato: 'link_pedido' },
          { campo: 'fecha_pedido', etiqueta: 'Fecha Pedido', ordenable: 'fecha', formato: 'fecha' },
          { campo: 'cliente', etiqueta: 'Cliente', ordenable: 'cliente', formato: 'cliente_con_doc' },
          { campo: 'prendas_detalle', etiqueta: 'Prendas (Talla / Color)' },
          { campo: 'direccion_entrega', etiqueta: 'Dirección de Entrega' },
          { campo: 'responsable', etiqueta: 'Responsable Logístico' },
          { campo: 'total', etiqueta: 'Total', ordenable: 'total', formato: 'cop' },
          { campo: 'estado_pedido', etiqueta: 'Estado Pago', formato: 'badge' },
          { campo: 'estado_entrega', etiqueta: 'Estado Entrega', ordenable: 'estado', formato: 'badge' }
        ];
        return {
          ...res,
          columnas,
          pagina,
          limite,
          orden: orden || 'fecha',
          dir: dir || 'ASC',
          filtroFechas,
          etiquetaFiltroFecha: 'Rango de Fechas del Pedido'
        };
      }

      case 'disponibilidad-tiempo-real': {
        const res = await ReportesModel.disponibilidadTiempoReal({
          busqueda: query.busqueda || '',
          id_categoria: query.id_categoria || '',
          orden: orden || 'stock',
          dir: dir || 'ASC',
          pagina,
          limite,
          sinPaginar
        });
        const columnas = [
          { campo: 'id_producto', etiqueta: 'ID', ordenable: 'id' },
          { campo: 'nombre_producto', etiqueta: 'Producto (Activo)', ordenable: 'producto' },
          { campo: 'nombre_categoria', etiqueta: 'Categoría' },
          { campo: 'nombre_marca', etiqueta: 'Marca' },
          { campo: 'variantes_registradas', etiqueta: 'Cant. Variantes', ordenable: 'variantes' },
          { campo: 'desglose_variantes_texto', etiqueta: 'Matriz Talla / Color (Stock)', formato: 'matriz_variantes_inline' },
          { campo: 'stock_real_fisico', etiqueta: 'Stock Físico Total', ordenable: 'stock' },
          { campo: 'diagnostico_disponibilidad', etiqueta: 'Diagnóstico Sobreventa', formato: 'badge' }
        ];
        return { ...res, columnas, pagina, limite, orden: orden || 'stock', dir: dir || 'ASC' };
      }

      case 'pago-zona-entrega': {
        const res = await ReportesModel.pagoZonaEntrega({
          tipo_entrega: query.tipo_entrega || '',
          filtroFechas,
          orden: orden || 'pedidos',
          dir: dir || 'DESC',
          pagina,
          limite,
          sinPaginar
        });
        const columnas = [
          { campo: 'nombre_metodo', etiqueta: 'Método de Pago', ordenable: 'metodo' },
          { campo: 'tipo_entrega', etiqueta: 'Logística de Entrega' },
          { campo: 'cobertura', etiqueta: 'Zona de Cobertura' },
          { campo: 'cantidad_pedidos', etiqueta: 'Cantidad Pedidos', ordenable: 'pedidos' },
          { campo: 'monto_total', etiqueta: 'Monto Total', ordenable: 'monto', formato: 'cop' },
          { campo: 'ids_pedidos_csv', etiqueta: 'Pedidos del Grupo', formato: 'boton_expandir_celda_pedidos' }
        ];
        return {
          ...res,
          columnas,
          pagina,
          limite,
          orden: orden || 'pedidos',
          dir: dir || 'DESC',
          filtroFechas,
          etiquetaFiltroFecha: 'Rango de Fechas de Pedidos'
        };
      }

      case 'desempeno-temporada': {
        const res = await ReportesModel.desempenoTemporada({
          id_temporada: query.id_temporada || '',
          busqueda: query.busqueda || '',
          filtroFechas,
          orden: orden || 'ingresos',
          dir: dir || 'DESC',
          pagina,
          limite,
          sinPaginar
        });
        const columnas = [
          { campo: 'nombre_temporada', etiqueta: 'Temporada' },
          { campo: 'nombre_producto', etiqueta: 'Prenda', ordenable: 'producto', esProductoConEstado: true },
          { campo: 'precio_actual', etiqueta: 'Precio Actual', ordenable: 'precio', formato: 'cop' },
          { campo: 'variantes_vendidas', etiqueta: 'Tallas / Colores Vendidos' },
          { campo: 'unidades_vendidas', etiqueta: 'Unidades Vendidas', ordenable: 'unidades' },
          { campo: 'ingreso_generado', etiqueta: 'Ingreso Generado', ordenable: 'ingresos', formato: 'cop' }
        ];
        return {
          ...res,
          columnas,
          pagina,
          limite,
          orden: orden || 'ingresos',
          dir: dir || 'DESC',
          filtroFechas,
          etiquetaFiltroFecha: 'Rango de Fechas de Pedidos'
        };
      }

      case 'clientes-multitemporada': {
        const res = await ReportesModel.clientesMultitemporada({
          busqueda: query.busqueda || '',
          filtroFechas,
          orden: orden || 'temporadas',
          dir: dir || 'DESC',
          pagina,
          limite,
          sinPaginar
        });
        const columnas = [
          { campo: 'nombre', etiqueta: 'Cliente', ordenable: 'cliente', formato: 'cliente_con_doc' },
          { campo: 'correo', etiqueta: 'Correo' },
          { campo: 'cantidad_temporadas_distintas', etiqueta: 'Cant. Temporadas', ordenable: 'temporadas' },
          { campo: 'temporadas_compradas', etiqueta: 'Temporadas Compradas' },
          { campo: 'ids_pedidos', etiqueta: 'Pedidos Realizados', formato: 'links_multiples_pedidos' },
          { campo: 'productos_adquiridos', etiqueta: 'Prendas Adquiridas (Talla/Color)' }
        ];
        return {
          ...res,
          columnas,
          pagina,
          limite,
          orden: orden || 'temporadas',
          dir: dir || 'DESC',
          filtroFechas,
          etiquetaFiltroFecha: 'Rango de Fechas de Pedidos'
        };
      }

      default:
        return null;
    }
  }

  static async verReporte(req, res) {
    try {
      const { slug } = req.params;
      const metaReporte = obtenerReportePorSlug(slug);
      if (!metaReporte) {
        return res.status(404).render('errors/404', { titulo: 'Reporte no encontrado' });
      }

      const catalogos = await ReportesModel.obtenerCatalogosFiltros();
      const resultado = await ReportesController.ejecutarSegunSlug(slug, req.query, false);

      const totalPaginas = Math.max(1, Math.ceil((resultado.total || 0) / resultado.limite));

      res.render('admin/reportes/detalle_reporte', {
        titulo: `${metaReporte.titulo} - Reportes PIJIC`,
        reporte: metaReporte,
        catalogos,
        filas: resultado.filas,
        columnas: resultado.columnas,
        esperandoSeleccion: Boolean(resultado.esperandoSeleccion),
        filtroFechas: resultado.filtroFechas || null,
        etiquetaFiltroFecha: resultado.etiquetaFiltroFecha || 'Rango de Fechas',
        ayudaFiltroFecha: resultado.ayudaFiltroFecha || '',
        resumen: resultado.resumen || null,
        totalesGenerales: resultado.totalesGenerales || null,
        totalesResumen: resultado.totalesResumen || null,
        tablaPivote: resultado.tablaPivote || null,
        detallePrenda: resultado.detallePrenda || null,
        pedidosDetalle: resultado.pedidosDetalle || [],
        periodoDetalleActivo: resultado.periodoDetalleActivo || '',
        coincidenciasClientes: resultado.coincidenciasClientes || [],
        clienteFicha: resultado.clienteFicha || null,
        filtros: {
          ...req.query,
          ...(resultado.filtrosExtra || {}),
          desde: resultado.filtroFechas ? resultado.filtroFechas.desde : '',
          hasta: resultado.filtroFechas ? resultado.filtroFechas.hasta : '',
          atajo_fecha: resultado.filtroFechas ? resultado.filtroFechas.atajo : '',
          orden: resultado.orden,
          dir: resultado.dir,
          limite: resultado.limite,
          pagina: resultado.pagina
        },
        paginacion: {
          paginaActual: resultado.pagina,
          limite: resultado.limite,
          totalRegistros: resultado.total || 0,
          totalPaginas
        }
      });
    } catch (error) {
      console.error('Error en ReportesController.verReporte:', error);
      res.status(500).render('errors/500', { titulo: 'Error al generar el reporte' });
    }
  }

  static async exportarCSV(req, res) {
    try {
      const { slug } = req.params;
      const metaReporte = obtenerReportePorSlug(slug);
      if (!metaReporte) {
        return res.status(404).render('errors/404', { titulo: 'Reporte no encontrado' });
      }

      const resultado = await ReportesController.ejecutarSegunSlug(slug, req.query, true);
      const formatosExcluidosCSV = ['link_puntos', 'link_ventas_periodo', 'boton_expandir_lineas'];
      const columnasCSV = resultado.columnas.filter((c) => !formatosExcluidosCSV.includes(c.formato));

      const columnasFormateadas = columnasCSV.map((col) => ({
        ...col,
        csv: (fila) => {
          if (col.esProductoConEstado && (fila.estado === 0 || fila.estado === false)) {
            return `${fila[col.campo]} (Dado de baja)`;
          }
          if (col.formato === 'fecha' && fila[col.campo]) {
            return new Date(fila[col.campo]).toISOString().split('T')[0];
          }
          if (col.formato === 'fecha_hora' && fila[col.campo]) {
            return new Date(fila[col.campo]).toISOString().slice(0, 19).replace('T', ' ');
          }
          if (col.formato === 'cliente_con_doc') {
            const doc = fila.documento ? ` (${fila.tipo_documento || 'CC'} ${fila.documento})` : '';
            return `${fila[col.campo] || ''}${doc}`;
          }
          if (col.formato === 'perdida_baja') {
            return `${fila[col.campo]}${fila.baja_estimada ? ' (Estimado)' : ''}`;
          }
          return fila[col.campo];
        }
      }));

      const csvTexto = generarContenidoCSV(columnasFormateadas, resultado.filas);
      const fechaHoy = new Date().toISOString().split('T')[0];
      const sufijoRango = resultado.filtroFechas && resultado.filtroFechas.sufijoCSV ? resultado.filtroFechas.sufijoCSV : '';
      const sufijoModo = req.query.formato_csv === 'detalle' ? '_detalle_lineas' : '';

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="reporte_${slug}${sufijoModo}${sufijoRango}_${fechaHoy}.csv"`);
      return res.status(200).send(csvTexto);
    } catch (error) {
      console.error('Error al exportar CSV:', error);
      req.session.mensajeError = 'Ocurrió un error al exportar el reporte en CSV.';
      return res.redirect(`/admin/reportes/${req.params.slug}`);
    }
  }
}

module.exports = ReportesController;
