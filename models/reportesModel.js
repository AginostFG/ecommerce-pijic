/**
 * Archivo: models/reportesModel.js
 * Propósito: Consultas SQL individuales con paginación en servidor, filtros de fecha parametrizados (M4),
 *            orden seguro por lista blanca y soporte CSV para las mejoras M1 a M6.
 */
const { pool } = require('../config/db');
const { aplicarCondicionFechasSQL } = require('../helpers/filtroFechas');

function validarOrden(columnaSolicitada, dirSolicitada, mapaColumnas, colDefecto, dirDefecto = 'DESC') {
  const colSQL = mapaColumnas[columnaSolicitada] || mapaColumnas[colDefecto];
  const dirSQL = String(dirSolicitada || dirDefecto).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  return `${colSQL} ${dirSQL}`;
}

function aplicarPaginacionSQL(sinPaginar, limite, pagina) {
  if (sinPaginar) return { clause: '', params: [] };
  const lim = Math.max(1, parseInt(limite, 10) || 20);
  const off = (Math.max(1, parseInt(pagina, 10) || 1) - 1) * lim;
  return { clause: ' LIMIT ? OFFSET ?', params: [lim, off] };
}

class ReportesModel {
  static async obtenerCatalogosFiltros() {
    const [categorias] = await pool.query('SELECT id_categoria, nombre_categoria FROM categorias ORDER BY nombre_categoria');
    const [temporadas] = await pool.query('SELECT id_temporada, nombre_temporada FROM temporadas ORDER BY id_temporada');
    const [metodosPago] = await pool.query('SELECT id_metodo, nombre_metodo FROM metodos_pago ORDER BY id_metodo');
    const [productos] = await pool.query('SELECT id_producto, nombre_producto, estado FROM productos ORDER BY nombre_producto');
    const [clientes] = await pool.query(
      'SELECT id_usuario, nombre, tipo_documento, documento, correo FROM usuarios WHERE id_rol = 2 ORDER BY nombre LIMIT 200'
    );
    return { categorias, temporadas, metodosPago, productos, clientes };
  }

  // ==========================================================================
  // M1. REPORTE GENERAL: PÉRDIDAS POR PRODUCTOS DADOS DE BAJA
  // ==========================================================================
  static async perdidasPorBaja({
    filtroFechas = null,
    id_temporada = '',
    id_categoria = '',
    busqueda = '',
    orden = 'perdida',
    dir = 'DESC',
    pagina = 1,
    limite = 20,
    sinPaginar = false
  }) {
    const where = ['p.estado = FALSE'];
    const params = [];

    if (id_temporada) {
      where.push('p.id_temporada = ?');
      params.push(id_temporada);
    }
    if (id_categoria) {
      where.push('p.id_categoria = ?');
      params.push(id_categoria);
    }
    if (busqueda && busqueda.trim()) {
      where.push('(p.nombre_producto LIKE ? OR p.motivo_baja LIKE ?)');
      params.push(`%${busqueda.trim()}%`, `%${busqueda.trim()}%`);
    }

    aplicarCondicionFechasSQL(where, params, 'p.fecha_baja', filtroFechas);

    const whereSQL = `WHERE ${where.join(' AND ')}`;
    const orderBy = validarOrden(
      orden,
      dir,
      {
        id: 'p.id_producto',
        producto: 'p.nombre_producto',
        fecha_baja: 'p.fecha_baja',
        unidades: 'unidades_baja_calc',
        costo: 'costo_baja_calc',
        perdida: 'perdida_baja_calc',
        balance: 'vb.balance_ganancia_perdida'
      },
      'perdida',
      'DESC'
    );

    const [[resumen]] = await pool.query(
      `SELECT 
         COUNT(*) AS total_productos_baja,
         COALESCE(SUM(COALESCE(p.unidades_en_baja, 0)), 0) AS total_unidades_perdidas,
         COALESCE(SUM(COALESCE(p.perdida_baja, COALESCE(p.unidades_en_baja, 0) * p.costo_promedio_ponderado)), 0) AS perdida_total_cop,
         COALESCE(SUM(vb.dinero_invertido), 0) AS inversion_historica_total,
         COALESCE(SUM(vb.dinero_ingresado), 0) AS ingresos_historicos_total,
         COALESCE(SUM(vb.balance_ganancia_perdida), 0) AS balance_historico_total
       FROM productos p
       JOIN vista_balance_prendas vb ON p.id_producto = vb.id_producto
       ${whereSQL}`,
      params
    );

    const total = Number(resumen.total_productos_baja) || 0;
    const pag = aplicarPaginacionSQL(sinPaginar, limite, pagina);

    const [filas] = await pool.query(
      `SELECT 
         p.id_producto,
         p.nombre_producto,
         p.estado,
         c.nombre_categoria,
         t.nombre_temporada,
         p.fecha_baja,
         p.motivo_baja,
         COALESCE(p.unidades_en_baja, 0) AS unidades_baja_calc,
         COALESCE(p.costo_unitario_baja, p.costo_promedio_ponderado) AS costo_baja_calc,
         COALESCE(p.perdida_baja, COALESCE(p.unidades_en_baja, 0) * p.costo_promedio_ponderado) AS perdida_baja_calc,
         p.baja_estimada,
         vb.unidades_compradas,
         vb.dinero_invertido,
         vb.unidades_vendidas,
         vb.dinero_ingresado,
         vb.balance_ganancia_perdida
       FROM productos p
       JOIN categorias c ON p.id_categoria = c.id_categoria
       JOIN temporadas t ON p.id_temporada = t.id_temporada
       JOIN vista_balance_prendas vb ON p.id_producto = vb.id_producto
       ${whereSQL}
       ORDER BY ${orderBy}${pag.clause}`,
      [...params, ...pag.params]
    );

    return { filas, total, resumen };
  }

