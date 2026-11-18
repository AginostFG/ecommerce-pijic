/**
 * Archivo: models/usuarioModel.js
 * Propósito: Modelo de datos para interactuar con la tabla usuarios y roles (incluye validación de documento M5).
 */
const { pool } = require('../config/db');

class UsuarioModel {
  static async buscarPorCorreo(correo) {
    const [rows] = await pool.query(
      `SELECT u.*, r.nombre_rol 
       FROM usuarios u 
       JOIN roles r ON u.id_rol = r.id_rol 
       WHERE u.correo = ?`,
      [correo]
    );
    return rows[0];
  }

  static async buscarPorDocumento(documento, excluirIdUsuario = null) {
    if (!documento || !String(documento).trim()) return null;
    const docLimpio = String(documento).trim();
    if (excluirIdUsuario) {
      const [rows] = await pool.query(
        'SELECT id_usuario, nombre, documento FROM usuarios WHERE documento = ? AND id_usuario != ?',
        [docLimpio, excluirIdUsuario]
      );
      return rows[0] || null;
    }
    const [rows] = await pool.query(
      'SELECT id_usuario, nombre, documento FROM usuarios WHERE documento = ?',
      [docLimpio]
    );
    return rows[0] || null;
  }

  static async crearCliente({ nombre, tipo_documento, documento, correo, contrasenaHash, direccion }) {
    const docVal = documento && String(documento).trim() ? String(documento).trim() : null;
    const tipoVal = ['CC', 'CE', 'NIT', 'Pasaporte'].includes(tipo_documento) ? tipo_documento : 'CC';
    // Rol por defecto: 2 (Cliente)
    const [result] = await pool.query(
      `INSERT INTO usuarios (nombre, tipo_documento, documento, correo, contrasena, direccion, puntos_fidelizacion, id_rol) 
       VALUES (?, ?, ?, ?, ?, ?, 0, 2)`,
      [nombre, tipoVal, docVal, correo, contrasenaHash, direccion]
    );
    return result.insertId;
  }
}

module.exports = UsuarioModel;
