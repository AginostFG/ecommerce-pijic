/**
 * Archivo: controllers/cuentaController.js
 * Propósito: Controlar la visualización del historial de pedidos, edición de perfil/documento (M5), puntos y movimientos del cliente.
 */
const CuentaModel = require('../models/cuentaModel');
const { configPuntos } = require('../config/puntos');

class CuentaController {
  static async verHistorialPedidos(req, res) {
    try {
      const id_cliente = req.session.usuario.id_usuario;
      const [cliente, pedidos, movimientos] = await Promise.all([
        CuentaModel.obtenerDatosCliente(id_cliente),
        CuentaModel.obtenerHistorialPedidos(id_cliente),
        CuentaModel.obtenerMovimientosPuntos(id_cliente)
      ]);

      const equivalenciaPesos = (Number(cliente.puntos_fidelizacion) || 0) * configPuntos.valorPuntoCop;

      res.render('cliente/historial_pedidos', {
        titulo: 'Mi Cuenta y Puntos - PIJIC Menswear',
        cliente,
        pedidos,
        movimientos,
        equivalenciaPesos
      });
    } catch (error) {
      console.error('Error al ver historial de pedidos:', error);
      res.status(500).render('errors/500', { titulo: 'Error del servidor' });
    }
  }

  static async actualizarPerfil(req, res) {
    try {
      const id_cliente = req.session.usuario.id_usuario;
      const { nombre, tipo_documento, documento, direccion } = req.body;

      if (!nombre || !nombre.trim()) {
        req.session.mensajeError = 'El nombre completo es obligatorio.';
        return res.redirect('/cuenta/pedidos');
      }

      const docLimpio = documento ? documento.trim() : '';
      if (docLimpio && !/^[A-Za-z0-9\-]{5,20}$/.test(docLimpio)) {
        req.session.mensajeError = 'El documento debe tener entre 5 y 20 caracteres alfanuméricos o guiones.';
        return res.redirect('/cuenta/pedidos');
      }

      await CuentaModel.actualizarPerfilCliente(id_cliente, {
        nombre: nombre.trim(),
        tipo_documento,
        documento: docLimpio || null,
        direccion: direccion ? direccion.trim() : ''
      });

      req.session.usuario.nombre = nombre.trim();
      req.session.usuario.direccion = direccion ? direccion.trim() : '';

      req.session.mensajeExito = 'Datos de tu perfil actualizados correctamente.';
      return res.redirect('/cuenta/pedidos');
    } catch (error) {
      req.session.mensajeError = error.message || 'No se pudo actualizar tu perfil.';
      return res.redirect('/cuenta/pedidos');
    }
  }

  static async verDetallePedido(req, res) {
    try {
      const id_cliente = req.session.usuario.id_usuario;
      const { id } = req.params;

      const pedido = await CuentaModel.obtenerDetallePedidoPorId(id, id_cliente);
      if (!pedido) {
        req.session.mensajeError = 'El pedido solicitado no existe o no te pertenece.';
        return res.redirect('/cuenta/pedidos');
      }

      res.render('cliente/detalle_pedido', {
        titulo: `Detalle Pedido #${pedido.id_pedido} - PIJIC Menswear`,
        pedido
      });
    } catch (error) {
      console.error('Error al ver detalle de pedido:', error);
      res.status(500).render('errors/500', { titulo: 'Error del servidor' });
    }
  }
}

module.exports = CuentaController;