  // ==========================================================================
  // M2. REPORTE GENERAL: BALANCE FINANCIERO POR PRENDA Y PERÍODOS (MES / AÑO / TOTAL)
  // ==========================================================================
  static async balancePrendas({
    agrupacion = 'total', // 'mensual' | 'anual' | 'total'
    anio = '',
    filtroFechas = null,
    id_temporada = '',
    id_categoria = '',
    busqueda = '',
    id_producto_detalle = '',
    orden = 'balance',
    dir = 'DESC',
    pagina = 1,
    limite = 20,
    sinPaginar = false
  }) {
    const modo = ['mensual', 'anual', 'total'].includes(agrupacion) ? agrupacion : 'total';

    // Filtros sobre productos
    const whereProd = [];
    const paramsProd = [];

    if (id_temporada) {
      whereProd.push('p.id_temporada = ?');
      paramsProd.push(id_temporada);
    }
    if (id_categoria) {
      whereProd.push('p.id_categoria = ?');
      paramsProd.push(id_categoria);
    }
    if (busqueda && busqueda.trim()) {
      whereProd.push('p.nombre_producto LIKE ?');
      paramsProd.push(`%${busqueda.trim()}%`);
    }

    const whereProdSQL = whereProd.length ? `WHERE ${whereProd.join(' AND ')}` : '';

    // Condiciones de fecha para compras y ventas
    const condComp = ["co.estado_compra = 'Recibida'"];
    const paramsComp = [];
    const condVent = ["pe.estado_pedido != 'Cancelado'"];
    const paramsVent = [];

    if (anio && /^\d{4}$/.test(String(anio))) {
      condComp.push('YEAR(co.fecha_compra) = ?');
      paramsComp.push(Number(anio));
      condVent.push('YEAR(pe.fecha_pedido) = ?');
      paramsVent.push(Number(anio));
    }

    aplicarCondicionFechasSQL(condComp, paramsComp, 'co.fecha_compra', filtroFechas);
    aplicarCondicionFechasSQL(condVent, paramsVent, 'pe.fecha_pedido', filtroFechas);

    const whereCompSQL = `WHERE ${condComp.join(' AND ')}`;
    const whereVentSQL = `WHERE ${condVent.join(' AND ')}`;

    const orderBy = validarOrden(
      orden,
      dir,
      {
        id: 'p.id_producto',
        producto: 'p.nombre_producto',
        compradas: 'unidades_compradas',
        invertido: 'dinero_invertido',
        vendidas: 'unidades_vendidas',
        ingresado: 'dinero_ingresado',
        balance: 'balance_ganancia_perdida'
      },
      'balance',
      'DESC'
    );

    // Subconsulta consolidada por prenda en el período filtrado
    const sqlBase = `
      FROM productos p
      JOIN categorias c ON p.id_categoria = c.id_categoria
      JOIN temporadas t ON p.id_temporada = t.id_temporada
      LEFT JOIN (
        SELECT dc.id_producto,
               SUM(dc.cantidad) AS unidades_compradas,
               SUM(dc.cantidad * dc.precio_compra_unitario) AS dinero_invertido
        FROM detalles_compra dc
        JOIN compras co ON dc.id_compra = co.id_compra
        ${whereCompSQL}
        GROUP BY dc.id_producto
      ) comp ON p.id_producto = comp.id_producto
      LEFT JOIN (
        SELECT dp.id_producto,
               SUM(dp.cantidad) AS unidades_vendidas,
               SUM(dp.cantidad * dp.precio_unitario) AS dinero_ingresado
        FROM detalles_pedido dp
        JOIN pedidos pe ON dp.id_pedido = pe.id_pedido
        ${whereVentSQL}
        GROUP BY dp.id_producto
      ) vent ON p.id_producto = vent.id_producto
      ${whereProdSQL}
    `;

    const allParamsBase = [...paramsComp, ...paramsVent, ...paramsProd];

    // Totales generales del período activo
    const [[totalesGenerales]] = await pool.query(
      `SELECT 
         COUNT(*) AS total_prendas,
         COALESCE(SUM(COALESCE(comp.unidades_compradas, 0)), 0) AS total_unidades_compradas,
         COALESCE(SUM(COALESCE(comp.dinero_invertido, 0)), 0) AS total_invertido,
         COALESCE(SUM(COALESCE(vent.unidades_vendidas, 0)), 0) AS total_unidades_vendidas,
         COALESCE(SUM(COALESCE(vent.dinero_ingresado, 0)), 0) AS total_ingresado,
         COALESCE(SUM(COALESCE(vent.dinero_ingresado, 0) - COALESCE(comp.dinero_invertido, 0)), 0) AS total_balance
       ${sqlBase}`,
      allParamsBase
    );

    const total = Number(totalesGenerales.total_prendas) || 0;
    const pag = aplicarPaginacionSQL(sinPaginar, limite, pagina);

    const [filas] = await pool.query(
      `SELECT 
         p.id_producto,
         p.nombre_producto,
         p.estado,
         p.perdida_baja,
         p.unidades_en_baja,
         c.nombre_categoria,
         t.nombre_temporada,
         COALESCE(comp.unidades_compradas, 0) AS unidades_compradas,
         COALESCE(comp.dinero_invertido, 0.00) AS dinero_invertido,
         COALESCE(vent.unidades_vendidas, 0) AS unidades_vendidas,
         COALESCE(vent.dinero_ingresado, 0.00) AS dinero_ingresado,
         (COALESCE(vent.dinero_ingresado, 0.00) - COALESCE(comp.dinero_invertido, 0.00)) AS balance_ganancia_perdida
       ${sqlBase}
       ORDER BY ${orderBy}${pag.clause}`,
      [...allParamsBase, ...pag.params]
    );

    // Si el modo es mensual o anual (o si se exporta CSV en formato largo por períodos), calcular desglose por período
    let tablaPivote = null;
    let filasLargasCSV = null;

    if (modo === 'mensual' || modo === 'anual') {
      const exprComp = modo === 'mensual' ? "DATE_FORMAT(co.fecha_compra, '%Y-%m')" : 'CAST(YEAR(co.fecha_compra) AS CHAR)';
      const exprVent = modo === 'mensual' ? "DATE_FORMAT(pe.fecha_pedido, '%Y-%m')" : 'CAST(YEAR(pe.fecha_pedido) AS CHAR)';

      const idsPagina = filas.map((f) => f.id_producto);
      if (idsPagina.length > 0) {
        const [movsComp] = await pool.query(
          `SELECT dc.id_producto, ${exprComp} AS periodo,
                  SUM(dc.cantidad) AS unidades_compradas,
                  SUM(dc.cantidad * dc.precio_compra_unitario) AS dinero_invertido
           FROM detalles_compra dc
           JOIN compras co ON dc.id_compra = co.id_compra
           ${whereCompSQL} AND dc.id_producto IN (?)
           GROUP BY dc.id_producto, periodo`,
          [...paramsComp, idsPagina]
        );

        const [movsVent] = await pool.query(
          `SELECT dp.id_producto, ${exprVent} AS periodo,
                  SUM(dp.cantidad) AS unidades_vendidas,
                  SUM(dp.cantidad * dp.precio_unitario) AS dinero_ingresado
           FROM detalles_pedido dp
           JOIN pedidos pe ON dp.id_pedido = pe.id_pedido
           ${whereVentSQL} AND dp.id_producto IN (?)
           GROUP BY dp.id_producto, periodo`,
          [...paramsVent, idsPagina]
        );

        const setPeriodos = new Set();
        movsComp.forEach((m) => { if (m.periodo) setPeriodos.add(m.periodo); });
        movsVent.forEach((m) => { if (m.periodo) setPeriodos.add(m.periodo); });
        const periodosOrdenados = Array.from(setPeriodos).sort();

        // Mapa prenda -> periodo -> métricas
        const matriz = {};
        const totalesPorColumna = {};
        periodosOrdenados.forEach((per) => {
          totalesPorColumna[per] = { compradas: 0, invertido: 0, vendidas: 0, ingresado: 0, balance: 0 };
        });

        filas.forEach((f) => {
          matriz[f.id_producto] = {};
          periodosOrdenados.forEach((per) => {
            matriz[f.id_producto][per] = { compradas: 0, invertido: 0, vendidas: 0, ingresado: 0, balance: 0 };
          });
        });

        movsComp.forEach((mc) => {
          if (matriz[mc.id_producto] && matriz[mc.id_producto][mc.periodo]) {
            const cell = matriz[mc.id_producto][mc.periodo];
            cell.compradas += Number(mc.unidades_compradas) || 0;
            cell.invertido += Number(mc.dinero_invertido) || 0;
            cell.balance = cell.ingresado - cell.invertido;

            totalesPorColumna[mc.periodo].compradas += Number(mc.unidades_compradas) || 0;
            totalesPorColumna[mc.periodo].invertido += Number(mc.dinero_invertido) || 0;
            totalesPorColumna[mc.periodo].balance =
              totalesPorColumna[mc.periodo].ingresado - totalesPorColumna[mc.periodo].invertido;
          }
        });

        movsVent.forEach((mv) => {
          if (matriz[mv.id_producto] && matriz[mv.id_producto][mv.periodo]) {
            const cell = matriz[mv.id_producto][mv.periodo];
            cell.vendidas += Number(mv.unidades_vendidas) || 0;
            cell.ingresado += Number(mv.dinero_ingresado) || 0;
            cell.balance = cell.ingresado - cell.invertido;

            totalesPorColumna[mv.periodo].vendidas += Number(mv.unidades_vendidas) || 0;
            totalesPorColumna[mv.periodo].ingresado += Number(mv.dinero_ingresado) || 0;
            totalesPorColumna[mv.periodo].balance =
              totalesPorColumna[mv.periodo].ingresado - totalesPorColumna[mv.periodo].invertido;
          }
        });

        tablaPivote = {
          periodos: periodosOrdenados,
          matriz,
          totalesPorColumna
        };

        if (sinPaginar) {
          filasLargasCSV = [];
          filas.forEach((f) => {
            if (periodosOrdenados.length === 0) {
              filasLargasCSV.push({
                id_producto: f.id_producto,
                nombre_producto: f.nombre_producto,
                estado: f.estado,
                nombre_categoria: f.nombre_categoria,
                nombre_temporada: f.nombre_temporada,
                periodo: 'Sin movimientos',
                unidades_compradas: 0,
                dinero_invertido: 0,
                unidades_vendidas: 0,
                dinero_ingresado: 0,
                balance_ganancia_perdida: 0
              });
            } else {
              periodosOrdenados.forEach((per) => {
                const c = matriz[f.id_producto][per];
                filasLargasCSV.push({
                  id_producto: f.id_producto,
                  nombre_producto: f.nombre_producto,
                  estado: f.estado,
                  nombre_categoria: f.nombre_categoria,
                  nombre_temporada: f.nombre_temporada,
                  periodo: per,
                  unidades_compradas: c.compradas,
                  dinero_invertido: c.invertido,
                  unidades_vendidas: c.vendidas,
                  dinero_ingresado: c.ingresado,
                  balance_ganancia_perdida: c.balance
                });
              });
            }
          });
        }
      }
    }

    // Detalle individual de una prenda (M2b + M6 desglose por talla y color)
    let detallePrenda = null;
    if (id_producto_detalle && /^\d+$/.test(String(id_producto_detalle))) {
      const [infoProd] = await pool.query(
        `SELECT p.*, c.nombre_categoria, t.nombre_temporada, m.nombre_marca
         FROM productos p
         JOIN categorias c ON p.id_categoria = c.id_categoria
         JOIN temporadas t ON p.id_temporada = t.id_temporada
         JOIN marcas m ON p.id_marca = m.id_marca
         WHERE p.id_producto = ?`,
        [id_producto_detalle]
      );

      if (infoProd.length > 0) {
        const exprCompDet = modo === 'anual' ? 'CAST(YEAR(co.fecha_compra) AS CHAR)' : "DATE_FORMAT(co.fecha_compra, '%Y-%m')";
        const exprVentDet = modo === 'anual' ? 'CAST(YEAR(pe.fecha_pedido) AS CHAR)' : "DATE_FORMAT(pe.fecha_pedido, '%Y-%m')";

        const [compDet] = await pool.query(
          `SELECT ${exprCompDet} AS periodo,
                  SUM(dc.cantidad) AS compradas,
                  SUM(dc.cantidad * dc.precio_compra_unitario) AS invertido
           FROM detalles_compra dc
           JOIN compras co ON dc.id_compra = co.id_compra
           ${whereCompSQL} AND dc.id_producto = ?
           GROUP BY periodo ORDER BY periodo ASC`,
          [...paramsComp, id_producto_detalle]
        );

        const [ventDet] = await pool.query(
          `SELECT ${exprVentDet} AS periodo,
                  SUM(dp.cantidad) AS vendidas,
                  SUM(dp.cantidad * dp.precio_unitario) AS ingresado
           FROM detalles_pedido dp
           JOIN pedidos pe ON dp.id_pedido = pe.id_pedido
           ${whereVentSQL} AND dp.id_producto = ?
           GROUP BY periodo ORDER BY periodo ASC`,
          [...paramsVent, id_producto_detalle]
        );

        const perSet = new Set();
        compDet.forEach((r) => { if (r.periodo) perSet.add(r.periodo); });
        ventDet.forEach((r) => { if (r.periodo) perSet.add(r.periodo); });
        const listaPer = Array.from(perSet).sort();

        const evolucion = listaPer.map((per) => {
          const c = compDet.find((x) => x.periodo === per) || { compradas: 0, invertido: 0 };
          const v = ventDet.find((x) => x.periodo === per) || { vendidas: 0, ingresado: 0 };
          const inv = Number(c.invertido) || 0;
          const ing = Number(v.ingresado) || 0;
          return {
            periodo: per,
            unidades_compradas: Number(c.compradas) || 0,
            dinero_invertido: inv,
            unidades_vendidas: Number(v.vendidas) || 0,
            dinero_ingresado: ing,
            balance: ing - inv
          };
        });

        // Desglose por variante (Talla y Color) de la prenda seleccionada (M6)
        const [variantesBalance] = await pool.query(
          `SELECT 
             tal.nombre_talla,
             col.nombre_color,
             col.codigo_hex,
             COALESCE(c_var.compradas, 0) AS unidades_compradas,
             COALESCE(c_var.invertido, 0) AS dinero_invertido,
             COALESCE(v_var.vendidas, 0) AS unidades_vendidas,
             COALESCE(v_var.ingresado, 0) AS dinero_ingresado,
             (COALESCE(v_var.ingresado, 0) - COALESCE(c_var.invertido, 0)) AS balance,
             COALESCE(inv.cantidad_stock, 0) AS stock_actual
           FROM (
             SELECT id_talla, id_color FROM detalles_compra WHERE id_producto = ?
             UNION
             SELECT id_talla, id_color FROM detalles_pedido WHERE id_producto = ?
             UNION
             SELECT id_talla, id_color FROM inventario WHERE id_producto = ?
           ) comb
           JOIN tallas tal ON comb.id_talla = tal.id_talla
           JOIN colores col ON comb.id_color = col.id_color
           LEFT JOIN (
             SELECT dc.id_talla, dc.id_color,
                    SUM(dc.cantidad) AS compradas,
                    SUM(dc.cantidad * dc.precio_compra_unitario) AS invertido
             FROM detalles_compra dc
             JOIN compras co ON dc.id_compra = co.id_compra
             ${whereCompSQL} AND dc.id_producto = ?
             GROUP BY dc.id_talla, dc.id_color
           ) c_var ON comb.id_talla = c_var.id_talla AND comb.id_color = c_var.id_color
           LEFT JOIN (
             SELECT dp.id_talla, dp.id_color,
                    SUM(dp.cantidad) AS vendidas,
                    SUM(dp.cantidad * dp.precio_unitario) AS ingresado
             FROM detalles_pedido dp
             JOIN pedidos pe ON dp.id_pedido = pe.id_pedido
             ${whereVentSQL} AND dp.id_producto = ?
             GROUP BY dp.id_talla, dp.id_color
           ) v_var ON comb.id_talla = v_var.id_talla AND comb.id_color = v_var.id_color
           LEFT JOIN inventario inv ON inv.id_producto = ? AND inv.id_talla = comb.id_talla AND inv.id_color = comb.id_color
           ORDER BY tal.id_talla ASC, col.nombre_color ASC`,
          [
            id_producto_detalle,
            id_producto_detalle,
            id_producto_detalle,
            ...paramsComp,
            id_producto_detalle,
            ...paramsVent,
            id_producto_detalle,
            id_producto_detalle
          ]
        );

        detallePrenda = {
          producto: infoProd[0],
          evolucion,
          variantes: variantesBalance
        };
      }
    }

    return {
      filas: sinPaginar && filasLargasCSV ? filasLargasCSV : filas,
      total,
      totalesGenerales,
      agrupacion: modo,
      tablaPivote,
      detallePrenda
    };
  }

