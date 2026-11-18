-- ============================================================================
-- ARCHIVO: database/seed_prueba_100_productos.sql
-- PROPÓSITO: Poblar un conjunto de datos de prueba masivo (100 productos extra,
--            30 clientes extra, compras por períodos y 1.000 pedidos con detalles,
--            entregas y movimientos de puntos) para validar rendimiento (EXPLAIN),
--            reportes por período (M2, M3), bajas (M1) y filtros (M4-M7).
-- NOTA: Todos los registros creados usan IDs >= 1000 para poder borrarse
--       fácilmente sin afectar los datos semilla originales (IDs 1..99).
-- ============================================================================

USE ecommerce_ropa;

DROP PROCEDURE IF EXISTS sp_generar_seed_masivo;
DROP PROCEDURE IF EXISTS sp_limpiar_seed_masivo;

DELIMITER $$

CREATE PROCEDURE sp_limpiar_seed_masivo()
BEGIN
  DELETE FROM movimientos_puntos WHERE id_pedido >= 1000 OR id_usuario >= 1000;
  DELETE FROM entregas WHERE id_pedido >= 1000;
  DELETE FROM detalles_pedido WHERE id_pedido >= 1000 OR id_producto >= 1000;
  DELETE FROM pedidos WHERE id_pedido >= 1000 OR id_cliente >= 1000;
  DELETE FROM detalles_compra WHERE id_compra >= 1000 OR id_producto >= 1000;
  DELETE FROM compras WHERE id_compra >= 1000;
  DELETE FROM inventario WHERE id_producto >= 1000;
  DELETE FROM productos WHERE id_producto >= 1000;
  DELETE FROM usuarios WHERE id_usuario >= 1000;
END$$

