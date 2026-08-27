"""
Cliente SOAP en Python usando la librería zeep.

Consume el servicio ProductosService expuesto en:
    http://localhost:8000/productos?wsdl
"""

from zeep import Client
from zeep.exceptions import Fault
from zeep.plugins import HistoryPlugin

WSDL_URL = "http://localhost:8000/productos?wsdl"


def main():
    history = HistoryPlugin()
    client = Client(WSDL_URL, plugins=[history])

    print("=" * 60)
    print("1. REGISTRO DE DOS PRODUCTOS DISTINTOS")
    print("=" * 60)
    try:
        # "sede" es un campo opcional del WSDL: si no se envía, el servidor lo
        # completa con 'centro' por defecto. Aquí se envía explícitamente en
        # el producto 1 para probar el campo; el producto 2 se deja sin sede
        # a propósito, para confirmar que el cliente sigue funcionando igual
        # aunque no lo mande.
        resp1 = client.service.RegistrarProducto(
            codigo="P001",
            nombre="Laptop Lenovo",
            categoria="Electrónica",
            precio=750.50,
            cantidad=10,
            sede="norte",
        )
        print(f"Producto 1 registrado -> {resp1}")

        resp2 = client.service.RegistrarProducto(
            codigo="P002",
            nombre="Mouse Inalámbrico",
            categoria="Accesorios",
            precio=15.99,
            cantidad=50,
        )
        print(f"Producto 2 registrado -> {resp2}")
    except Fault as e:
        print(f"Error SOAP al registrar productos: {e}")
    except Exception as e:
        print(f"Error inesperado al registrar productos: {e}")

    print("\n" + "=" * 60)
    print("2. BÚSQUEDA DE UN PRODUCTO EXISTENTE")
    print("=" * 60)
    try:
        resultado = client.service.ConsultarProducto(codigo="P001")
        print(f"Producto encontrado -> {resultado}")
        if getattr(resultado, "sede", None):
            print(f"  Sede: {resultado.sede}")
    except Fault as e:
        print(f"Error SOAP al consultar producto existente: {e}")
    except Exception as e:
        print(f"Error inesperado: {e}")

    print("\n" + "=" * 60)
    print("3. BÚSQUEDA DE UN PRODUCTO INEXISTENTE")
    print("=" * 60)
    try:
        resultado = client.service.ConsultarProducto(codigo="P999")
        print(f"Resultado -> {resultado}")
    except Fault as e:
        print(f"Error SOAP esperado (producto no existe): {e}")
    except Exception as e:
        print(f"Error inesperado: {e}")

    print("\n" + "=" * 60)
    print("4. LISTADO DE TODOS LOS PRODUCTOS")
    print("=" * 60)
    try:
        lista = client.service.ListarProductos("")
        print(f"Lista de productos -> {lista}")
        for producto in lista:
            if getattr(producto, "sede", None):
                print(f"  {producto.codigo} está en la sede: {producto.sede}")
    except Fault as e:
        print(f"Error SOAP al listar productos: {e}")
    except Exception as e:
        print(f"Error inesperado: {e}")

    print("\n" + "=" * 60)
    print("5. ACTUALIZACIÓN DE STOCK")
    print("=" * 60)
    try:
        resp = client.service.ActualizarStock(codigo="P001", nuevaCantidad=25)
        print(f"Stock actualizado -> {resp}")
    except Fault as e:
        print(f"Error SOAP al actualizar stock: {e}")
    except Exception as e:
        print(f"Error inesperado: {e}")

    print("\n" + "=" * 60)
    print("6. CÁLCULO DEL VALOR DE INVENTARIO")
    print("=" * 60)
    try:
        valor = client.service.CalcularValorInventario(codigo="P001")
        print(f"Valor de inventario -> {valor}")
    except Fault as e:
        print(f"Error SOAP al calcular valor de inventario: {e}")
    except Exception as e:
        print(f"Error inesperado: {e}")

    print("\n" + "=" * 60)
    print("7. ELIMINACIÓN DE UN PRODUCTO")
    print("=" * 60)
    try:
        resp = client.service.EliminarProducto(codigo="P002")
        print(f"Producto eliminado -> {resp}")
    except Fault as e:
        print(f"Error SOAP al eliminar producto: {e}")
    except Exception as e:
        print(f"Error inesperado: {e}")


if __name__ == "__main__":
    main()
    