  // ==========================================================================
  // M3. REPORTE GENERAL: VENTAS E INGRESOS DETALLADOS POR PERÍODO
  // ==========================================================================
  static async ventasPorPeriodo({
    agrupacion = 'dia', // 'dia' | 'mes' | 'anio'
    filtroFechas = null,
    estado_pedido = '',
    id_metodo_pago = '',
    tipo_entrega = '',
    busqueda_cliente = '',
    id_producto = '',
    periodo_detalle = '', // para abrir o filtrar un período específico
    ver_ventas = '', // '1' para ver todas las ventas del filtro activo
    orden = 'periodo',
    dir = 'DESC',
    pagina = 1,
    limite = 20,
    sinPaginar = false,
    formato_csv = 'resumen' // 'resumen' | 'detalle'
  }) {
    const modo = ['dia', 'mes', 'anio'].includes(agrupacion) ? agrupacion : 'dia';
    const exprPeriodo =
      modo === 'anio'
        ? 'CAST(YEAR(p.fecha_pedido) AS CHAR)'
        : modo === 'mes'
        ? "DATE_FORMAT(p.fecha_pedido, '%Y-%m')"
        : "DATE_FORMAT(p.fecha_pedido, '%Y-%m-%d')";

    const where = ["p.estado_pedido != 'Cancelado'"];
    const params = [];

    aplicarCondicionFechasSQL(where, params, 'p.fecha_pedido', filtroFechas);

    if (estado_pedido) {
      where.push('p.estado_pedido = ?');
      params.push(estado_pedido);
    }
    if (id_metodo_pago) {
      where.push('p.id_metodo_pago = ?');
      params.push(id_metodo_pago);
    }
    if (tipo_entrega) {
      where.push('e.tipo_entrega = ?');
      params.push(tipo_entrega);
    }
    if (busqueda_cliente && busqueda_cliente.trim()) {
      const term = `%${busqueda_cliente.trim()}%`;
      where.push('(u.nombre LIKE ? OR u.documento LIKE ? OR u.correo LIKE ?)');
      params.push(term, term, term);
    }
    if (id_producto && /^\d+$/.test(String(id_producto))) {
      where.push('EXISTS (SELECT 1 FROM detalles_pedido dp_f WHERE dp_f.id_pedido = p.id_pedido AND dp_f.id_producto = ?)');
      params.push(Number(id_producto));
    }

    const whereSQL = `WHERE ${where.join(' AND ')}`;

    const orderBy = validarOrden(
      orden,
      dir,
      {
        periodo: 'periodo',
        fecha: 'periodo',
        pedidos: 'total_pedidos',
        prendas: 'prendas_vendidas',
        subtotal: 'subtotal_bruto',
        ingresos: 'ingresos_netos',
        ticket: 'ticket_promedio'
      },
      'periodo',
      'DESC'
    );

    const baseFrom = `
      FROM pedidos p
      JOIN usuarios u ON p.id_cliente = u.id_usuario
      JOIN metodos_pago mp ON p.id_metodo_pago = mp.id_metodo
      LEFT JOIN entregas e ON p.id_pedido = e.id_pedido
      JOIN (
        SELECT id_pedido, SUM(cantidad) AS unidades
        FROM detalles_pedido
        GROUP BY id_pedido
      ) items ON p.id_pedido = items.id_pedido
      ${whereSQL}
    `;

    // Totales globales del período (deben coincidir exactamente con la suma del resumen y con la suma de los pedidos del detalle)
    const [[totalesResumen]] = await pool.query(
      `SELECT 
         COUNT(p.id_pedido) AS total_pedidos,
         COALESCE(SUM(items.unidades), 0) AS prendas_vendidas,
         COALESCE(SUM(p.subtotal), 0) AS subtotal_bruto,
         COALESCE(SUM(p.descuento_puntos), 0) AS descuento_puntos_total,
         COALESCE(SUM(p.total), 0) AS ingresos_netos,
         CASE WHEN COUNT(p.id_pedido) > 0 THEN ROUND(SUM(p.total) / COUNT(p.id_pedido), 2) ELSE 0 END AS ticket_promedio
       ${baseFrom}`,
      params
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM (SELECT ${exprPeriodo} AS periodo ${baseFrom} GROUP BY periodo) sub`,
      params
    );
    const total = countRows[0] ? countRows[0].total : 0;

    const pag = aplicarPaginacionSQL(sinPaginar, limite, pagina);
    const [filas] = await pool.query(
      `SELECT 
         ${exprPeriodo} AS periodo,
         COUNT(p.id_pedido) AS total_pedidos,
         COALESCE(SUM(items.unidades), 0) AS prendas_vendidas,
         SUM(p.subtotal) AS subtotal_bruto,
         SUM(p.descuento_puntos) AS descuento_puntos_total,
         SUM(p.total) AS ingresos_netos,
         ROUND(SUM(p.total) / COUNT(p.id_pedido), 2) AS ticket_promedio
       ${baseFrom}
       GROUP BY periodo
       ORDER BY ${orderBy}${pag.clause}`,
      [...params, ...pag.params]
    );

    // Nivel 2: Detalle de pedidos específicos (si se seleccionó un período, si se activó ver_ventas='1' o si se exporta CSV de detalle)
    let pedidosDetalle = [];
    let lineasCSVDetalle = [];

    if (periodo_detalle || ver_ventas === '1' || (sinPaginar && formato_csv === 'detalle')) {
      const whereDet = [...where];
      const paramsDet = [...params];

      if (periodo_detalle) {
        whereDet.push(`${exprPeriodo} = ?`);
        paramsDet.push(periodo_detalle);
      }

      const whereDetSQL = `WHERE ${whereDet.join(' AND ')}`;

      const [pedRows] = await pool.query(
        `SELECT 
           p.id_pedido,
           p.fecha_pedido,
           p.id_cliente,
           u.nombre AS cliente_nombre,
           u.tipo_documento AS cliente_tipo_documento,
           u.documento AS cliente_documento,
           mp.nombre_metodo,
           p.estado_pedido,
           COALESCE(e.tipo_entrega, 'Propia') AS tipo_entrega,
           COALESCE(e.estado_entrega, 'En preparación') AS estado_entrega,
           p.subtotal,
           p.puntos_canjeados,
           p.descuento_puntos,
           p.total
         FROM pedidos p
         JOIN usuarios u ON p.id_cliente = u.id_usuario
         JOIN metodos_pago mp ON p.id_metodo_pago = mp.id_metodo
         LEFT JOIN entregas e ON p.id_pedido = e.id_pedido
         ${whereDetSQL}
         ORDER BY p.fecha_pedido DESC, p.id_pedido DESC
         ${sinPaginar ? '' : 'LIMIT 200'}`,
        paramsDet
      );

      if (pedRows.length > 0) {
        const idsPedidos = pedRows.map((r) => r.id_pedido);
        const [lineasRows] = await pool.query(
          `SELECT 
             dp.id_pedido,
             dp.id_producto,
             pr.nombre_producto,
             pr.estado AS producto_estado,
             t.nombre_talla,
             col.nombre_color,
             col.codigo_hex,
             dp.cantidad,
             dp.precio_unitario,
             (dp.cantidad * dp.precio_unitario) AS subtotal_linea
           FROM detalles_pedido dp
           JOIN productos pr ON dp.id_producto = pr.id_producto
           JOIN tallas t ON dp.id_talla = t.id_talla
           JOIN colores col ON dp.id_color = col.id_color
           WHERE dp.id_pedido IN (?)
           ORDER BY dp.id_pedido DESC, dp.id_detalle ASC`,
          [idsPedidos]
        );

        const mapaLineas = new Map();
        for (const l of lineasRows) {
          if (!mapaLineas.has(l.id_pedido)) mapaLineas.set(l.id_pedido, []);
          mapaLineas.get(l.id_pedido).push(l);
        }

        pedidosDetalle = pedRows.map((ped) => ({
          ...ped,
          lineas: mapaLineas.get(ped.id_pedido) || []
        }));

        if (sinPaginar && formato_csv === 'detalle') {
          for (const ped of pedidosDetalle) {
            for (const lin of ped.lineas) {
              lineasCSVDetalle.push({
                id_pedido: ped.id_pedido,
                fecha_pedido: ped.fecha_pedido,
                cliente_nombre: ped.cliente_nombre,
                cliente_documento: ped.cliente_documento ? `${ped.cliente_tipo_documento || 'CC'} ${ped.cliente_documento}` : 'Sin documento',
                nombre_metodo: ped.nombre_metodo,
                estado_pedido: ped.estado_pedido,
                estado_entrega: ped.estado_entrega,
                nombre_producto: lin.nombre_producto,
                nombre_talla: lin.nombre_talla,
                nombre_color: lin.nombre_color,
                cantidad: lin.cantidad,
                precio_unitario: lin.precio_unitario,
                subtotal_linea: lin.subtotal_linea,
                descuento_puntos_pedido: ped.descuento_puntos,
                total_pedido: ped.total
              });
            }
          }
        }
      }
    }

    return {
      filas: sinPaginar && formato_csv === 'detalle' ? lineasCSVDetalle : filas,
      total,
      totalesResumen,
      agrupacion: modo,
      pedidosDetalle,
      periodoDetalleActivo: periodo_detalle
    };
  }

  // ==========================================================================
  // 3. ESPECÍFICA 1: STOCK BAJO POR TALLA Y COLOR (M4: última fecha movimiento + M6)
  // ==========================================================================
  static async stockBajo({
    umbral = 5,
    busqueda = '',
    filtroFechas = null,
    orden = 'stock',
    dir = 'ASC',
    pagina = 1,
    limite = 20,
    sinPaginar = false
  }) {
    const where = ['p.estado = TRUE', 'i.cantidad_stock <= ?'];
    const params = [Number(umbral)];

    if (busqueda && busqueda.trim()) {
      where.push('(p.nombre_producto LIKE ? OR m.nombre_marca LIKE ? OR t.nombre_talla LIKE ? OR col.nombre_color LIKE ?)');
      const term = `%${busqueda.trim()}%`;
      params.push(term, term, term, term);
    }

    // Expresión de última fecha de movimiento (última venta no cancelada o última compra recibida del producto)
    const exprUltimoMov = `GREATEST(COALESCE(ult_vent.ultima_venta, '1970-01-01 00:00:00'), COALESCE(ult_comp.ultima_compra, '1970-01-01 00:00:00'))`;

    if (filtroFechas && filtroFechas.esValido && filtroFechas.activo) {
      where.push('(ult_vent.ultima_venta IS NOT NULL OR ult_comp.ultima_compra IS NOT NULL)');
      if (filtroFechas.desdeSQL) {
        where.push(`${exprUltimoMov} >= ?`);
        params.push(filtroFechas.desdeSQL);
      }
      if (filtroFechas.hastaSQL) {
        where.push(`${exprUltimoMov} <= ?`);
        params.push(filtroFechas.hastaSQL);
      }
    }

    const whereSQL = `WHERE ${where.join(' AND ')}`;
    const orderBy = validarOrden(
      orden,
      dir,
      {
        stock: 'i.cantidad_stock',
        producto: 'p.nombre_producto',
        marca: 'm.nombre_marca',
        talla: 't.nombre_talla',
        color: 'col.nombre_color',
        movimiento: 'ultimo_movimiento'
      },
      'stock',
      'ASC'
    );

    const baseJoins = `
      FROM inventario i
      JOIN productos p ON i.id_producto = p.id_producto
      JOIN marcas m ON p.id_marca = m.id_marca
      JOIN tallas t ON i.id_talla = t.id_talla
      JOIN colores col ON i.id_color = col.id_color
      LEFT JOIN (
        SELECT dp.id_producto, MAX(pe.fecha_pedido) AS ultima_venta
        FROM detalles_pedido dp
        JOIN pedidos pe ON dp.id_pedido = pe.id_pedido
        WHERE pe.estado_pedido != 'Cancelado'
        GROUP BY dp.id_producto
      ) ult_vent ON p.id_producto = ult_vent.id_producto
      LEFT JOIN (
        SELECT dc.id_producto, MAX(co.fecha_compra) AS ultima_compra
        FROM detalles_compra dc
        JOIN compras co ON dc.id_compra = co.id_compra
        WHERE co.estado_compra = 'Recibida'
        GROUP BY dc.id_producto
      ) ult_comp ON p.id_producto = ult_comp.id_producto
      ${whereSQL}
    `;

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${baseJoins}`, params);

    const pag = aplicarPaginacionSQL(sinPaginar, limite, pagina);
    const [filas] = await pool.query(
      `SELECT 
         p.id_producto,
         p.nombre_producto,
         m.nombre_marca,
         t.nombre_talla,
         col.nombre_color,
         col.codigo_hex,
         i.cantidad_stock,
         CASE
           WHEN ult_vent.ultima_venta IS NULL AND ult_comp.ultima_compra IS NULL THEN NULL
           ELSE ${exprUltimoMov}
         END AS ultimo_movimiento
       ${baseJoins}
       ORDER BY ${orderBy}${pag.clause}`,
      [...params, ...pag.params]
    );

    return { filas, total };
  }

