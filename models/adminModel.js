/**
 * Archivo: models/adminModel.js
 * Propósito: Consultas SQL del Backoffice Administrador (CU02.1, CU02.2, CU02.5, CU02.6, CU02.7, Actualización 2 y Mejoras M1, M5, M6, M7).
 */
const { pool } = require('../config/db');

function obtenerHexPorNombreColor(nombre = '') {
  const n = String(nombre).toLowerCase();
  if (n.includes('blanco')) return '#FFFFFF';
  if (n.includes('negro')) return '#18181B';
  if (n.includes('azul marino') || n.includes('navy')) return '#1E3A5F';
  if (n.includes('azul cielo') || n.includes('celeste')) return '#7DD3FC';
  if (n.includes('azul')) return '#2563EB';
  if (n.includes('beige') || n.includes('arena') || n.includes('crema')) return '#D6C5A9';
  if (n.includes('verde oliva') || n.includes('militar')) return '#556B2F';
  if (n.includes('verde')) return '#166534';
  if (n.includes('café') || n.includes('cafe') || n.includes('cuero') || n.includes('marrón') || n.includes('marron')) return '#6F4E37';
  if (n.includes('gris oxford') || n.includes('grafito') || n.includes('carbón')) return '#4B5563';
  if (n.includes('gris')) return '#9CA3AF';
  if (n.includes('rojo') || n.includes('vino') || n.includes('burdeos') || n.includes('terracota')) return '#881337';
  if (n.includes('amarillo') || n.includes('mostaza')) return '#CA8A04';
  if (n.includes('caqui') || n.includes('khaki')) return '#C3B091';
  return '#71717A';
}

class AdminModel {
  // ==========================================
  // RESUMEN DASHBOARD
  // ==========================================
  static async obtenerResumenDashboard() {
    const [[{ total_productos }]] = await pool.query('SELECT COUNT(*) AS total_productos FROM productos WHERE estado = TRUE');
    const [[{ productos_baja }]] = await pool.query('SELECT COUNT(*) AS productos_baja FROM productos WHERE estado = FALSE');
    const [[{ total_clientes }]] = await pool.query('SELECT COUNT(*) AS total_clientes FROM usuarios WHERE id_rol = 2');
    const [[{ pedidos_pendientes }]] = await pool.query(
      "SELECT COUNT(*) AS pedidos_pendientes FROM entregas e JOIN pedidos p ON e.id_pedido = p.id_pedido WHERE e.estado_entrega != 'Entregado' AND p.estado_pedido != 'Cancelado'"
    );
    const [[{ ventas_totales }]] = await pool.query(
      "SELECT COALESCE(SUM(total), 0) AS ventas_totales FROM pedidos WHERE estado_pedido = 'Pagado'"
    );
    return { total_productos, productos_baja, total_clientes, pedidos_pendientes, ventas_totales };
  }

