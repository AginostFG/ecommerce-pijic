-- ============================================================================
-- ARCHIVO: database/mejoras_reportes_variantes.sql
-- PROPÓSITO: Migración idempotente para las mejoras M1 a M7:
--   - M1: Foto de pérdida al dar de baja en `productos` (unidades_en_baja,
--         costo_unitario_baja, perdida_baja, baja_estimada).
--   - M2: Conservación y compatibilidad de `vista_balance_prendas`.
--   - M5: Documento de identidad en `usuarios` (tipo_documento, documento) con UNIQUE.
--   - M7: Código hexadecimal de muestra de color en `colores` (codigo_hex).
--   - Índices de rendimiento para filtros por fecha, cliente, compras y variantes.
-- ============================================================================

USE ecommerce_ropa;

-- Procedimiento auxiliar temporal para agregar columnas de forma idempotente en MySQL 8.0
DROP PROCEDURE IF EXISTS sp_agregar_columna_si_no_existe;
DROP PROCEDURE IF EXISTS sp_agregar_indice_si_no_existe;

DELIMITER $$

CREATE PROCEDURE sp_agregar_columna_si_no_existe(
  IN p_tabla VARCHAR(64),
  IN p_columna VARCHAR(64),
  IN p_definicion VARCHAR(255)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_tabla
      AND COLUMN_NAME = p_columna
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_tabla, '` ADD COLUMN `', p_columna, '` ', p_definicion);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE sp_agregar_indice_si_no_existe(
  IN p_tabla VARCHAR(64),
  IN p_indice VARCHAR(64),
  IN p_definicion VARCHAR(255)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_tabla
      AND INDEX_NAME = p_indice
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_tabla, '` ADD ', p_definicion);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

-- ============================================================================
-- 1. M5: DOCUMENTO DE IDENTIDAD EN USUARIOS
-- ============================================================================
CALL sp_agregar_columna_si_no_existe('usuarios', 'tipo_documento', "ENUM('CC','CE','NIT','Pasaporte') NULL DEFAULT 'CC' AFTER `nombre`");
CALL sp_agregar_columna_si_no_existe('usuarios', 'documento', "VARCHAR(20) NULL DEFAULT NULL AFTER `tipo_documento`");
CALL sp_agregar_indice_si_no_existe('usuarios', 'uq_usuarios_documento', 'UNIQUE INDEX `uq_usuarios_documento` (`documento`)');
CALL sp_agregar_indice_si_no_existe('usuarios', 'idx_usuarios_nombre', 'INDEX `idx_usuarios_nombre` (`nombre`)');

-- Poblar documento en usuarios semilla principales si aún no lo tienen
UPDATE usuarios SET tipo_documento = 'CC', documento = '1028000101' WHERE id_usuario = 1 AND documento IS NULL;
UPDATE usuarios SET tipo_documento = 'CC', documento = '1028456789' WHERE id_usuario = 2 AND documento IS NULL;
UPDATE usuarios SET tipo_documento = 'CC', documento = '71345678'   WHERE id_usuario = 3 AND documento IS NULL;
UPDATE usuarios SET tipo_documento = 'NIT', documento = '900456123-1' WHERE id_usuario = 4 AND documento IS NULL;
UPDATE usuarios SET tipo_documento = 'NIT', documento = '901987654-2' WHERE id_usuario = 5 AND documento IS NULL;

-- ============================================================================
-- 2. M7: CÓDIGO HEXADECIMAL EN COLORES (SWATCHES)
-- ============================================================================
CALL sp_agregar_columna_si_no_existe('colores', 'codigo_hex', "VARCHAR(7) NOT NULL DEFAULT '#71717A' AFTER `nombre_color`");