  // ==========================================================================
  // 4. ESPECÍFICA 2: HISTORIAL DE COMPRAS DE UN CLIENTE (M5: buscador + M4 + M6)
  // ==========================================================================
  static async historialCliente({
    id_cliente = '',
    q_cliente = '',
    filtroFechas = null,
    orden = 'fecha',
    dir = 'DESC',
    pagina = 1,
    limite = 20,
    sinPaginar = false
  }) {
    let clienteIdFinal = id_cliente ? String(id_cliente).trim() : '';
    let coincidenciasClientes = [];

    // Si no viene id_cliente pero viene texto de búsqueda q_cliente (fallback sin JS o búsqueda parcial)
    if (!clienteIdFinal && q_cliente && q_cliente.trim()) {
      const term = `%${q_cliente.trim()}%`;
      const [coinc] = await pool.query(
        `SELECT u.id_usuario, u.nombre, u.tipo_documento, u.documento, u.correo, u.puntos_fidelizacion, u.fecha_registro,
                COUNT(ped.id_pedido) AS total_pedidos,
                COALESCE(SUM(CASE WHEN ped.estado_pedido != 'Cancelado' THEN ped.total ELSE 0 END), 0) AS total_gastado
         FROM usuarios u
         LEFT JOIN pedidos ped ON u.id_usuario = ped.id_cliente
         WHERE u.id_rol = 2
           AND (u.nombre LIKE ? OR u.documento LIKE ? OR u.correo LIKE ?)
         GROUP BY u.id_usuario, u.nombre, u.tipo_documento, u.documento, u.correo, u.puntos_fidelizacion, u.fecha_registro
         ORDER BY u.nombre ASC
         LIMIT 25`,
        [term, term, term]
      );

      if (coinc.length === 1) {
        // Si devuelve un único cliente, abrir directo su historial (M5)
        clienteIdFinal = String(coinc[0].id_usuario);
      } else {
        coincidenciasClientes = coinc;
        return {
          filas: [],
          total: 0,
          esperandoSeleccion: coinc.length === 0,
          coincidenciasClientes,
          clienteFicha: null
        };
      }
    }

    if (!clienteIdFinal) {
      return { filas: [], total: 0, esperandoSeleccion: true, coincidenciasClientes: [], clienteFicha: null };
    }

    // Obtener ficha completa del cliente seleccionado
    const [fichaRows] = await pool.query(
      `SELECT u.id_usuario, u.nombre, u.tipo_documento, u.documento, u.correo, u.direccion,
              u.puntos_fidelizacion, u.fecha_registro,
              COUNT(ped.id_pedido) AS numero_pedidos_historico,
              COALESCE(SUM(CASE WHEN ped.estado_pedido != 'Cancelado' THEN ped.total ELSE 0 END), 0) AS total_gastado_historico
       FROM usuarios u
       LEFT JOIN pedidos ped ON u.id_usuario = ped.id_cliente
       WHERE u.id_usuario = ? AND u.id_rol = 2
       GROUP BY u.id_usuario, u.nombre, u.tipo_documento, u.documento, u.correo, u.direccion, u.puntos_fidelizacion, u.fecha_registro`,
      [clienteIdFinal]
    );

    if (fichaRows.length === 0) {
      return { filas: [], total: 0, esperandoSeleccion: true, coincidenciasClientes: [], clienteFicha: null };
    }

    const clienteFicha = fichaRows[0];

    const where = ['ped.id_cliente = ?'];
    const params = [clienteIdFinal];
    aplicarCondicionFechasSQL(where, params, 'ped.fecha_pedido', filtroFechas);
    const whereSQL = `WHERE ${where.join(' AND ')}`;

    const orderBy = validarOrden(
      orden,
      dir,
      {
        pedido: 'ped.id_pedido',
        fecha: 'ped.fecha_pedido',
        subtotal: 'ped.subtotal',
        total: 'ped.total'
      },
      'fecha',
      'DESC'
    );

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM pedidos ped ${whereSQL}`, params);
    const pag = aplicarPaginacionSQL(sinPaginar, limite, pagina);

    const [filas] = await pool.query(
      `SELECT ped.id_pedido, ped.fecha_pedido, ped.subtotal, ped.puntos_canjeados,
              ped.descuento_puntos, ped.total, ped.puntos_ganados, ped.estado_pedido,
              mp.nombre_metodo, COALESCE(e.tipo_entrega, 'Propia') AS tipo_entrega,
              COALESCE(e.estado_entrega, 'En preparación') AS estado_entrega,
              GROUP_CONCAT(
                CONCAT(
                  pr.nombre_producto,
                  IF(pr.estado = 0, ' [Dado de baja]', ''),
                  ' (Talla ', t.nombre_talla, ' · ', col.nombre_color, ' ×', dp.cantidad, ' a $', ROUND(dp.precio_unitario), ')'
                ) SEPARATOR ' | '
              ) AS prendas
       FROM pedidos ped
       JOIN metodos_pago mp ON ped.id_metodo_pago = mp.id_metodo
       LEFT JOIN entregas e ON ped.id_pedido = e.id_pedido
       JOIN detalles_pedido dp ON ped.id_pedido = dp.id_pedido
       JOIN productos pr ON dp.id_producto = pr.id_producto
       JOIN tallas t ON dp.id_talla = t.id_talla
       JOIN colores col ON dp.id_color = col.id_color
       ${whereSQL}
       GROUP BY ped.id_pedido, ped.fecha_pedido, ped.subtotal, ped.puntos_canjeados,
                ped.descuento_puntos, ped.total, ped.puntos_ganados, ped.estado_pedido,
                mp.nombre_metodo, e.tipo_entrega, e.estado_entrega
       ORDER BY ${orderBy}${pag.clause}`,
      [...params, ...pag.params]
    );

    // Cargar las líneas detalladas de cada pedido para expandir en la vista y para exportar CSV granular (M5, M6)
    if (filas.length > 0) {
      const idsPedidos = filas.map((f) => f.id_pedido);
      const [lineas] = await pool.query(
        `SELECT dp.id_pedido, dp.id_producto, pr.nombre_producto, pr.estado AS producto_estado,
                t.nombre_talla, col.nombre_color, col.codigo_hex,
                dp.cantidad, dp.precio_unitario,
                (dp.cantidad * dp.precio_unitario) AS subtotal_linea
         FROM detalles_pedido dp
         JOIN productos pr ON dp.id_producto = pr.id_producto
         JOIN tallas t ON dp.id_talla = t.id_talla
         JOIN colores col ON dp.id_color = col.id_color
         WHERE dp.id_pedido IN (?)
         ORDER BY dp.id_pedido DESC, dp.id_detalle ASC`,
        [idsPedidos]
      );

      const mapaLineas = new Map();
      for (const l of lineas) {
        if (!mapaLineas.has(l.id_pedido)) mapaLineas.set(l.id_pedido, []);
        mapaLineas.get(l.id_pedido).push(l);
      }

      for (const f of filas) {
        f.lineas = mapaLineas.get(f.id_pedido) || [];
      }
    }

    return {
      filas,
      total,
      esperandoSeleccion: false,
      coincidenciasClientes: [],
      clienteFicha
    };
  }

  // ==========================================================================
  // 5. ESPECÍFICA 3: MÁS VENDIDOS POR TEMPORADA (M4 + M6: vista por producto vs por variante)
  // ==========================================================================
  static async masVendidosTemporada({
    id_temporada = '',
    busqueda = '',
    vista = 'producto', // 'producto' | 'variante'
    filtroFechas = null,
    orden = 'unidades',
    dir = 'DESC',
    pagina = 1,
    limite = 20,
    sinPaginar = false
  }) {
    const modoVista = vista === 'variante' ? 'variante' : 'producto';
    const where = ["ped.estado_pedido != 'Cancelado'"];
    const params = [];

    if (id_temporada) {
      where.push('temp.id_temporada = ?');
      params.push(id_temporada);
    }
    if (busqueda && busqueda.trim()) {
      where.push('(p.nombre_producto LIKE ? OR m.nombre_marca LIKE ?)');
      params.push(`%${busqueda.trim()}%`, `%${busqueda.trim()}%`);
    }

    aplicarCondicionFechasSQL(where, params, 'ped.fecha_pedido', filtroFechas);

    const whereSQL = `WHERE ${where.join(' AND ')}`;
    const orderBy = validarOrden(
      orden,
      dir,
      {
        temporada: 'temp.nombre_temporada',
        producto: 'p.nombre_producto',
        talla: 't.nombre_talla',
        color: 'col.nombre_color',
        unidades: 'total_unidades_vendidas',
        ingresos: 'ingresos_generados'
      },
      'unidades',
      'DESC'
    );

    if (modoVista === 'variante') {
      const baseGroupVar = `
        FROM detalles_pedido dp
        JOIN pedidos ped ON dp.id_pedido = ped.id_pedido
        JOIN productos p ON dp.id_producto = p.id_producto
        JOIN temporadas temp ON p.id_temporada = temp.id_temporada
        JOIN marcas m ON p.id_marca = m.id_marca
        JOIN tallas t ON dp.id_talla = t.id_talla
        JOIN colores col ON dp.id_color = col.id_color
        ${whereSQL}
        GROUP BY temp.id_temporada, temp.nombre_temporada, p.id_producto, p.nombre_producto, p.estado,
                 m.nombre_marca, t.id_talla, t.nombre_talla, col.id_color, col.nombre_color, col.codigo_hex
      `;

      const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM (SELECT p.id_producto ${baseGroupVar}) sub`, params);
      const total = countRows[0] ? countRows[0].total : 0;

