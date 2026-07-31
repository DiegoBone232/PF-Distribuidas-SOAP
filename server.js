const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 8000;
const WSDL_PATH = path.join(__dirname, 'productos.wsdl');
const DB_PATH = path.join(__dirname, 'productos.db');

app.use(cors());
app.use(express.text({ type: ['text/xml', 'application/xml', 'application/soap+xml'] }));

const db = new sqlite3.Database(DB_PATH, (error) => {
  if (error) {
    console.log('--- ERROR DB ---');
    console.log(error.message);
  } else {
    console.log(`Conectado a SQLite en ${DB_PATH}`);
  }
});

// Promisified helpers for sqlite3 (db.get, db.all, db.run)
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

function runDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) {
        reject(error);
      } else {
        resolve(this);
      }
    });
  });
}

function getDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
      } else {
        resolve(row);
      }
    });
  });
}

function allDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
      } else {
        resolve(rows);
      }
    });
  });
}

async function inicializarBaseDeDatos() {
  await runDb(`
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

function escaparXml(valor) {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}


function validarCodigo(codigo) {
    if (!codigo || codigo.trim() === '') {
        throw new Error('El código del producto es obligatorio.');
    }
    return codigo.trim();
}

function construirRespuestaError(operacion, mensaje) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
        <soap:Fault>
            <faultcode>soap:Server</faultcode>
            <faultstring>${mensaje}</faultstring>
        </soap:Fault>
    </soap:Body>
</soap:Envelope>`;
}

function construirEnvelope(cuerpo) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://localhost:8000/productos/wsdl">
  <soap:Body>
    ${cuerpo}
  </soap:Body>
</soap:Envelope>`;
}

function construirFault(mensaje) {
  return construirEnvelope(`<soap:Fault><soap:Reason><soap:Text>${escaparXml(mensaje)}</soap:Text></soap:Reason></soap:Fault>`);
}

function validarProductoBase({ codigo, nombre, categoria, precio, cantidad }) {
  const errores = [];

  if (!codigo || codigo.trim() === '') {
    errores.push('El código del producto es obligatorio.');
  }

  if (!nombre || nombre.trim() === '') {
    errores.push('El nombre del producto es obligatorio.');
  }

  if (!categoria || categoria.trim() === '') {
    errores.push('La categoría del producto es obligatoria.');
  }

  if (precio === undefined || precio === null || Number(precio) <= 0) {
    errores.push('El precio debe ser mayor a cero.');
  }

  if (cantidad === undefined || cantidad === null || Number(cantidad) < 0) {
    errores.push('La cantidad no puede ser menor a cero.');
  }

  return errores;
}

function esEnteroNoNegativo(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0;
}

async function encontrarProducto(codigo) {
  const producto = await getDb('SELECT codigo, nombre, categoria, precio, cantidad FROM productos WHERE codigo = ?', [codigo.trim()]);
  return producto || null;
}

function parsearSolicitudSoap(xml) {
  const bodyMatch = xml.match(/<(?:soap|soapenv):Body[^>]*>([\s\S]*?)<\/(?:soap|soapenv):Body>/i);
  if (!bodyMatch) {
    throw new Error('Solicitud SOAP inválida.');
  }

  const contenido = bodyMatch[1];
  const elementoMatch = contenido.match(/<([A-Za-z0-9:_-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/i);
  if (!elementoMatch) {
    throw new Error('No se encontró la operación SOAP solicitada.');
  }

  const nombreElemento = elementoMatch[1];
  const innerXml = elementoMatch[2];
  const operacion = nombreElemento.replace(/^.*:/, '').replace(/Request$/, '');

  const valores = {};
  const regexCampos = /<([A-Za-z0-9:_-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
  let coincidencia;
  while ((coincidencia = regexCampos.exec(innerXml)) !== null) {
    const nombreCampo = coincidencia[1].replace(/^.*:/, '');
    valores[nombreCampo] = coincidencia[2].trim();
  }

  return { operacion, valores };
}

async function ejecutarOperacion(operacion, valores) {
  try {
    switch (operacion) {
      case 'RegistrarProducto': {
        const errores = validarProductoBase(valores);
        if (errores.length > 0) {
          throw new Error(errores.join(' '));
        }

        const codigo = valores.codigo.trim();
        const productoExistente = await dbGet('SELECT 1 FROM productos WHERE codigo = ?', [codigo]);
        if (productoExistente) {
          throw new Error('El código del producto ya existe.');
        }

        await dbRun(
          'INSERT INTO productos (codigo, nombre, categoria, precio, cantidad) VALUES (?, ?, ?, ?, ?)',
          [codigo, valores.nombre.trim(), valores.categoria.trim(), Number(valores.precio), Number(valores.cantidad)],
        );
        return { success: '<mensaje>Producto registrado correctamente.</mensaje>' };
      }

      case 'ConsultarProducto': {
        validarCodigo(valores.codigo);

        const producto = await dbGet('SELECT codigo, nombre, categoria, precio, cantidad FROM productos WHERE codigo = ?', [valores.codigo.trim()]);
        if (!producto) {
          return { success: `<mensaje>El producto no fue encontrado.</mensaje>` };
        }

        return {
          success: `<codigo>${escaparXml(producto.codigo)}</codigo><nombre>${escaparXml(producto.nombre)}</nombre><categoria>${escaparXml(producto.categoria)}</categoria><precio>${escaparXml(producto.precio)}</precio><cantidad>${escaparXml(producto.cantidad)}</cantidad><mensaje>Consulta realizada correctamente.</mensaje>`,
        };
      }

      case 'ListarProductos': {
        const productosDb = await dbAll('SELECT codigo, nombre, categoria, precio, cantidad FROM productos ORDER BY codigo');
        const contenido = productosDb.map((producto) => `<producto><codigo>${escaparXml(producto.codigo)}</codigo><nombre>${escaparXml(producto.nombre)}</nombre><categoria>${escaparXml(producto.categoria)}</categoria><precio>${escaparXml(producto.precio)}</precio><cantidad>${escaparXml(producto.cantidad)}</cantidad></producto>`).join('');
        return { success: contenido };
      }

      case 'ActualizarStock': {
        validarCodigo(valores.codigo);

        const producto = await dbGet('SELECT codigo, cantidad FROM productos WHERE codigo = ?', [valores.codigo.trim()]);
        if (!producto) throw new Error('El producto no existe.');
        if (!esEnteroNoNegativo(valores.nuevaCantidad)) {
          throw new Error('La cantidad debe ser un número entero igual o mayor que cero.');
        }

        await dbRun('UPDATE productos SET cantidad = ? WHERE codigo = ?', [Number(valores.nuevaCantidad), valores.codigo.trim()]);
        return { success: '<mensaje>Stock actualizado correctamente.</mensaje>' };
      }

      case 'CalcularValorInventario': {
        validarCodigo(valores.codigo);

        const producto = await dbGet('SELECT precio, cantidad FROM productos WHERE codigo = ?', [valores.codigo.trim()]);
        if (!producto) throw new Error('El producto no existe.');

        return { success: `<valorInventario>${escaparXml(producto.precio * producto.cantidad)}</valorInventario>` };
      }

      case 'EliminarProducto': {
        validarCodigo(valores.codigo);

        const productoExistente = await dbGet('SELECT 1 FROM productos WHERE codigo = ?', [valores.codigo.trim()]);
        if (!productoExistente) throw new Error('El producto no existe.');

        await dbRun('DELETE FROM productos WHERE codigo = ?', [valores.codigo.trim()]);
        return { success: '<mensaje>Producto eliminado correctamente.</mensaje>' };
      }

      default:
        throw new Error('Operación SOAP no soportada.');
    }
  } catch (err) {
    // Bubble errors up as { fault: ... } to be handled by caller
    return { fault: err.message || 'Error al ejecutar la operación.' };
  }
}

app.get('/productos', (req, res) => {
  if (req.query.wsdl !== undefined || req.query.WSDL !== undefined) {
    res.set('Content-Type', 'application/xml; charset=utf-8');
    return res.send(fs.readFileSync(WSDL_PATH, 'utf8'));
  }
  return res.status(404).send('Ruta no encontrada.');
});

app.post('/productos', async (req, res) => {
  console.log('--- XML recibido ---');
  console.log(req.body);

  let operacion = 'Error';

  try {
    const solicitud = parsearSolicitudSoap(req.body || '');
    operacion = solicitud.operacion;
    const resultado = await ejecutarOperacion(operacion, solicitud.valores);

    if (resultado.fault) {
      return res.status(500).type('application/xml').send(construirFault(resultado.fault));
    }

    return res.status(200).type('application/xml').send(construirEnvelope(`<tns:${operacion}Response>${resultado.success}</tns:${operacion}Response>`));
  } catch (error) {
    console.log('--- ERROR REAL ---');
    console.log(error.message);
    return res.status(200).type('application/xml').send(construirRespuestaError(operacion, error.message));
  }
});

inicializarBaseDeDatos()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor SOAP escuchando en http://localhost:${PORT}`);
      console.log('Servicio SOAP expuesto en /productos');
    });
  })
  .catch((error) => {
    console.log('--- ERROR INICIALIZANDO DB ---');
    console.log(error.message);
    process.exit(1);
  });