-- Rellenar colores existentes según nombres comunes en español
UPDATE colores
SET codigo_hex = CASE
  WHEN LOWER(nombre_color) LIKE '%blanco%' THEN '#FFFFFF'
  WHEN LOWER(nombre_color) LIKE '%negro%' THEN '#18181B'
  WHEN LOWER(nombre_color) LIKE '%azul marino%' OR LOWER(nombre_color) LIKE '%navy%' THEN '#1E3A5F'
  WHEN LOWER(nombre_color) LIKE '%azul cielo%' OR LOWER(nombre_color) LIKE '%celeste%' THEN '#7DD3FC'
  WHEN LOWER(nombre_color) LIKE '%azul%' THEN '#2563EB'
  WHEN LOWER(nombre_color) LIKE '%beige%' OR LOWER(nombre_color) LIKE '%arena%' OR LOWER(nombre_color) LIKE '%crema%' THEN '#D6C5A9'
  WHEN LOWER(nombre_color) LIKE '%verde oliva%' OR LOWER(nombre_color) LIKE '%militar%' THEN '#556B2F'
  WHEN LOWER(nombre_color) LIKE '%verde%' THEN '#166534'
  WHEN LOWER(nombre_color) LIKE '%café%' OR LOWER(nombre_color) LIKE '%cafe%' OR LOWER(nombre_color) LIKE '%cuero%' OR LOWER(nombre_color) LIKE '%marrón%' OR LOWER(nombre_color) LIKE '%marron%' THEN '#6F4E37'
  WHEN LOWER(nombre_color) LIKE '%gris oxford%' OR LOWER(nombre_color) LIKE '%grafito%' OR LOWER(nombre_color) LIKE '%carbón%' THEN '#4B5563'
  WHEN LOWER(nombre_color) LIKE '%gris%' THEN '#9CA3AF'
  WHEN LOWER(nombre_color) LIKE '%rojo%' OR LOWER(nombre_color) LIKE '%vino%' OR LOWER(nombre_color) LIKE '%burdeos%' OR LOWER(nombre_color) LIKE '%terracota%' THEN '#881337'
  WHEN LOWER(nombre_color) LIKE '%amarillo%' OR LOWER(nombre_color) LIKE '%mostaza%' THEN '#CA8A04'
  WHEN LOWER(nombre_color) LIKE '%caqui%' OR LOWER(nombre_color) LIKE '%khaki%' THEN '#C3B091'
  ELSE '#71717A'
END;

-- ============================================================================
-- 3. M1: FOTO DE BAJA Y PÉRDIDA EN PRODUCTOS
-- ============================================================================
CALL sp_agregar_columna_si_no_existe('productos', 'unidades_en_baja', "INT NULL DEFAULT NULL AFTER `motivo_baja`");
CALL sp_agregar_columna_si_no_existe('productos', 'costo_unitario_baja', "DECIMAL(10,2) NULL DEFAULT NULL AFTER `unidades_en_baja`");
CALL sp_agregar_columna_si_no_existe('productos', 'perdida_baja', "DECIMAL(12,2) NULL DEFAULT NULL AFTER `costo_unitario_baja`");
CALL sp_agregar_columna_si_no_existe('productos', 'baja_estimada', "BOOLEAN NOT NULL DEFAULT FALSE AFTER `perdida_baja`");

-- Para productos que YA estaban dados de baja antes de esta mejora (unidades_en_baja IS NULL):
-- Calculamos la pérdida con su stock actual en inventario × costo_promedio_ponderado actual,
-- y los marcamos con baja_estimada = TRUE para mostrar el badge "Estimado".
UPDATE productos p
LEFT JOIN (
  SELECT id_producto, COALESCE(SUM(cantidad_stock), 0) AS stock_actual
  FROM inventario
  GROUP BY id_producto
) inv ON p.id_producto = inv.id_producto
SET
  p.unidades_en_baja = COALESCE(inv.stock_actual, 0),
  p.costo_unitario_baja = COALESCE(p.costo_promedio_ponderado, 0.00),
  p.perdida_baja = ROUND(COALESCE(inv.stock_actual, 0) * COALESCE(p.costo_promedio_ponderado, 0.00), 2),
  p.baja_estimada = TRUE,
  p.fecha_baja = COALESCE(p.fecha_baja, NOW()),
  p.motivo_baja = COALESCE(p.motivo_baja, 'Dado de baja previamente (cálculo estimado en migración)')
WHERE p.estado = FALSE AND p.unidades_en_baja IS NULL;

