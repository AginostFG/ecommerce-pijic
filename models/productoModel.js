/**
 * Archivo: models/productoModel.js
 * Propósito: Consultas SQL para el catálogo público del cliente (solo prendas activas) y detalle de producto con variantes completas (M7).
 */
const { pool } = require('../config/db');

class ProductoModel {
  static async obtenerFiltrosDisponibles() {
    const [categorias] = await pool.query('SELECT id_categoria, nombre_categoria FROM categorias ORDER BY nombre_categoria');
    const [marcas] = await pool.query('SELECT id_marca, nombre_marca FROM marcas WHERE estado = TRUE ORDER BY nombre_marca');
    const [tallas] = await pool.query('SELECT id_talla, nombre_talla FROM tallas ORDER BY id_talla');
    const [colores] = await pool.query('SELECT id_color, nombre_color, codigo_hex FROM colores ORDER BY nombre_color');

    return { categorias, marcas, tallas, colores };
  }

  static async obtenerCatalogo({ categoria, marca, talla, color } = {}) {
    const whereClauses = ['p.estado = TRUE'];
    const params = [];

    if (categoria) {
      whereClauses.push('p.id_categoria = ?');
      params.push(categoria);
    }
    if (marca) {
      whereClauses.push('p.id_marca = ?');
      params.push(marca);
    }
    if (talla) {
      whereClauses.push('i.id_talla = ?');
      params.push(talla);
    }
    if (color) {
      whereClauses.push('i.id_color = ?');
      params.push(color);
    }

    const whereSQL = `WHERE ${whereClauses.join(' AND ')}`;

    const sql = `
      SELECT p.id_producto, p.nombre_producto, p.precio, p.prioridad_visual,
             c.nombre_categoria, m.nombre_marca, temp.nombre_temporada,
             COALESCE(SUM(i.cantidad_stock), 0) AS stock_total
      FROM productos p
      JOIN categorias c ON p.id_categoria = c.id_categoria
      JOIN marcas m ON p.id_marca = m.id_marca
      JOIN temporadas temp ON p.id_temporada = temp.id_temporada
      LEFT JOIN inventario i ON p.id_producto = i.id_producto
      ${whereSQL}
      GROUP BY p.id_producto, p.nombre_producto, p.precio, p.prioridad_visual,
               c.nombre_categoria, m.nombre_marca, temp.nombre_temporada
      ORDER BY p.prioridad_visual DESC, p.id_producto DESC
    `;

    const [rows] = await pool.query(sql, params);
    if (rows.length === 0) return [];

    // Obtener colores registrados de cada producto para mostrar swatches en las tarjetas del catálogo (M7)
    const idsProductos = rows.map((r) => r.id_producto);
    const [coloresProd] = await pool.query(
      `SELECT i.id_producto, col.id_color, col.nombre_color, col.codigo_hex,
              SUM(i.cantidad_stock) AS stock_color
       FROM inventario i
       JOIN colores col ON i.id_color = col.id_color
       WHERE i.id_producto IN (?)
       GROUP BY i.id_producto, col.id_color, col.nombre_color, col.codigo_hex
       ORDER BY col.id_color ASC`,
      [idsProductos]
    );

    const mapaColores = new Map();
    for (const cp of coloresProd) {
      if (!mapaColores.has(cp.id_producto)) mapaColores.set(cp.id_producto, []);
      mapaColores.get(cp.id_producto).push({
        id_color: cp.id_color,
        nombre_color: cp.nombre_color,
        codigo_hex: cp.codigo_hex || '#71717A',
        stock_color: Number(cp.stock_color) || 0
      });
    }

    for (const prod of rows) {
      prod.colores_disponibles = mapaColores.get(prod.id_producto) || [];
    }

    return rows;
  }

  static async obtenerDetalleProducto(id_producto) {
    const [productos] = await pool.query(
      `SELECT p.id_producto, p.nombre_producto, p.descripcion, p.precio, p.estado,
              c.nombre_categoria, m.nombre_marca, temp.nombre_temporada
       FROM productos p
       JOIN categorias c ON p.id_categoria = c.id_categoria
       JOIN marcas m ON p.id_marca = m.id_marca
       JOIN temporadas temp ON p.id_temporada = temp.id_temporada
       WHERE p.id_producto = ?`,
      [id_producto]
    );

    if (productos.length === 0 || !productos[0].estado) {
      return null; // Retorna null si no existe o fue dado de baja (estado = 0)
    }

    const producto = productos[0];

    // M7: Traer TODAS las variantes registradas del producto (incluyendo cantidad_stock = 0 para mostrar estado Agotado)
    const [inventario] = await pool.query(
      `SELECT i.id_inventario, i.id_producto, i.id_talla, i.id_color, i.cantidad_stock,
              t.nombre_talla, col.nombre_color, col.codigo_hex
       FROM inventario i
       JOIN tallas t ON i.id_talla = t.id_talla
       JOIN colores col ON i.id_color = col.id_color
       WHERE i.id_producto = ?
       ORDER BY t.id_talla ASC, col.id_color ASC`,
      [id_producto]
    );

    // Extraer listas únicas de colores y tallas presentes en este producto
    const mapaColores = new Map();
    const mapaTallas = new Map();

    for (const v of inventario) {
      const stockNum = Number(v.cantidad_stock) || 0;
      if (!mapaColores.has(v.id_color)) {
        mapaColores.set(v.id_color, {
          id_color: v.id_color,
          nombre_color: v.nombre_color,
          codigo_hex: v.codigo_hex || '#71717A',
          stock_total_color: 0
        });
      }
      mapaColores.get(v.id_color).stock_total_color += stockNum;

      if (!mapaTallas.has(v.id_talla)) {
        mapaTallas.set(v.id_talla, {
          id_talla: v.id_talla,
          nombre_talla: v.nombre_talla,
          stock_total_talla: 0
        });
      }
      mapaTallas.get(v.id_talla).stock_total_talla += stockNum;
    }

    producto.variantes = inventario;
    producto.inventario = inventario; // Alias por retrocompatibilidad
    producto.colores = Array.from(mapaColores.values());
    producto.tallas = Array.from(mapaTallas.values());
    producto.stock_total = inventario.reduce((acc, curr) => acc + (Number(curr.cantidad_stock) || 0), 0);
    producto.umbral_stock_bajo = 5;

    return producto;
  }
}

module.exports = ProductoModel;
