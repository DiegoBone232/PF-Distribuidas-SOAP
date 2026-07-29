const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8000;
const WSDL_PATH = path.join(__dirname, 'productos.wsdl');

app.use(express.text({ type: ['text/xml', 'application/xml', 'application/soap+xml'] }));

const productos = [];

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

function encontrarProducto(codigo) {
  return productos.find((producto) => producto.codigo === codigo.trim());
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

function ejecutarOperacion(operacion, valores) {
  switch (operacion) {
    case 'RegistrarProducto': {
      const errores = validarProductoBase(valores);
      if (errores.length > 0) {
        return { fault: errores.join(' ') };
      }

      const codigo = valores.codigo.trim();
      if (encontrarProducto(codigo)) {
        return { fault: 'El código del producto ya existe.' };
      }

      productos.push({
        codigo,
        nombre: valores.nombre.trim(),
        categoria: valores.categoria.trim(),
        precio: Number(valores.precio),
        cantidad: Number(valores.cantidad),
      });
      return { success: '<mensaje>Producto registrado correctamente.</mensaje>' };
    }

    case 'ConsultarProducto': {
      const errorCodigo = validarCodigo(valores.codigo);
      if (errorCodigo) return { fault: errorCodigo };

      const producto = encontrarProducto(valores.codigo);
      if (!producto) return { fault: 'El producto no existe.' };

      return {
        success: `<codigo>${escaparXml(producto.codigo)}</codigo><nombre>${escaparXml(producto.nombre)}</nombre><categoria>${escaparXml(producto.categoria)}</categoria><precio>${escaparXml(producto.precio)}</precio><cantidad>${escaparXml(producto.cantidad)}</cantidad>`,
      };
    }

    case 'ListarProductos': {
      const contenido = productos.map((producto) => `<producto><codigo>${escaparXml(producto.codigo)}</codigo><nombre>${escaparXml(producto.nombre)}</nombre><categoria>${escaparXml(producto.categoria)}</categoria><precio>${escaparXml(producto.precio)}</precio><cantidad>${escaparXml(producto.cantidad)}</cantidad></producto>`).join('');
      return { success: contenido };
    }

    case 'ActualizarStock': {
      const errorCodigo = validarCodigo(valores.codigo);
      if (errorCodigo) return { fault: errorCodigo };

      const producto = encontrarProducto(valores.codigo);
      if (!producto) return { fault: 'El producto no existe.' };
      if (!esEnteroNoNegativo(valores.nuevaCantidad)) {
        return { fault: 'La cantidad debe ser un número entero igual o mayor que cero.' };
      }

      producto.cantidad = Number(valores.nuevaCantidad);
      return { success: '<mensaje>Stock actualizado correctamente.</mensaje>' };
    }

    case 'CalcularValorInventario': {
      const errorCodigo = validarCodigo(valores.codigo);
      if (errorCodigo) return { fault: errorCodigo };

      const producto = encontrarProducto(valores.codigo);
      if (!producto) return { fault: 'El producto no existe.' };

      return { success: `<valorInventario>${escaparXml(producto.precio * producto.cantidad)}</valorInventario>` };
    }

    case 'EliminarProducto': {
      const errorCodigo = validarCodigo(valores.codigo);
      if (errorCodigo) return { fault: errorCodigo };

      const indice = productos.findIndex((producto) => producto.codigo === valores.codigo.trim());
      if (indice === -1) return { fault: 'El producto no existe.' };

      productos.splice(indice, 1);
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

app.post('/productos', (req, res) => {
  let operacion = 'Error';
  try {
    const solicitud = parsearSolicitudSoap(req.body || '');
    operacion = solicitud.operacion;
    const resultado = ejecutarOperacion(operacion, solicitud.valores);

    if (resultado.fault) {
      return res.status(200).type('application/xml').send(construirRespuestaError(operacion, resultado.fault));
    }

    return res.status(200).type('application/xml').send(construirEnvelope(`<tns:${operacion}Response>${resultado.success}</tns:${operacion}Response>`));
  } catch (error) {
    return res.status(200).type('application/xml').send(construirRespuestaError(operacion, error.message));
  }
});

app.listen(PORT, () => {
  console.log(`Servidor SOAP escuchando en http://localhost:${PORT}`);
  console.log('Servicio SOAP expuesto en /productos');
});
