# Sistema Web de E-commerce de Ropa Masculina

Proyecto académico desarrollado para la asignatura **Diseño de Software** — **Politécnico Jaime Isaza Cadavid (Sede Apartadó)**.

## 1. Descripción del Sistema
Plataforma web centralizada en arquitectura MVC para la comercialización y gestión operativa de una tienda de ropa masculina. Permite:
- **Módulo Cliente (E-commerce):** Navegar por el catálogo con filtros dinámicos (categoría, marca, talla, color) ordenado por prioridad visual, gestionar el carrito de compras validando stock en tiempo real, ejecutar compras mediante un checkout transaccional con acumulación de puntos de fidelización y consultar el historial de pedidos y entregas.
- **Módulo Administrador (Backoffice):** Controlar el inventario estacional (verano, invierno, colecciones), marcas, proveedores, transportadoras y métodos de pago; registrar compras a proveedores recalculando automáticamente el **Costo Promedio Ponderado**; coordinar despachos (logística propia en zona de cobertura o transportadora externa) y generar consultas específicas, conjuntas y reportes financieros apoyados en la vista `vista_balance_prendas`.
- **Módulo Proveedor:** Portal de solo lectura con control de acceso por rol para consultar las prendas suministradas, órdenes de compra emitidas por la tienda, estados de solicitud e historial de suministros.

---

## 2. Stack Tecnológico
- **Backend:** Node.js + Express.js
- **Base de Datos:** MySQL (`mysql2/promise` con pool de conexiones y soporte transaccional)
- **Motor de Plantillas:** EJS (HTML5 + CSS3 responsive sin frameworks SPA)
- **Autenticación y Seguridad:** Sesiones con `express-session`, hashes de contraseñas con `bcrypt`, variables de entorno con `dotenv`, middlewares de control de acceso por rol (`requiereLogin`, `requiereRol`) y consultas SQL 100% parametrizadas (prevención de inyección SQL).

---

## 3. Estructura de Carpetas
```text
ecommerce-ropa/
├── .env.example               # Plantilla de variables de entorno
├── package.json               # Dependencias y scripts npm
├── app.js                     # Punto de entrada y configuración Express
├── config/
│   └── db.js                  # Pool de conexiones MySQL con promesas
├── database/
│   ├── schema.sql             # Esquema base oficial validado
│   ├── migraciones.sql        # Ajustes estructurales, UNIQUE, FKs e índices
│   └── seed.sql               # Datos semilla (roles, usuarios, 15 productos, compras, pedidos)
├── middlewares/
│   ├── auth.js                # Middleware requiereLogin
│   └── roles.js               # Middleware requiereRol (control 403)
├── models/                    # Capa de acceso a datos y transacciones SQL
├── controllers/               # Lógica de negocio por módulo
├── routes/                    # Definición de rutas GET/POST
├── views/                     # Vistas EJS organizadas por rol y partials
└── public/css/style.css       # Hoja de estilos responsive


---

## 4. Nuevas Mejoras Implementadas (Rama `mejoras-reportes-variantes`)

### 4.1 Orden de Ejecución de Migraciones SQL
Sobre el esquema actual del proyecto (`schema.sql` → `migraciones.sql` → `ajustes_puntos.sql` → `actualizacion_baja_productos.sql` → `actualizacion_reportes.sql`), ejecuta la nueva migración idempotente:

1. `database/mejoras_reportes_variantes.sql` — Agrega `tipo_documento` y `documento` (UNIQUE) en `usuarios`, `codigo_hex` en `colores` con relleno automático, los campos de foto de baja (`unidades_en_baja`, `costo_unitario_baja`, `perdida_baja`, `baja_estimada`) en `productos` y los índices compuestos para fechas y variantes.
2. *(Opcional para pruebas de volumen y rendimiento)* `database/seed_prueba_100_productos.sql` — Define los procedimientos `CALL sp_generar_seed_masivo()` (inserta 100 productos extra, 30 clientes con documento y 1.000 pedidos con IDs $\ge 1000$) y `CALL sp_limpiar_seed_masivo()` para borrarlos en un segundo sin tocar los datos semilla base.

### 4.2 Resumen de Nuevas Reglas de Negocio y Rutas
- **M1 (Pérdidas por productos dados de baja):**
  - Ruta: `GET /admin/reportes/perdidas-bajas` y `GET /admin/reportes/perdidas-bajas/exportar.csv` (Rol: `Administrador`).
  - Al dar de baja un producto (`POST /admin/inventario/producto/baja`), se guarda una foto inmutable en `productos` (`unidades_en_baja`, `costo_unitario_baja`, `perdida_baja = stock × costo_promedio_ponderado`) antes de vaciar `inventario`. El modal de confirmación muestra la vista previa de la pérdida en COP. Al reactivar (`POST /admin/inventario/producto/reactivar`), estos campos se limpian.
- **M2 (Balance general por prenda por períodos):**
  - Ruta: `GET /admin/reportes/balance-prendas` (con parámetros `agrupacion=total|mensual|anual`, `anio`, `desde`, `hasta`, `id_producto_detalle`).
  - Incluye tarjetas de totales del período, matriz pivote prenda × período con totales por fila/columna y vista de detalle de una prenda con evolución período a período (gráfico comparativo CSS) y desglose por talla y color.
- **M3 (Detalle de ventas e ingresos por período):**
  - Ruta: `GET /admin/reportes/ventas-periodo` (agrupación `dia|mes|anio`, filtros de estado de pago, método de pago, tipo de entrega, cliente y producto).
  - Nivel 1: resumen con ticket promedio. Nivel 2: lista de pedidos del período con filas expandibles para ver cada línea (producto, talla, color, cantidad, precio histórico). Exportación CSV en dos modos (`formato_csv=resumen` y `formato_csv=detalle`).
- **M4 (Limitador de fechas transversal):**
  - Helper `helpers/filtroFechas.js` y partial `views/admin/reportes/partials/_filtro_fechas.ejs` con atajos rápidos (*Hoy, Últimos 7 días, Este mes, Mes anterior, Este año, Todo*), validación en servidor (`desde <= hasta`, no futuras, máximo configurable en `.env` con `MAX_RANGO_ANIOS_REPORTE=5`, `hasta` inclusivo hasta `23:59:59`) e inclusión del rango en el nombre del archivo CSV.
- **M5 (Buscador de clientes por nombre, documento o correo):**
  - Endpoint JSON: `GET /admin/api/clientes/buscar?q=...` (protegido con `requiereLogin` + `requiereRol('Administrador')`, debounce de 300 ms, mínimo 2 caracteres, máximo 10 resultados, con fallback por formulario GET).
  - Registro (`POST /auth/register`) y edición de perfil (`POST /cuenta/perfil`) con validación de formato y unicidad de `documento`.
- **M6 (Tallas, colores y detalle de pedido en todas las consultas):**
  - Nueva vista de detalle de pedido para el administrador: `GET /admin/pedidos/:id` (Rol: `Administrador`).
  - Conmutador de vista *Por producto* vs. *Por producto + talla + color* en `mas-vendidos-temporada`, matriz de stock por variante en `disponibilidad-tiempo-real` y pedidos desplegables por celda en `pago-zona-entrega`.
- **M7 (Selector de color y talla estilo AliExpress):**
  - Swatches circulares con `codigo_hex` real (editable en `/admin/inventario` con `POST /admin/inventario/color/actualizar` e `<input type="color">`) y chips de talla accesibles por teclado (`aria-pressed`, `role="radiogroup"`), disponibilidad cruzada en vivo sin recargar y revalidación estricta en el servidor al agregar al carrito y en el checkout.
