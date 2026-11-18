/**
 * Archivo: helpers/filtroFechas.js
 * Propósito: Helper reutilizable de validación y normalización de rangos de fechas en el servidor (M4).
 * Reglas:
 *  - Formato estricto YYYY-MM-DD y fecha real válida en calendario.
 *  - desde <= hasta.
 *  - No permitir fechas futuras salvo que permitirFuturas = true.
 *  - Límite máximo de rango configurable (por defecto MAX_RANGO_ANIOS_REPORTE = 5 años).
 *  - El límite superior `hasta` se convierte en inclusivo hasta las 23:59:59 del día elegido.
 *  - Nunca interpola fechas en SQL: devuelve parámetros listos para consultas preparadas (`?`).
 */

const MAX_RANGO_ANIOS_DEFECTO = parseInt(process.env.MAX_RANGO_ANIOS_REPORTE, 10) || 5;

function formatearFechaISO(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function esFechaValidaYYYYMMDD(str) {
  if (!str || typeof str !== 'string') return false;
  const limpio = str.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpio)) return false;
  const [y, m, d] = limpio.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y &&
    dt.getMonth() === m - 1 &&
    dt.getDate() === d
  );
}

/**
 * Valida y normaliza el rango de fechas recibido por query string.
 * Soporta tanto `desde`/`hasta` como alias `fecha_inicio`/`fecha_fin`.
 */
function parsearFiltroFechas(query = {}, opciones = {}) {
  const {
    permitirFuturas = false,
    maxAnios = MAX_RANGO_ANIOS_DEFECTO
  } = opciones;

  const rawDesde = (query.desde !== undefined ? query.desde : query.fecha_inicio) || '';
  const rawHasta = (query.hasta !== undefined ? query.hasta : query.fecha_fin) || '';
  const atajo = query.atajo_fecha || '';

  const desde = String(rawDesde).trim();
  const hasta = String(rawHasta).trim();

  const errores = [];
  const hoy = new Date();
  hoy.setHours(23, 59, 59, 999);
  const hoyISO = formatearFechaISO(hoy);

  let fechaDesdeObj = null;
  let fechaHastaObj = null;

  if (desde !== '') {
    if (!esFechaValidaYYYYMMDD(desde)) {
      errores.push('La fecha "Desde" no tiene un formato válido (AAAA-MM-DD).');
    } else {
      const [y, m, d] = desde.split('-').map(Number);
      fechaDesdeObj = new Date(y, m - 1, d, 0, 0, 0, 0);
      if (!permitirFuturas && desde > hoyISO) {
        errores.push('La fecha "Desde" no puede ser una fecha futura.');
      }
    }
  }

  if (hasta !== '') {
    if (!esFechaValidaYYYYMMDD(hasta)) {
      errores.push('La fecha "Hasta" no tiene un formato válido (AAAA-MM-DD).');
    } else {
      const [y, m, d] = hasta.split('-').map(Number);
      fechaHastaObj = new Date(y, m - 1, d, 23, 59, 59, 999);
      if (!permitirFuturas && hasta > hoyISO) {
        errores.push('La fecha "Hasta" no puede ser una fecha futura.');
      }
    }
  }

  if (fechaDesdeObj && fechaHastaObj && errores.length === 0) {
    if (desde > hasta) {
      errores.push('El rango es inválido: la fecha "Desde" debe ser menor o igual a la fecha "Hasta".');
    } else {
      const diffMs = fechaHastaObj.getTime() - fechaDesdeObj.getTime();
      const maxDias = maxAnios * 366;
      const diasRango = diffMs / (1000 * 60 * 60 * 24);
      if (diasRango > maxDias) {
        errores.push(`El rango seleccionado supera el límite máximo permitido de ${maxAnios} años.`);
      }
    }
  }

  const esValido = errores.length === 0;
  const activo = esValido && (desde !== '' || hasta !== '');

  const desdeSQL = esValido && desde !== '' ? `${desde} 00:00:00` : null;
  const hastaSQL = esValido && hasta !== '' ? `${hasta} 23:59:59` : null;

  let sufijoCSV = '';
  if (activo) {
    const p1 = desde || 'inicio';
    const p2 = hasta || 'hoy';
    sufijoCSV = `_${p1}_a_${p2}`;
  }

  return {
    desde: desde,
    hasta: hasta,
    atajo,
    desdeSQL,
    hastaSQL,
    activo,
    esValido,
    errores,
    errorMensaje: errores.join(' '),
    maxAnios,
    hoyISO,
    sufijoCSV
  };
}

/**
 * Agrega condiciones parametrizadas (?, ?) sobre una columna DATETIME/TIMESTAMP a un arreglo WHERE y PARAMS.
 */
function aplicarCondicionFechasSQL(whereArr, paramsArr, columnaSQL, filtroFechas) {
  if (!filtroFechas || !filtroFechas.esValido) return;
  if (filtroFechas.desdeSQL) {
    whereArr.push(`${columnaSQL} >= ?`);
    paramsArr.push(filtroFechas.desdeSQL);
  }
  if (filtroFechas.hastaSQL) {
    whereArr.push(`${columnaSQL} <= ?`);
    paramsArr.push(filtroFechas.hastaSQL);
  }
}

module.exports = {
  parsearFiltroFechas,
  aplicarCondicionFechasSQL,
  esFechaValidaYYYYMMDD,
  formatearFechaISO,
  MAX_RANGO_ANIOS_DEFECTO
};