      const pag = aplicarPaginacionSQL(sinPaginar, limite, pagina);
      const [filas] = await pool.query(
        `SELECT temp.nombre_temporada, p.id_producto, p.nombre_producto, p.estado, m.nombre_marca,
                t.nombre_talla, col.nombre_color, col.codigo_hex,
                COUNT(DISTINCT ped.id_pedido) AS cantidad_pedidos,
                SUM(dp.cantidad) AS total_unidades_vendidas,
                SUM(dp.cantidad * dp.precio_unitario) AS ingresos_generados
         ${baseGroupVar}
         ORDER BY ${orderBy}${pag.clause}`,
        [...params, ...pag.params]
      );

      return { filas, total, vista: modoVista };
    }

    const baseGroup = `
      FROM detalles_pedido dp
      JOIN pedidos ped ON dp.id_pedido = ped.id_pedido
      JOIN productos p ON dp.id_producto = p.id_producto
      JOIN temporadas temp ON p.id_temporada = temp.id_temporada
      JOIN marcas m ON p.id_marca = m.id_marca
      JOIN tallas t ON dp.id_talla = t.id_talla
      JOIN colores col ON dp.id_color = col.id_color
      ${whereSQL}
      GROUP BY temp.id_temporada, temp.nombre_temporada, p.id_producto, p.nombre_producto, p.estado, m.nombre_marca
    `;

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM (SELECT p.id_producto ${baseGroup}) sub`, params);
    const total = countRows[0] ? countRows[0].total : 0;

    const pag = aplicarPaginacionSQL(sinPaginar, limite, pagina);
    const [filas] = await pool.query(
      `SELECT temp.nombre_temporada, p.id_producto, p.nombre_producto, p.estado, m.nombre_marca,
              GROUP_CONCAT(DISTINCT CONCAT(t.nombre_talla, '/', col.nombre_color) SEPARATOR ', ') AS variantes_vendidas,
              COUNT(DISTINCT ped.id_pedido) AS cantidad_pedidos,
              SUM(dp.cantidad) AS total_unidades_vendidas,
              SUM(dp.cantidad * dp.precio_unitario) AS ingresos_generados
       ${baseGroup}
       ORDER BY ${orderBy}${pag.clause}`,
      [...params, ...pag.params]
    );

    return { filas, total, vista: modoVista };
  }

  // ==========================================================================
  // 6. ESPECÍFICA 4: CLIENTES CON MAYOR PUNTAJE DE FIDELIZACIÓN (M4: puntaje ganado en período)
  // ==========================================================================
  static async clientesFidelizacion({
    busqueda = '',
    filtroFechas = null,
    orden = 'puntos',
    dir = 'DESC',
    pagina = 1,
    limite = 20,
    sinPaginar = false
  }) {
    const where = ['u.id_rol = 2'];
    const params = [];

    if (busqueda && busqueda.trim()) {
      where.push('(u.nombre LIKE ? OR u.correo LIKE ? OR u.documento LIKE ?)');
      const term = `%${busqueda.trim()}%`;
      params.push(term, term, term);
    }

    const whereMov = ["mp.tipo = 'GANADO'"];
    const paramsMov = [];
    aplicarCondicionFechasSQL(whereMov, paramsMov, 'mp.fecha', filtroFechas);
    const whereMovSQL = `WHERE ${whereMov.join(' AND ')}`;

    const wherePed = ["ped.estado_pedido = 'Pagado'"];
    const paramsPed = [];
    aplicarCondicionFechasSQL(wherePed, paramsPed, 'ped.fecha_pedido', filtroFechas);
    const wherePedSQL = `WHERE ${wherePed.join(' AND ')}`;

    const whereSQL = `WHERE ${where.join(' AND ')}`;
    const orderBy = validarOrden(
      orden,
      dir,
      {
        nombre: 'u.nombre',
        puntos: 'u.puntos_fidelizacion',
        ganados_periodo: 'puntos_ganados_periodo',
        pedidos: 'total_pedidos',
        gastado: 'total_gastado'
      },
      'puntos',
      'DESC'
    );

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM usuarios u ${whereSQL}`, params);
    const pag = aplicarPaginacionSQL(sinPaginar, limite, pagina);

    const [filas] = await pool.query(
      `SELECT u.id_usuario, u.nombre, u.tipo_documento, u.documento, u.correo, u.puntos_fidelizacion,
              COALESCE(mov.puntos_ganados_periodo, 0) AS puntos_ganados_periodo,
              COALESCE(p_agg.total_pedidos, 0) AS total_pedidos,
              COALESCE(p_agg.total_gastado, 0) AS total_gastado
       FROM usuarios u
       LEFT JOIN (
         SELECT mp.id_usuario, SUM(mp.puntos) AS puntos_ganados_periodo
         FROM movimientos_puntos mp
         ${whereMovSQL}
         GROUP BY mp.id_usuario
       ) mov ON u.id_usuario = mov.id_usuario
       LEFT JOIN (
         SELECT ped.id_cliente, COUNT(ped.id_pedido) AS total_pedidos, SUM(ped.total) AS total_gastado
         FROM pedidos ped
         ${wherePedSQL}
         GROUP BY ped.id_cliente
       ) p_agg ON u.id_usuario = p_agg.id_cliente
       ${whereSQL}
       ORDER BY ${orderBy}${pag.clause}`,
      [...paramsMov, ...paramsPed, ...params, ...pag.params]
    );

    return { filas, total };
  }

  // ==========================================================================
  // 7. ESPECÍFICA 5: PEDIDOS PENDIENTES DE ENTREGA (M4 + M6: enlace pedido y prendas con talla/color)
  // ==========================================================================
  static async pedidosPendientes({
    estado_entrega = '',
    busqueda = '',
    filtroFechas = null,
    orden = 'fecha',
    dir = 'ASC',
    pagina = 1,
    limite = 20,
    sinPaginar = false
  }) {
    const where = ["e.estado_entrega != 'Entregado'", "ped.estado_pedido != 'Cancelado'"];
    const params = [];

    if (estado_entrega) {
      where.push('e.estado_entrega = ?');
      params.push(estado_entrega);
    }
    if (busqueda && busqueda.trim()) {
      where.push('(u.nombre LIKE ? OR u.documento LIKE ? OR CAST(ped.id_pedido AS CHAR) LIKE ?)');
      const term = `%${busqueda.trim()}%`;
      params.push(term, term, term);
    }

    aplicarCondicionFechasSQL(where, params, 'ped.fecha_pedido', filtroFechas);

    const whereSQL = `WHERE ${where.join(' AND ')}`;
    const orderBy = validarOrden(
      orden,
      dir,
      {
        pedido: 'ped.id_pedido',
        fecha: 'ped.fecha_pedido',
        cliente: 'u.nombre',
        total: 'ped.total',
        estado: 'e.estado_entrega'
      },
      'fecha',
      'ASC'
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM entregas e
       JOIN pedidos ped ON e.id_pedido = ped.id_pedido
       JOIN usuarios u ON ped.id_cliente = u.id_usuario
       ${whereSQL}`,
      params
    );

    const pag = aplicarPaginacionSQL(sinPaginar, limite, pagina);
    const [filas] = await pool.query(
      `SELECT ped.id_pedido, ped.fecha_pedido,
              u.id_usuario AS id_cliente, u.nombre AS cliente, u.tipo_documento, u.documento,
              ped.direccion_entrega,
              ped.estado_pedido, ped.total,
              e.tipo_entrega, COALESCE(tr.nombre_empresa, 'Logística Propia Urabá') AS responsable,
              e.estado_entrega,
              GROUP_CONCAT(
                CONCAT(pr.nombre_producto, ' (', t.nombre_talla, '/', col.nombre_color, ' ×', dp.cantidad, ')')
                SEPARATOR ', '
              ) AS prendas_detalle
       FROM entregas e
       JOIN pedidos ped ON e.id_pedido = ped.id_pedido
       JOIN usuarios u ON ped.id_cliente = u.id_usuario
       LEFT JOIN transportadoras tr ON e.id_transportadora = tr.id_transportadora
       LEFT JOIN detalles_pedido dp ON ped.id_pedido = dp.id_pedido
       LEFT JOIN productos pr ON dp.id_producto = pr.id_producto
       LEFT JOIN tallas t ON dp.id_talla = t.id_talla
       LEFT JOIN colores col ON dp.id_color = col.id_color
       ${whereSQL}
       GROUP BY ped.id_pedido, ped.fecha_pedido, u.id_usuario, u.nombre, u.tipo_documento, u.documento,
                ped.direccion_entrega, ped.estado_pedido, ped.total, e.tipo_entrega, tr.nombre_empresa, e.estado_entrega
       ORDER BY ${orderBy}${pag.clause}`,
      [...params, ...pag.params]
    );

    return { filas, total };
  }

  // ==========================================================================
  // 8. CONJUNTA 1: DISPONIBILIDAD EN TIEMPO REAL (M6: desglose matriz/tabla por talla y color)
  // ==========================================================================
  static async disponibilidadTiempoReal({
    busqueda = '',
    id_categoria = '',
    orden = 'stock',
    dir = 'ASC',
    pagina = 1,
    limite = 20,
    sinPaginar = false
  }) {
    const where = ['p.estado = TRUE'];
    const params = [];

    if (id_categoria) {
      where.push('p.id_categoria = ?');
      params.push(id_categoria);
    }
    if (busqueda && busqueda.trim()) {
      where.push('(p.nombre_producto LIKE ? OR m.nombre_marca LIKE ?)');
      params.push(`%${busqueda.trim()}%`, `%${busqueda.trim()}%`);
    }

    const whereSQL = `WHERE ${where.join(' AND ')}`;
    const orderBy = validarOrden(
      orden,
      dir,
      {
        id: 'p.id_producto',
        producto: 'p.nombre_producto',
        variantes: 'variantes_registradas',
        stock: 'stock_real_fisico'
      },
      'stock',
      'ASC'
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM productos p JOIN marcas m ON p.id_marca = m.id_marca ${whereSQL}`,
      params
    );

    const pag = aplicarPaginacionSQL(sinPaginar, limite, pagina);
    const [filas] = await pool.query(
      `SELECT p.id_producto, p.nombre_producto, c.nombre_categoria, m.nombre_marca,
              COUNT(i.id_inventario) AS variantes_registradas,
              COALESCE(SUM(i.cantidad_stock), 0) AS stock_real_fisico,
              GROUP_CONCAT(
                CONCAT(t.nombre_talla, '/', col.nombre_color, ': ', i.cantidad_stock)
                ORDER BY t.id_talla ASC, col.nombre_color ASC
                SEPARATOR ' | '
              ) AS desglose_variantes_texto,
              CASE 
                WHEN COALESCE(SUM(i.cantidad_stock), 0) > 5 THEN 'Disponible para Venta'
                WHEN COALESCE(SUM(i.cantidad_stock), 0) BETWEEN 1 AND 5 THEN 'Pocas Unidades'
                ELSE 'ALERTA: Visible sin Stock (Riesgo Sobreventa)'
              END AS diagnostico_disponibilidad
       FROM productos p
       JOIN categorias c ON p.id_categoria = c.id_categoria
       JOIN marcas m ON p.id_marca = m.id_marca
       LEFT JOIN inventario i ON p.id_producto = i.id_producto
       LEFT JOIN tallas t ON i.id_talla = t.id_talla
       LEFT JOIN colores col ON i.id_color = col.id_color
       ${whereSQL}
       GROUP BY p.id_producto, p.nombre_producto, c.nombre_categoria, m.nombre_marca
       ORDER BY ${orderBy}${pag.clause}`,
      [...params, ...pag.params]
    );

    // Cargar matriz detallada de variantes para cada producto de la página actual
    if (filas.length > 0 && !sinPaginar) {
      const idsProd = filas.map((f) => f.id_producto);
      const [vars] = await pool.query(
        `SELECT i.id_producto, i.id_inventario, i.cantidad_stock,
                t.id_talla, t.nombre_talla,
                col.id_color, col.nombre_color, col.codigo_hex
         FROM inventario i
         JOIN tallas t ON i.id_talla = t.id_talla
         JOIN colores col ON i.id_color = col.id_color
         WHERE i.id_producto IN (?)
         ORDER BY t.id_talla ASC, col.nombre_color ASC`,
        [idsProd]
      );

      const mapaVar = new Map();
      for (const v of vars) {
        if (!mapaVar.has(v.id_producto)) mapaVar.set(v.id_producto, []);
        mapaVar.get(v.id_producto).push(v);
      }

      for (const f of filas) {
        f.variantes_detalle = mapaVar.get(f.id_producto) || [];
      }
    }

    return { filas, total };
  }

  // ==========================================================================
  // 9. CONJUNTA 2: RELACIÓN MÉTODO DE PAGO VS ZONA DE ENTREGA (M4 + M6: pedidos desplegables por celda)
  // ==========================================================================
  static async pagoZonaEntrega({
    tipo_entrega = '',
    filtroFechas = null,
    orden = 'pedidos',
    dir = 'DESC',
    pagina = 1,
    limite = 20,
    sinPaginar = false
  }) {
    const where = ["ped.estado_pedido != 'Cancelado'"];
    const params = [];

    if (tipo_entrega) {
      where.push('e.tipo_entrega = ?');
      params.push(tipo_entrega);
    }

    aplicarCondicionFechasSQL(where, params, 'ped.fecha_pedido', filtroFechas);

    const whereSQL = `WHERE ${where.join(' AND ')}`;
    const orderBy = validarOrden(
      orden,
      dir,
      {
        metodo: 'mp.nombre_metodo',
        pedidos: 'cantidad_pedidos',
        monto: 'monto_total'
      },
      'pedidos',
      'DESC'
    );

    const baseGroup = `
      FROM pedidos ped
      JOIN metodos_pago mp ON ped.id_metodo_pago = mp.id_metodo
      JOIN entregas e ON ped.id_pedido = e.id_pedido
      ${whereSQL}
      GROUP BY mp.id_metodo, mp.nombre_metodo, e.tipo_entrega, e.zona_cobertura
    `;

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM (SELECT mp.id_metodo ${baseGroup}) sub`, params);
    const total = countRows[0] ? countRows[0].total : 0;

    const pag = aplicarPaginacionSQL(sinPaginar, limite, pagina);
    const [filas] = await pool.query(
      `SELECT mp.id_metodo, mp.nombre_metodo, e.tipo_entrega, e.zona_cobertura,
              CASE WHEN e.zona_cobertura = TRUE THEN 'Dentro de Cobertura (Urabá)' ELSE 'Fuera de Cobertura (Nacional)' END AS cobertura,
              COUNT(ped.id_pedido) AS cantidad_pedidos,
              SUM(ped.total) AS monto_total,
              GROUP_CONCAT(CONCAT('#', ped.id_pedido) ORDER BY ped.id_pedido DESC SEPARATOR ', ') AS ids_pedidos_csv
       ${baseGroup}
       ORDER BY ${orderBy}${pag.clause}`,
      [...params, ...pag.params]
    );

    // Obtener la lista de pedidos de cada grupo para mostrar al expandir la fila (M6)
    if (filas.length > 0 && !sinPaginar) {
      const [pedidosCeldas] = await pool.query(
        `SELECT ped.id_pedido, ped.fecha_pedido, ped.total, ped.estado_pedido,
                ped.id_metodo_pago, e.tipo_entrega, e.zona_cobertura, e.estado_entrega,
                u.nombre AS cliente_nombre, u.documento AS cliente_documento
         FROM pedidos ped
         JOIN entregas e ON ped.id_pedido = e.id_pedido
         JOIN usuarios u ON ped.id_cliente = u.id_usuario
         ${whereSQL}
         ORDER BY ped.fecha_pedido DESC`,
        params
      );

      for (const fila of filas) {
        fila.pedidos_celda = pedidosCeldas
          .filter(
            (p) =>
              p.id_metodo_pago === fila.id_metodo &&
              p.tipo_entrega === fila.tipo_entrega &&
              Boolean(p.zona_cobertura) === Boolean(fila.zona_cobertura)
          )
          .slice(0, 50);
      }
    }

    return { filas, total };
  }

  // ==========================================================================
  // 10. CONJUNTA 3: PRODUCTOS DE UNA TEMPORADA (M4 + M6: desglose tallas y colores)
  // ==========================================================================
  static async desempenoTemporada({
    id_temporada = '',
    busqueda = '',
    filtroFechas = null,
    orden = 'ingresos',
    dir = 'DESC',
    pagina = 1,
    limite = 20,
    sinPaginar = false
  }) {
    if (!id_temporada) {
      return { filas: [], total: 0, esperandoSeleccion: true };
    }

    const where = ['p.id_temporada = ?'];
    const params = [id_temporada];

    if (busqueda && busqueda.trim()) {
      where.push('p.nombre_producto LIKE ?');
      params.push(`%${busqueda.trim()}%`);
    }

    const condFechaPed = ["ped.estado_pedido != 'Cancelado'"];
    const paramsFechaPed = [];
    aplicarCondicionFechasSQL(condFechaPed, paramsFechaPed, 'ped.fecha_pedido', filtroFechas);
    const joinPedCond = condFechaPed.join(' AND ');

    const whereSQL = `WHERE ${where.join(' AND ')}`;
    const orderBy = validarOrden(
      orden,
      dir,
      {
        producto: 'p.nombre_producto',
        precio: 'p.precio',
        unidades: 'unidades_vendidas',
        ingresos: 'ingreso_generado'
      },
      'ingresos',
      'DESC'
    );

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM productos p ${whereSQL}`, params);
    const pag = aplicarPaginacionSQL(sinPaginar, limite, pagina);

    const [filas] = await pool.query(
      `SELECT temp.nombre_temporada, p.id_producto, p.nombre_producto, p.estado, p.precio AS precio_actual,
              COALESCE(SUM(CASE WHEN ped.id_pedido IS NOT NULL THEN dp.cantidad ELSE 0 END), 0) AS unidades_vendidas,
              COALESCE(SUM(CASE WHEN ped.id_pedido IS NOT NULL THEN dp.cantidad * dp.precio_unitario ELSE 0 END), 0) AS ingreso_generado,
              GROUP_CONCAT(
                DISTINCT CASE WHEN ped.id_pedido IS NOT NULL THEN CONCAT(t.nombre_talla, '/', col.nombre_color) ELSE NULL END
                SEPARATOR ', '
              ) AS variantes_vendidas
       FROM productos p
       JOIN temporadas temp ON p.id_temporada = temp.id_temporada
       LEFT JOIN detalles_pedido dp ON p.id_producto = dp.id_producto
       LEFT JOIN pedidos ped ON dp.id_pedido = ped.id_pedido AND ${joinPedCond}
       LEFT JOIN tallas t ON dp.id_talla = t.id_talla
       LEFT JOIN colores col ON dp.id_color = col.id_color
       ${whereSQL}
       GROUP BY p.id_producto, p.nombre_producto, p.estado, p.precio, temp.nombre_temporada
       ORDER BY ${orderBy}${pag.clause}`,
      [...paramsFechaPed, ...params, ...pag.params]
    );

    return { filas, total, esperandoSeleccion: false };
  }

  // ==========================================================================
  // 11. CONJUNTA 4: CLIENTES MULTITEMPORADA (M4 + M6: pedidos enlazables y productos con talla/color)
  // ==========================================================================
  static async clientesMultitemporada({
    busqueda = '',
    filtroFechas = null,
    orden = 'temporadas',
    dir = 'DESC',
    pagina = 1,
    limite = 20,
    sinPaginar = false
  }) {
    const where = ["ped.estado_pedido != 'Cancelado'"];
    const params = [];

    if (busqueda && busqueda.trim()) {
      where.push('(u.nombre LIKE ? OR u.correo LIKE ? OR u.documento LIKE ?)');
      const term = `%${busqueda.trim()}%`;
      params.push(term, term, term);
    }

    aplicarCondicionFechasSQL(where, params, 'ped.fecha_pedido', filtroFechas);

    const whereSQL = `WHERE ${where.join(' AND ')}`;
    const orderBy = validarOrden(
      orden,
      dir,
      {
        cliente: 'u.nombre',
        temporadas: 'cantidad_temporadas_distintas',
        pedidos: 'cantidad_pedidos'
      },
      'temporadas',
      'DESC'
    );

    const baseGroup = `
      FROM usuarios u
      JOIN pedidos ped ON u.id_usuario = ped.id_cliente
      JOIN detalles_pedido dp ON ped.id_pedido = dp.id_pedido
      JOIN productos p ON dp.id_producto = p.id_producto
      JOIN temporadas temp ON p.id_temporada = temp.id_temporada
      JOIN tallas t ON dp.id_talla = t.id_talla
      JOIN colores col ON dp.id_color = col.id_color
      ${whereSQL}
      GROUP BY u.id_usuario, u.nombre, u.tipo_documento, u.documento, u.correo
      HAVING COUNT(DISTINCT p.id_temporada) > 1
    `;

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM (SELECT u.id_usuario ${baseGroup}) sub`, params);
    const total = countRows[0] ? countRows[0].total : 0;

    const pag = aplicarPaginacionSQL(sinPaginar, limite, pagina);
    const [filas] = await pool.query(
      `SELECT u.id_usuario, u.nombre, u.tipo_documento, u.documento, u.correo,
              COUNT(DISTINCT p.id_temporada) AS cantidad_temporadas_distintas,
              COUNT(DISTINCT ped.id_pedido) AS cantidad_pedidos,
              GROUP_CONCAT(DISTINCT ped.id_pedido ORDER BY ped.id_pedido DESC SEPARATOR ',') AS ids_pedidos,
              GROUP_CONCAT(DISTINCT temp.nombre_temporada SEPARATOR ' | ') AS temporadas_compradas,
              GROUP_CONCAT(
                DISTINCT CONCAT(p.nombre_producto, ' (', t.nombre_talla, '/', col.nombre_color, ')')
                SEPARATOR ', '
              ) AS productos_adquiridos
       ${baseGroup}
       ORDER BY ${orderBy}${pag.clause}`,
      [...params, ...pag.params]
    );

    return { filas, total };
  }
}

module.exports = ReportesModel;
