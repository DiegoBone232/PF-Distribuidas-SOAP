const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const soap = require('soap');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 8000;
const WSDL_PATH = path.join(__dirname, 'productos.wsdl');
const DB_PATH = path.join(__dirname, 'productos.db');

app.use(cors());

const db = new sqlite3.Database(DB_PATH, (error) => {
  if (error) {
    console.log('--- ERROR DB ---');
    console.log(error.message);
  } else {
    console.log(`Conectado a SQLite en ${DB_PATH}`);
  }
});

// Promisified helpers para sqlite3 (db.get, db.all, db.run)
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function inicializarBaseDeDatos() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS productos (
      codigo TEXT PRIMARY KEY,
      nombre TEXT,
      categoria TEXT,
      precio REAL,
      cantidad INTEGER
    )
  `);
  console.log('Tabla productos lista en SQLite');
}

// --- Validaciones ---

function esTextoVacio(valor) {
  return typeof valor !== 'string' || valor.trim() === '';
}

function esNumeroPositivo(valor) {
  const numero = Number(valor);
  return valor !== undefined && valor !== null && String(valor).trim() !== '' && Number.isFinite(numero) && numero > 0;
}

function esEnteroNoNegativo(valor) {
  const numero = Number(valor);
  return valor !== undefined && valor !== null && String(valor).trim() !== '' && Number.isInteger(numero) && numero >= 0;
}

function validarProductoBase({ codigo, nombre, categoria, precio, cantidad }) {
  const errores = [];
  if (esTextoVacio(codigo)) errores.push('El código del producto es obligatorio.');
  if (esTextoVacio(nombre)) errores.push('El nombre del producto es obligatorio.');
  if (esTextoVacio(categoria)) errores.push('La categoría del producto es obligatoria.');
  if (!esNumeroPositivo(precio)) errores.push('El precio debe ser un número mayor que cero.');
  if (!esEnteroNoNegativo(cantidad)) errores.push('La cantidad debe ser un número entero igual o mayor que cero.');
  return errores;
}

function log(operacion, detalle) {
  console.log(`[SOAP] ${operacion}`, detalle !== undefined ? detalle : '');
}

// --- Implementación del servicio SOAP ---

const service = {
  ProductosService: {
    ProductosPort: {
      async RegistrarProducto(args) {
        log('RegistrarProducto - solicitud', args);
        const { codigo, nombre, categoria, precio, cantidad } = args || {};

        const errores = validarProductoBase({ codigo, nombre, categoria, precio, cantidad });
        if (errores.length > 0) {
          const respuesta = { estado: false, mensaje: errores.join(' ') };
          log('RegistrarProducto - error validación', respuesta);
          return respuesta;
        }

        const codigoLimpio = codigo.trim();
        const existente = await dbGet('SELECT 1 FROM productos WHERE codigo = ?', [codigoLimpio]);
        if (existente) {
          const respuesta = { estado: false, mensaje: `El producto con el código ${codigoLimpio} ya existe.` };
          log('RegistrarProducto - código duplicado', respuesta);
          return respuesta;
        }

        await dbRun(
          'INSERT INTO productos (codigo, nombre, categoria, precio, cantidad) VALUES (?, ?, ?, ?, ?)',
          [codigoLimpio, nombre.trim(), categoria.trim(), Number(precio), Number(cantidad)],
        );

        const respuesta = { estado: true, mensaje: 'Producto registrado correctamente.' };
        log('RegistrarProducto - OK', respuesta);
        return respuesta;
      },

      async ConsultarProducto(args) {
        log('ConsultarProducto - solicitud', args);
        const codigo = args && args.codigo;

        if (esTextoVacio(codigo)) {
          const respuesta = {
            estado: false, codigo: '', nombre: '', categoria: '', precio: 0, cantidad: 0,
            mensaje: 'El código del producto es obligatorio.',
          };
          log('ConsultarProducto - error validación', respuesta);
          return respuesta;
        }

        const producto = await dbGet(
          'SELECT codigo, nombre, categoria, precio, cantidad FROM productos WHERE codigo = ?',
          [codigo.trim()],
        );

        if (!producto) {
          const respuesta = {
            estado: false, codigo: codigo.trim(), nombre: '', categoria: '', precio: 0, cantidad: 0,
            mensaje: `El producto con el código ${codigo.trim()} no existe.`,
          };
          log('ConsultarProducto - no encontrado', respuesta);
          return respuesta;
        }

        const respuesta = {
          estado: true,
          codigo: producto.codigo,
          nombre: producto.nombre,
          categoria: producto.categoria,
          precio: producto.precio,
          cantidad: producto.cantidad,
          mensaje: 'Consulta realizada correctamente.',
        };
        log('ConsultarProducto - OK', respuesta);
        return respuesta;
      },

      async ListarProductos() {
        log('ListarProductos - solicitud');
        const productos = await dbAll('SELECT codigo, nombre, categoria, precio, cantidad FROM productos ORDER BY codigo');
        log('ListarProductos - OK', `${productos.length} producto(s)`);
        return { producto: productos };
      },

      async ActualizarStock(args) {
        log('ActualizarStock - solicitud', args);
        const { codigo, nuevaCantidad } = args || {};

        if (esTextoVacio(codigo)) {
          const respuesta = { estado: false, mensaje: 'El código del producto es obligatorio.', cantidadActualizada: 0 };
          log('ActualizarStock - error validación', respuesta);
          return respuesta;
        }

        const codigoLimpio = codigo.trim();
        const producto = await dbGet('SELECT codigo FROM productos WHERE codigo = ?', [codigoLimpio]);
        if (!producto) {
          const respuesta = { estado: false, mensaje: `El producto con el código ${codigoLimpio} no existe.`, cantidadActualizada: 0 };
          log('ActualizarStock - no encontrado', respuesta);
          return respuesta;
        }

        if (!esEnteroNoNegativo(nuevaCantidad)) {
          const respuesta = { estado: false, mensaje: 'La cantidad debe ser un número entero igual o mayor que cero.', cantidadActualizada: 0 };
          log('ActualizarStock - error validación', respuesta);
          return respuesta;
        }

        await dbRun('UPDATE productos SET cantidad = ? WHERE codigo = ?', [Number(nuevaCantidad), codigoLimpio]);

        const respuesta = { estado: true, mensaje: 'Stock actualizado correctamente.', cantidadActualizada: Number(nuevaCantidad) };
        log('ActualizarStock - OK', respuesta);
        return respuesta;
      },

      async CalcularValorInventario(args) {
        log('CalcularValorInventario - solicitud', args);
        const codigo = args && args.codigo;

        if (esTextoVacio(codigo)) {
          const respuesta = {
            estado: false, mensaje: 'El código del producto es obligatorio.',
            nombre: '', precio: 0, cantidad: 0, valorInventario: 0,
          };
          log('CalcularValorInventario - error validación', respuesta);
          return respuesta;
        }

        const codigoLimpio = codigo.trim();
        const producto = await dbGet('SELECT nombre, precio, cantidad FROM productos WHERE codigo = ?', [codigoLimpio]);
        if (!producto) {
          const respuesta = {
            estado: false, mensaje: `El producto con el código ${codigoLimpio} no existe.`,
            nombre: '', precio: 0, cantidad: 0, valorInventario: 0,
          };
          log('CalcularValorInventario - no encontrado', respuesta);
          return respuesta;
        }

        const respuesta = {
          estado: true,
          mensaje: 'Cálculo realizado correctamente.',
          nombre: producto.nombre,
          precio: producto.precio,
          cantidad: producto.cantidad,
          valorInventario: producto.precio * producto.cantidad,
        };
        log('CalcularValorInventario - OK', respuesta);
        return respuesta;
      },

      async EliminarProducto(args) {
        log('EliminarProducto - solicitud', args);
        const codigo = args && args.codigo;

        if (esTextoVacio(codigo)) {
          const respuesta = { estado: false, mensaje: 'El código del producto es obligatorio.' };
          log('EliminarProducto - error validación', respuesta);
          return respuesta;
        }

        const codigoLimpio = codigo.trim();
        const producto = await dbGet('SELECT 1 FROM productos WHERE codigo = ?', [codigoLimpio]);
        if (!producto) {
          const respuesta = { estado: false, mensaje: `El producto con el código ${codigoLimpio} no existe.` };
          log('EliminarProducto - no encontrado', respuesta);
          return respuesta;
        }

        await dbRun('DELETE FROM productos WHERE codigo = ?', [codigoLimpio]);

        const respuesta = { estado: true, mensaje: 'Producto eliminado correctamente.' };
        log('EliminarProducto - OK', respuesta);
        return respuesta;
      },
    },
  },
};

// --- Arranque del servidor ---
// Importante: soap.listen() detecta si el "server" que recibe es una app de
// Express (busca .route()/.use()). Si se le pasa un http.Server crudo en vez
// de la app, se apodera del evento 'request' del servidor y desregistra los
// listeners existentes, dejando /productos fuera del middleware cors() de
// Express (el navegador falla con "Failed to fetch" al hacer el preflight,
// aunque curl o Postman no lo noten porque no aplican CORS). Por eso aquí se
// pasa "app" directamente, para que quede registrado como una ruta más de
// Express y respete app.use(cors()).

const wsdlXml = fs.readFileSync(WSDL_PATH, 'utf8');

inicializarBaseDeDatos()
  .then(() => {
    soap.listen(app, '/productos', service, wsdlXml);
    app.listen(PORT, () => {
      console.log(`Servidor SOAP escuchando en http://localhost:${PORT}`);
      console.log(`WSDL disponible en http://localhost:${PORT}/productos?wsdl`);
    });
  })
  .catch((error) => {
    console.log('--- ERROR INICIALIZANDO DB ---');
    console.log(error.message);
    process.exit(1);
  });
