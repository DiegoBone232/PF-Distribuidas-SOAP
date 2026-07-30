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

function construirEnvelope(cuerpo) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://localhost:8000/productos/wsdl">
  <soap:Body>
    ${cuerpo}
  </soap:Body>
</soap:Envelope>`;
}

function construirRespuestaError(operacion, mensaje) {
  const nombreOperacion = operacion || 'Error';
  return construirEnvelope(
    `<tns:${nombreOperacion}Response><resultado>false[${escaparXml(mensaje)}]</resultado></tns:${nombreOperacion}Response>`,
  );
}

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

function validarCodigo(codigo) {
  return esTextoVacio(codigo) ? 'El código del producto es obligatorio.' : null;
}

function validarProductoBase({ codigo, nombre, categoria, precio, cantidad }) {
  const errores = [];
  const errorCodigo = validarCodigo(codigo);

  if (errorCodigo) {
    errores.push(errorCodigo);
  }
  if (esTextoVacio(nombre)) {
    errores.push('El nombre del producto es obligatorio.');
  }
  if (esTextoVacio(categoria)) {
    errores.push('La categoría del producto es obligatoria.');
  }
  if (!esNumeroPositivo(precio)) {
    errores.push('El precio debe ser un número mayor que cero.');
  }
  if (!esEnteroNoNegativo(cantidad)) {
    errores.push('La cantidad debe ser un número entero igual o mayor que cero.');
  }

  return errores;
}

async function encontrarProducto(codigo) {
  const producto = await getDb('SELECT codigo, nombre, categoria, precio, cantidad FROM productos WHERE codigo = ?', [codigo.trim()]);
  return producto || null;
}

function parsearSolicitudSoap(xml) {
  const bodyMatch = xml.match(/<[A-Za-z0-9-]+:Body[^>]*>([\s\S]*?)<\/[A-Za-z0-9-]+:Body>/i);
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
  switch (operacion) {
    case 'RegistrarProducto': {
      const errores = validarProductoBase(valores);
      if (errores.length > 0) {
        return { fault: errores.join(' ') };
      }

      const codigo = valores.codigo.trim();
      const productoExistente = await getDb('SELECT 1 FROM productos WHERE codigo = ?', [codigo]);
      if (productoExistente) {
        return { fault: 'El código del producto ya existe.' };
      }

      await runDb(
        'INSERT INTO productos (codigo, nombre, categoria, precio, cantidad) VALUES (?, ?, ?, ?, ?)',
        [codigo, valores.nombre.trim(), valores.categoria.trim(), Number(valores.precio), Number(valores.cantidad)],
      );
      return { success: '<mensaje>Producto registrado correctamente.</mensaje>' };
    }

    case 'ConsultarProducto': {
      const errorCodigo = validarCodigo(valores.codigo);
      if (errorCodigo) return { fault: errorCodigo };

      const producto = await encontrarProducto(valores.codigo);
      if (!producto) return { fault: 'El producto no existe.' };

      return {
        success: `<codigo>${escaparXml(producto.codigo)}</codigo><nombre>${escaparXml(producto.nombre)}</nombre><categoria>${escaparXml(producto.categoria)}</categoria><precio>${escaparXml(producto.precio)}</precio><cantidad>${escaparXml(producto.cantidad)}</cantidad>`,
      };
    }

    case 'ListarProductos': {
      const productosDb = await allDb('SELECT codigo, nombre, categoria, precio, cantidad FROM productos ORDER BY codigo');
      const contenido = productosDb.map((producto) => `<producto><codigo>${escaparXml(producto.codigo)}</codigo><nombre>${escaparXml(producto.nombre)}</nombre><categoria>${escaparXml(producto.categoria)}</categoria><precio>${escaparXml(producto.precio)}</precio><cantidad>${escaparXml(producto.cantidad)}</cantidad></producto>`).join('');
      return { success: contenido };
    }

    case 'ActualizarStock': {
      const errorCodigo = validarCodigo(valores.codigo);
      if (errorCodigo) return { fault: errorCodigo };

      const producto = await encontrarProducto(valores.codigo);
      if (!producto) return { fault: 'El producto no existe.' };
      if (!esEnteroNoNegativo(valores.nuevaCantidad)) {
        return { fault: 'La cantidad debe ser un número entero igual o mayor que cero.' };
      }

      await runDb('UPDATE productos SET cantidad = ? WHERE codigo = ?', [Number(valores.nuevaCantidad), valores.codigo.trim()]);
      return { success: '<mensaje>Stock actualizado correctamente.</mensaje>' };
    }

    case 'CalcularValorInventario': {
      const errorCodigo = validarCodigo(valores.codigo);
      if (errorCodigo) return { fault: errorCodigo };

      const producto = await encontrarProducto(valores.codigo);
      if (!producto) return { fault: 'El producto no existe.' };

      return { success: `<valorInventario>${escaparXml(producto.precio * producto.cantidad)}</valorInventario>` };
    }

    case 'EliminarProducto': {
      const errorCodigo = validarCodigo(valores.codigo);
      if (errorCodigo) return { fault: errorCodigo };

      const productoExistente = await getDb('SELECT 1 FROM productos WHERE codigo = ?', [valores.codigo.trim()]);
      if (!productoExistente) return { fault: 'El producto no existe.' };

      await runDb('DELETE FROM productos WHERE codigo = ?', [valores.codigo.trim()]);
      return { success: '<mensaje>Producto eliminado correctamente.</mensaje>' };
    }

    default:
      return { fault: 'Operación SOAP no soportada.' };
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
      return res.status(200).type('application/xml').send(construirRespuestaError(operacion, resultado.fault));
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