  // ==========================================
  // CU02.1 INVENTARIO ESTACIONAL Y BAJA DE PRODUCTOS (Actualización 2 + M1)
  // ==========================================
  static async obtenerDatosInventario({ estadoFiltro = 'activos', busqueda = '', pagina = 1, limite = 15 } = {}) {
    const offset = (pagina - 1) * limite;
    const whereClauses = [];
    const params = [];

    if (estadoFiltro === 'activos') {
      whereClauses.push('p.estado = TRUE');
    } else if (estadoFiltro === 'baja') {
      whereClauses.push('p.estado = FALSE');
    }

    if (busqueda && busqueda.trim()) {
      whereClauses.push('(p.nombre_producto LIKE ? OR m.nombre_marca LIKE ? OR c.nombre_categoria LIKE ?)');
      const term = `%${busqueda.trim()}%`;
      params.push(term, term, term);
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM productos p
       JOIN categorias c ON p.id_categoria = c.id_categoria
       JOIN marcas m ON p.id_marca = m.id_marca
       ${whereSQL}`,
      params
    );
    const totalRegistros = countRows[0].total;
    const totalPaginas = Math.max(1, Math.ceil(totalRegistros / limite));

    const [productos] = await pool.query(
      `SELECT p.*, c.nombre_categoria, m.nombre_marca, t.nombre_temporada, pr.nombre_proveedor,
              COALESCE(inv.stock_total, 0) AS stock_total,
              COALESCE(hist_ped.cant_pedidos, 0) AS total_pedidos_historicos,
              COALESCE(hist_comp.cant_compras, 0) AS total_compras_historicas,
              (COALESCE(hist_ped.cant_pedidos, 0) + COALESCE(hist_comp.cant_compras, 0)) AS total_movimientos_historicos,
              COALESCE(pend.pedidos_pendientes, 0) AS pedidos_pendientes_entrega
       FROM productos p
       JOIN categorias c ON p.id_categoria = c.id_categoria
       JOIN marcas m ON p.id_marca = m.id_marca
       JOIN temporadas t ON p.id_temporada = t.id_temporada
       JOIN proveedores pr ON p.id_proveedor = pr.id_proveedor
       LEFT JOIN (
         SELECT id_producto, SUM(cantidad_stock) AS stock_total
         FROM inventario
         GROUP BY id_producto
       ) inv ON p.id_producto = inv.id_producto
       LEFT JOIN (
         SELECT id_producto, COUNT(*) AS cant_pedidos
         FROM detalles_pedido
         GROUP BY id_producto
       ) hist_ped ON p.id_producto = hist_ped.id_producto
       LEFT JOIN (
         SELECT id_producto, COUNT(*) AS cant_compras
         FROM detalles_compra
         GROUP BY id_producto
       ) hist_comp ON p.id_producto = hist_comp.id_producto
       LEFT JOIN (
         SELECT dp.id_producto, COUNT(DISTINCT pe.id_pedido) AS pedidos_pendientes
         FROM detalles_pedido dp
         JOIN pedidos pe ON dp.id_pedido = pe.id_pedido
         LEFT JOIN entregas en ON pe.id_pedido = en.id_pedido
         WHERE pe.estado_pedido != 'Cancelado' AND (en.estado_entrega IS NULL OR en.estado_entrega != 'Entregado')
         GROUP BY dp.id_producto
       ) pend ON p.id_producto = pend.id_producto
       ${whereSQL}
       ORDER BY p.prioridad_visual DESC, p.id_producto DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limite), Number(offset)]
    );

    const [productosSelectorStock] = await pool.query(
      'SELECT id_producto, nombre_producto, estado FROM productos WHERE estado = TRUE ORDER BY nombre_producto ASC'
    );

    const [categorias] = await pool.query('SELECT * FROM categorias ORDER BY nombre_categoria');
    const [marcas] = await pool.query('SELECT * FROM marcas ORDER BY nombre_marca');
    const [temporadas] = await pool.query('SELECT * FROM temporadas ORDER BY id_temporada');
    const [proveedores] = await pool.query('SELECT * FROM proveedores ORDER BY nombre_proveedor');
    const [tallas] = await pool.query('SELECT * FROM tallas ORDER BY id_talla');
    const [colores] = await pool.query('SELECT * FROM colores ORDER BY nombre_color');

    return {
      productos,
      productosSelectorStock,
      categorias,
      marcas,
      temporadas,
      proveedores,
      tallas,
      colores,
      paginacion: {
        paginaActual: Number(pagina),
        limite: Number(limite),
        totalRegistros,
        totalPaginas
      }
    };
  }

  static async crearProducto(datos) {
    const { nombre_producto, descripcion, precio, id_categoria, id_marca, id_temporada, id_proveedor, prioridad_visual } = datos;
    await pool.query(
      `INSERT INTO productos (nombre_producto, descripcion, precio, id_categoria, id_marca, id_temporada, id_proveedor, prioridad_visual, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [nombre_producto, descripcion, precio, id_categoria, id_marca, id_temporada, id_proveedor, prioridad_visual || 0]
    );
  }

  static async actualizarProducto(datos) {
    const { id_producto, nombre_producto, precio, id_temporada, prioridad_visual } = datos;
    await pool.query(
      `UPDATE productos 
       SET nombre_producto = ?, precio = ?, id_temporada = ?, prioridad_visual = ?
       WHERE id_producto = ?`,
      [nombre_producto, precio, id_temporada, prioridad_visual, id_producto]
    );
  }

  // Actualización 2.1.1 + M1: Dar de baja lógica, guardar foto de pérdida Y limpiar stock transaccionalmente
  static async darDeBajaProducto(id_producto, motivo_baja) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        'SELECT id_producto, nombre_producto, estado, costo_promedio_ponderado FROM productos WHERE id_producto = ? FOR UPDATE',
        [id_producto]
      );

      if (rows.length === 0) {
        throw new Error('El producto especificado no existe.');
      }
      if (!rows[0].estado) {
        throw new Error(`El producto "${rows[0].nombre_producto}" ya se encuentra dado de baja.`);
      }

      // Calcular stock físico en este momento exacto para la foto de baja (M1)
      const [[stockRow]] = await connection.query(
        'SELECT COALESCE(SUM(cantidad_stock), 0) AS unidades_stock FROM inventario WHERE id_producto = ? FOR UPDATE',
        [id_producto]
      );

      const unidadesEnBaja = Number(stockRow.unidades_stock) || 0;
      const costoUnitarioBaja = Number(rows[0].costo_promedio_ponderado) || 0;
      const perdidaBaja = Math.round(unidadesEnBaja * costoUnitarioBaja * 100) / 100;

      const motivoLimpio = motivo_baja && motivo_baja.trim() ? motivo_baja.trim() : 'Dado de baja por el administrador';

      await connection.query(
        `UPDATE productos 
         SET estado = FALSE,
             fecha_baja = NOW(),
             motivo_baja = ?,
             unidades_en_baja = ?,
             costo_unitario_baja = ?,
             perdida_baja = ?,
             baja_estimada = FALSE
         WHERE id_producto = ?`,
        [motivoLimpio, unidadesEnBaja, costoUnitarioBaja, perdidaBaja, id_producto]
      );

      await connection.query('DELETE FROM inventario WHERE id_producto = ?', [id_producto]);

      await connection.commit();
      connection.release();

      return {
        nombre: rows[0].nombre_producto,
        unidadesEnBaja,
        costoUnitarioBaja,
        perdidaBaja
      };
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  }

  // Actualización 2 + M1: Al reactivar producto, limpiar fecha_baja, motivo_baja y los campos de foto de pérdida
  static async reactivarProducto(id_producto) {
    const [rows] = await pool.query('SELECT id_producto, nombre_producto, estado FROM productos WHERE id_producto = ?', [id_producto]);
    if (rows.length === 0) {
      throw new Error('El producto especificado no existe.');
    }

    await pool.query(
      `UPDATE productos 
       SET estado = TRUE,
           fecha_baja = NULL,
           motivo_baja = NULL,
           unidades_en_baja = NULL,
           costo_unitario_baja = NULL,
           perdida_baja = NULL,
           baja_estimada = FALSE
       WHERE id_producto = ?`,
      [id_producto]
    );
    return rows[0].nombre_producto;
  }

  static async eliminarProductoDefinitivamente(id_producto) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [prodRows] = await connection.query(
        'SELECT id_producto, nombre_producto FROM productos WHERE id_producto = ? FOR UPDATE',
        [id_producto]
      );
      if (prodRows.length === 0) {
        throw new Error('El producto que intentas eliminar no existe.');
      }
      const nombreProducto = prodRows[0].nombre_producto;

      const [[{ cantPedidos }]] = await connection.query(
        'SELECT COUNT(*) AS cantPedidos FROM detalles_pedido WHERE id_producto = ?',
        [id_producto]
      );
      const [[{ cantCompras }]] = await connection.query(
        'SELECT COUNT(*) AS cantCompras FROM detalles_compra WHERE id_producto = ?',
        [id_producto]
      );

      if (cantPedidos > 0 || cantCompras > 0) {
        throw new Error(
          `No se puede eliminar definitivamente "${nombreProducto}" porque tiene historial (${cantPedidos} venta(s) y ${cantCompras} compra(s) asociadas). Utiliza la opción "Dar de baja".`
        );
      }

      await connection.query('DELETE FROM inventario WHERE id_producto = ?', [id_producto]);
      await connection.query('DELETE FROM productos WHERE id_producto = ?', [id_producto]);

      await connection.commit();
      connection.release();
      return nombreProducto;
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  }

  static async guardarStock({ id_producto, id_talla, id_color, cantidad_stock }) {
    await pool.query(
      `INSERT INTO inventario (id_producto, id_talla, id_color, cantidad_stock)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE cantidad_stock = VALUES(cantidad_stock)`,
      [id_producto, id_talla, id_color, cantidad_stock]
    );
  }

  static async crearAtributoCatalogo(tipo, valor, codigo_hex = '') {
    if (tipo === 'categoria') {
      await pool.query('INSERT INTO categorias (nombre_categoria) VALUES (?)', [valor]);
    } else if (tipo === 'temporada') {
      await pool.query('INSERT INTO temporadas (nombre_temporada) VALUES (?)', [valor]);
    } else if (tipo === 'talla') {
      await pool.query('INSERT INTO tallas (nombre_talla) VALUES (?)', [valor]);
    } else if (tipo === 'color') {
      const hexValido = /^#[0-9A-Fa-f]{6}$/.test(String(codigo_hex || '').trim())
        ? String(codigo_hex).trim().toUpperCase()
        : obtenerHexPorNombreColor(valor);
      await pool.query('INSERT INTO colores (nombre_color, codigo_hex) VALUES (?, ?)', [valor, hexValido]);
    }
  }

  static async actualizarColorHex(id_color, nombre_color, codigo_hex) {
    const hexValido = /^#[0-9A-Fa-f]{6}$/.test(String(codigo_hex || '').trim())
      ? String(codigo_hex).trim().toUpperCase()
      : '#71717A';
    if (nombre_color && nombre_color.trim()) {
      await pool.query(
        'UPDATE colores SET nombre_color = ?, codigo_hex = ? WHERE id_color = ?',
        [nombre_color.trim(), hexValido, id_color]
      );
    } else {
      await pool.query('UPDATE colores SET codigo_hex = ? WHERE id_color = ?', [hexValido, id_color]);
    }
  }

  // M6: Detalle completo de un pedido para el Administrador
  static async obtenerDetallePedidoAdmin(id_pedido) {
    const [pedidos] = await pool.query(
      `SELECT p.*,
              u.nombre AS cliente_nombre,
              u.correo AS cliente_correo,
              u.tipo_documento AS cliente_tipo_documento,
              u.documento AS cliente_documento,
              mp.nombre_metodo,
              e.tipo_entrega,
              e.zona_cobertura,
              e.estado_entrega,
              t_emp.nombre_empresa AS transportadora
       FROM pedidos p
       JOIN usuarios u ON p.id_cliente = u.id_usuario
       JOIN metodos_pago mp ON p.id_metodo_pago = mp.id_metodo
       LEFT JOIN entregas e ON p.id_pedido = e.id_pedido
       LEFT JOIN transportadoras t_emp ON e.id_transportadora = t_emp.id_transportadora
       WHERE p.id_pedido = ?`,
      [id_pedido]
    );

    if (pedidos.length === 0) return null;
    const pedido = pedidos[0];

    const [detalles] = await pool.query(
      `SELECT dp.*,
              pr.nombre_producto,
              pr.estado AS producto_estado,
              t.nombre_talla,
              col.nombre_color,
              col.codigo_hex
       FROM detalles_pedido dp
       JOIN productos pr ON dp.id_producto = pr.id_producto
       JOIN tallas t ON dp.id_talla = t.id_talla
       JOIN colores col ON dp.id_color = col.id_color
       WHERE dp.id_pedido = ?
       ORDER BY dp.id_detalle ASC`,
      [id_pedido]
    );

    pedido.detalles = detalles;
    return pedido;
  }

  // M5: Búsqueda rápida de clientes por nombre, documento o correo (máximo 10 resultados)
  static async buscarClientesAutocompletado(termino = '', limite = 10) {
    const q = String(termino || '').trim();
    if (q.length < 2) return [];
    const like = `%${q}%`;
    const lim = Math.min(25, Math.max(1, parseInt(limite, 10) || 10));

    const [rows] = await pool.query(
      `SELECT id_usuario, nombre, tipo_documento, documento, correo, puntos_fidelizacion, fecha_registro
       FROM usuarios
       WHERE id_rol = 2
         AND (nombre LIKE ? OR documento LIKE ? OR correo LIKE ?)
       ORDER BY nombre ASC
       LIMIT ?`,
      [like, like, like, lim]
    );
    return rows;
  }

  static async listarMarcas() {
    const [rows] = await pool.query('SELECT * FROM marcas ORDER BY id_marca ASC');
    return rows;
  }

  static async crearMarca(nombre_marca) {
    await pool.query('INSERT INTO marcas (nombre_marca, estado) VALUES (?, TRUE)', [nombre_marca]);
  }

  static async actualizarMarca(id_marca, nombre_marca, estado) {
    await pool.query('UPDATE marcas SET nombre_marca = ?, estado = ? WHERE id_marca = ?', [
      nombre_marca,
      estado === '1',
      id_marca
    ]);
  }

  static async listarProveedoresConProductos() {
    const [proveedores] = await pool.query('SELECT * FROM proveedores ORDER BY id_proveedor ASC');
    const [productos] = await pool.query(
      'SELECT id_producto, nombre_producto, id_proveedor, costo_promedio_ponderado, estado FROM productos'
    );
    return { proveedores, productos };
  }

  static async crearProveedor({ nombre_proveedor, telefono, correo }) {
    await pool.query(
      'INSERT INTO proveedores (nombre_proveedor, telefono, correo) VALUES (?, ?, ?)',
      [nombre_proveedor, telefono, correo]
    );
  }

  static async actualizarProveedor({ id_proveedor, nombre_proveedor, telefono, correo }) {
    await pool.query(
      'UPDATE proveedores SET nombre_proveedor = ?, telefono = ?, correo = ? WHERE id_proveedor = ?',
      [nombre_proveedor, telefono, correo, id_proveedor]
    );
  }

  static async listarTransportadoras() {
    const [rows] = await pool.query('SELECT * FROM transportadoras ORDER BY id_transportadora ASC');
    return rows;
  }

  static async crearTransportadora({ nombre_empresa, telefono, correo }) {
    await pool.query(
      'INSERT INTO transportadoras (nombre_empresa, telefono, correo) VALUES (?, ?, ?)',
      [nombre_empresa, telefono, correo]
    );
  }

  static async actualizarTransportadora({ id_transportadora, nombre_empresa, telefono, correo }) {
    await pool.query(
      'UPDATE transportadoras SET nombre_empresa = ?, telefono = ?, correo = ? WHERE id_transportadora = ?',
      [nombre_empresa, telefono, correo, id_transportadora]
    );
  }

  static async eliminarTransportadora(id_transportadora) {
    await pool.query('DELETE FROM transportadoras WHERE id_transportadora = ?', [id_transportadora]);
  }

  static async listarMetodosPago() {
    const [rows] = await pool.query('SELECT * FROM metodos_pago ORDER BY id_metodo ASC');
    return rows;
  }

  static async crearMetodoPago(nombre_metodo) {
    await pool.query('INSERT INTO metodos_pago (nombre_metodo, estado) VALUES (?, TRUE)', [nombre_metodo]);
  }

  static async cambiarEstadoMetodoPago(id_metodo, nuevoEstado) {
    await pool.query('UPDATE metodos_pago SET estado = ? WHERE id_metodo = ?', [nuevoEstado === '1', id_metodo]);
  }
}

module.exports = AdminModel;