-- ============================================================================
-- 4. ÍNDICES DE RENDIMIENTO PARA REPORTES Y CONSULTAS (M1 - M7)
-- ============================================================================
CALL sp_agregar_indice_si_no_existe('productos', 'idx_productos_fecha_baja', 'INDEX `idx_productos_fecha_baja` (`estado`, `fecha_baja`)');
CALL sp_agregar_indice_si_no_existe('pedidos', 'idx_pedidos_fecha', 'INDEX `idx_pedidos_fecha` (`fecha_pedido`)');
CALL sp_agregar_indice_si_no_existe('pedidos', 'idx_pedidos_cliente', 'INDEX `idx_pedidos_cliente` (`id_cliente`)');
CALL sp_agregar_indice_si_no_existe('compras', 'idx_compras_fecha_estado', 'INDEX `idx_compras_fecha_estado` (`fecha_compra`, `estado_compra`)');
CALL sp_agregar_indice_si_no_existe('detalles_pedido', 'idx_detalles_pedido_producto', 'INDEX `idx_detalles_pedido_producto` (`id_producto`)');
CALL sp_agregar_indice_si_no_existe('detalles_compra', 'idx_detalles_compra_producto', 'INDEX `idx_detalles_compra_producto` (`id_producto`)');
CALL sp_agregar_indice_si_no_existe('inventario', 'uq_inventario_producto_talla_color', 'UNIQUE INDEX `uq_inventario_producto_talla_color` (`id_producto`, `id_talla`, `id_color`)');
CALL sp_agregar_indice_si_no_existe('movimientos_puntos', 'idx_mov_puntos_tipo_fecha', 'INDEX `idx_mov_puntos_tipo_fecha` (`id_usuario`, `tipo`, `fecha`)');

-- Limpiar procedimientos auxiliares
DROP PROCEDURE IF EXISTS sp_agregar_columna_si_no_existe;
DROP PROCEDURE IF EXISTS sp_agregar_indice_si_no_existe;

-- ============================================================================
-- 5. ASEGURAR VISTA OFICIAL vista_balance_prendas INTACTA Y OPERATIVA
-- ============================================================================
CREATE OR REPLACE VIEW vista_balance_prendas AS
SELECT 
    p.id_producto,
    p.nombre_producto,
    p.estado,
    p.id_categoria,
    c.nombre_categoria,
    p.id_temporada,
    t.nombre_temporada,
    p.precio AS precio_venta_actual,
    p.costo_promedio_ponderado,
    COALESCE(comp.unidades_compradas, 0) AS unidades_compradas,
    COALESCE(comp.dinero_invertido, 0.00) AS dinero_invertido,
    COALESCE(vent.unidades_vendidas, 0) AS unidades_vendidas,
    COALESCE(vent.dinero_ingresado, 0.00) AS dinero_ingresado,
    (COALESCE(vent.dinero_ingresado, 0.00) - COALESCE(comp.dinero_invertido, 0.00)) AS balance_ganancia_perdida
FROM productos p
JOIN categorias c ON p.id_categoria = c.id_categoria
JOIN temporadas t ON p.id_temporada = t.id_temporada
LEFT JOIN (
    SELECT 
        dc.id_producto,
        SUM(dc.cantidad) AS unidades_compradas,
        SUM(dc.cantidad * dc.precio_compra_unitario) AS dinero_invertido
    FROM detalles_compra dc
    INNER JOIN compras co ON dc.id_compra = co.id_compra
    WHERE co.estado_compra = 'Recibida'
    GROUP BY dc.id_producto
) comp ON p.id_producto = comp.id_producto
LEFT JOIN (
    SELECT 
        dp.id_producto,
        SUM(dp.cantidad) AS unidades_vendidas,
        SUM(dp.cantidad * dp.precio_unitario) AS dinero_ingresado
    FROM detalles_pedido dp
    INNER JOIN pedidos pe ON dp.id_pedido = pe.id_pedido
    WHERE pe.estado_pedido != 'Cancelado'
    GROUP BY dp.id_producto
) vent ON p.id_producto = vent.id_producto;