CREATE PROCEDURE sp_generar_seed_masivo()
BEGIN
  DECLARE i INT DEFAULT 1;
  DECLARE v_id_prod INT;
  DECLARE v_id_cli INT;
  DECLARE v_id_ped INT;
  DECLARE v_id_comp INT;
  DECLARE v_cat INT;
  DECLARE v_mar INT;
  DECLARE v_temp INT;
  DECLARE v_prov INT;
  DECLARE v_precio DECIMAL(10,2);
  DECLARE v_costo DECIMAL(10,2);
  DECLARE v_talla1 INT;
  DECLARE v_talla2 INT;
  DECLARE v_color1 INT;
  DECLARE v_color2 INT;
  DECLARE v_cant1 INT;
  DECLARE v_cant2 INT;
  DECLARE v_sub DECIMAL(10,2);
  DECLARE v_desc DECIMAL(10,2);
  DECLARE v_tot DECIMAL(10,2);
  DECLARE v_pts_canje INT;
  DECLARE v_pts_gan INT;
  DECLARE v_fecha DATETIME;
  DECLARE v_metodo INT;
  DECLARE v_estado_ped VARCHAR(50);
  DECLARE v_tipo_ent VARCHAR(30);
  DECLARE v_estado_ent VARCHAR(50);
  DECLARE v_es_baja BOOLEAN;

  -- Limpiar primero cualquier ejecución previa del seed masivo
  CALL sp_limpiar_seed_masivo();

  -- 1. Crear 30 clientes de prueba (IDs 1001 .. 1030) con documento
  SET i = 1;
  WHILE i <= 30 DO
    SET v_id_cli = 1000 + i;
    INSERT INTO usuarios (id_usuario, nombre, tipo_documento, documento, correo, contrasena, direccion, puntos_fidelizacion, id_rol, fecha_registro)
    VALUES (
      v_id_cli,
      CONCAT('Cliente Prueba ', LPAD(i, 2, '0'), ' ', ELT(1 + (i MOD 5), 'Restrepo', 'Gaviria', 'Montoya', 'Londoño', 'Cardona')),
      ELT(1 + (i MOD 3), 'CC', 'CE', 'NIT'),
      CONCAT('1090', LPAD(i, 6, '0')),
      CONCAT('cliente.prueba', i, '@pijic.edu.co'),
      '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
      CONCAT('Calle ', 10 + i, ' # ', 20 + i, '-', i, ', Apartadó'),
      (i * 25),
      2,
      DATE_SUB('2026-10-01 10:00:00', INTERVAL (i * 7) DAY)
    );
    SET i = i + 1;
  END WHILE;

  -- 2. Crear 100 productos de prueba (IDs 1001 .. 1100), incluyendo 8 dados de baja con foto de pérdida
  SET i = 1;
  WHILE i <= 100 DO
    SET v_id_prod = 1000 + i;
    SET v_cat = 1 + (i MOD 5);
    SET v_mar = 1 + (i MOD 5);
    SET v_temp = 1 + (i MOD 4);
    SET v_prov = 1 + (i MOD 3);
    SET v_costo = 35000 + ((i MOD 12) * 6000);
    SET v_precio = v_costo * 2;
    SET v_es_baja = (i > 92); -- 8 productos dados de baja (1093..1100)

    INSERT INTO productos (
      id_producto, nombre_producto, descripcion, precio,
      id_categoria, id_marca, id_temporada, id_proveedor,
      estado, fecha_baja, motivo_baja,
      unidades_en_baja, costo_unitario_baja, perdida_baja, baja_estimada,
      prioridad_visual, costo_promedio_ponderado
    ) VALUES (
      v_id_prod,
      CONCAT(ELT(v_cat, 'Camisa', 'Pantalón', 'Chaqueta', 'Calzado', 'Accesorio'), ' Línea Ejecutiva #', i),
      CONCAT('Prenda masculina de prueba de rendimiento referencia #', i),
      v_precio,
      v_cat, v_mar, v_temp, v_prov,
      NOT v_es_baja,
      IF(v_es_baja, DATE_SUB('2026-11-10 15:00:00', INTERVAL (i - 92) * 12 DAY), NULL),
      IF(v_es_baja, ELT(1 + (i MOD 3), 'Fin de colección estacional', 'Baja rotación en tienda', 'Defecto en lote textil'), NULL),
      IF(v_es_baja, 4 + (i MOD 6), NULL),
      IF(v_es_baja, v_costo, NULL),
      IF(v_es_baja, (4 + (i MOD 6)) * v_costo, NULL),
      FALSE,
      (i MOD 80),
      v_costo
    );

    -- Inventario solo para productos activos (2 variantes por producto)
    IF NOT v_es_baja THEN
      SET v_talla1 = 1 + (i MOD 4);
      SET v_talla2 = 1 + ((i + 1) MOD 4);
      SET v_color1 = 1 + (i MOD 7);
      SET v_color2 = 1 + ((i + 2) MOD 7);

      INSERT INTO inventario (id_producto, id_talla, id_color, cantidad_stock)
      VALUES
        (v_id_prod, v_talla1, v_color1, IF(i MOD 9 = 0, 2, 12 + (i MOD 15))),
        (v_id_prod, v_talla2, v_color2, IF(i MOD 11 = 0, 0, 8 + (i MOD 10)));
    END IF;

    -- Registrar una compra histórica para cada producto (repartida entre 2025 y 2026)
    SET v_id_comp = 1000 + i;
    SET v_fecha = DATE_ADD('2025-01-10 09:00:00', INTERVAL (i * 6) DAY);
    INSERT INTO compras (id_compra, id_proveedor, fecha_compra, total_compra, estado_compra)
    VALUES (v_id_comp, v_prov, v_fecha, v_costo * 30, 'Recibida');

    INSERT INTO detalles_compra (id_compra, id_producto, id_talla, id_color, cantidad, precio_compra_unitario)
    VALUES (v_id_comp, v_id_prod, 1 + (i MOD 4), 1 + (i MOD 7), 30, v_costo);

    SET i = i + 1;
  END WHILE;

  -- 3. Crear 1.000 pedidos distribuidos en distintos meses/años (2025 y 2026)
  SET i = 1;
  WHILE i <= 1000 DO
    SET v_id_ped = 1000 + i;
    SET v_id_cli = 1001 + (i MOD 30);
    SET v_id_prod = 1001 + (i MOD 95);
    SET v_talla1 = 1 + (i MOD 4);
    SET v_color1 = 1 + (i MOD 7);
    SET v_cant1 = 1 + (i MOD 3);
    SET v_precio = (35000 + (((v_id_prod - 1000) MOD 12) * 6000)) * 2;
    SET v_sub = v_precio * v_cant1;

    -- Segundo ítem en 1 de cada 3 pedidos (para probar múltiples tallas/líneas por pedido)
    IF (i MOD 3 = 0) THEN
      SET v_talla2 = 1 + ((i + 1) MOD 4);
      SET v_color2 = 1 + ((i + 2) MOD 7);
      SET v_cant2 = 1;
      SET v_sub = v_sub + v_precio;
    END IF;

    SET v_pts_canje = IF(i MOD 5 = 0, 50, 0);
    SET v_desc = v_pts_canje * 1.00;
    SET v_tot = v_sub - v_desc;
    SET v_metodo = 1 + (i MOD 3);
    SET v_estado_ped = CASE
      WHEN i MOD 20 = 0 THEN 'Cancelado'
      WHEN v_metodo = 3 AND (i MOD 4 = 0) THEN 'Debiendo'
      ELSE 'Pagado'
    END;
    SET v_pts_gan = IF(v_estado_ped = 'Pagado', FLOOR(v_tot / 100), 0);
    SET v_fecha = DATE_ADD('2025-01-05 08:30:00', INTERVAL (i * 15) HOUR);

    INSERT INTO pedidos (
      id_pedido, id_cliente, fecha_pedido, id_metodo_pago,
      subtotal, puntos_canjeados, descuento_puntos, total, puntos_ganados,
      estado_pedido, direccion_entrega
    ) VALUES (
      v_id_ped, v_id_cli, v_fecha, v_metodo,
      v_sub, v_pts_canje, v_desc, v_tot, v_pts_gan,
      v_estado_ped, CONCAT('Carrera ', 80 + (i MOD 30), ' # 40-', (i MOD 50), ', Apartadó')
    );

    INSERT INTO detalles_pedido (id_pedido, id_producto, id_talla, id_color, cantidad, precio_unitario)
    VALUES (v_id_ped, v_id_prod, v_talla1, v_color1, v_cant1, v_precio);

    IF (i MOD 3 = 0) THEN
      INSERT INTO detalles_pedido (id_pedido, id_producto, id_talla, id_color, cantidad, precio_unitario)
      VALUES (v_id_ped, v_id_prod, v_talla2, v_color2, v_cant2, v_precio);
    END IF;

    SET v_tipo_ent = IF(i MOD 3 = 0, 'Transportadora Externa', 'Propia');
    SET v_estado_ent = CASE
      WHEN i MOD 8 = 0 THEN 'En preparación'
      WHEN i MOD 7 = 0 THEN 'Despachado'
      ELSE 'Entregado'
    END;

    INSERT INTO entregas (id_pedido, tipo_entrega, zona_cobertura, id_transportadora, estado_entrega, fecha_actualizacion)
    VALUES (
      v_id_ped,
      v_tipo_ent,
      IF(v_tipo_ent = 'Propia', TRUE, FALSE),
      IF(v_tipo_ent = 'Propia', NULL, 1 + (i MOD 3)),
      v_estado_ent,
      v_fecha
    );

    IF v_pts_gan > 0 THEN
      INSERT INTO movimientos_puntos (id_usuario, id_pedido, tipo, puntos, saldo_resultante, descripcion, fecha)
      VALUES (v_id_cli, v_id_ped, 'GANADO', v_pts_gan, 500 + v_pts_gan, CONCAT('Puntos ganados en Pedido #', v_id_ped), v_fecha);
    END IF;

    SET i = i + 1;
  END WHILE;
END$$

DELIMITER ;
