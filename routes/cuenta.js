/**
 * Archivo: routes/cuenta.js
 * Propósito: Definir rutas para el historial de pedidos, edición de perfil y cuenta del cliente.
 */
const express = require('express');
const router = express.Router();
const CuentaController = require('../controllers/cuentaController');
const { requiereLogin } = require('../middlewares/auth');
const { requiereRol } = require('../middlewares/roles');

const esCliente = requiereRol(['Cliente']);

router.get('/pedidos', requiereLogin, esCliente, CuentaController.verHistorialPedidos);
router.post('/perfil', requiereLogin, esCliente, CuentaController.actualizarPerfil);
router.get('/pedidos/:id', requiereLogin, esCliente, CuentaController.verDetallePedido);

module.exports = router;
