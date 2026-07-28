using System.Net.Http.Headers;
using System.Text;
using System.Xml.Linq;

var wsdlUrl = "http://localhost:8000/productos?wsdl";
var soapEndpoint = "http://localhost:8000/productos";
var ns = "http://localhost:8000/productos/wsdl";

using var client = new HttpClient();
client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("text/xml"));

Console.WriteLine("=== Cliente SOAP en C# ===");
Console.WriteLine($"Conectando al WSDL: {wsdlUrl}");

try
{
    var wsdlResponse = await client.GetAsync(wsdlUrl);
    wsdlResponse.EnsureSuccessStatusCode();
    Console.WriteLine($"WSDL cargado correctamente. Código HTTP: {(int)wsdlResponse.StatusCode}");
}
catch (Exception ex)
{
    Console.WriteLine($"No fue posible contactar el servicio SOAP: {ex.Message}");
    Console.WriteLine("Asegúrate de ejecutar el servidor Node.js antes de correr este cliente.");
    return;
}

Console.WriteLine();
Console.WriteLine("1) Registro de dos productos distintos");
var producto1 = await InvokeSoapAsync(client, soapEndpoint, "RegistrarProducto", ns, new[]
{
    ("codigo", "P001"),
    ("nombre", "Monitor"),
    ("categoria", "Electrónica"),
    ("precio", "150"),
    ("cantidad", "10")
});
PrintResponse(producto1);

var producto2 = await InvokeSoapAsync(client, soapEndpoint, "RegistrarProducto", ns, new[]
{
    ("codigo", "P002"),
    ("nombre", "Teclado"),
    ("categoria", "Accesorios"),
    ("precio", "45"),
    ("cantidad", "25")
});
PrintResponse(producto2);

Console.WriteLine();
Console.WriteLine("2) Consulta de un producto existente");
var consultaExistente = await InvokeSoapAsync(client, soapEndpoint, "ConsultarProducto", ns, new[]
{
    ("codigo", "P001")
});
PrintResponse(consultaExistente);

Console.WriteLine();
Console.WriteLine("3) Consulta de un producto inexistente");
var consultaInexistente = await InvokeSoapAsync(client, soapEndpoint, "ConsultarProducto", ns, new[]
{
    ("codigo", "P999")
});
PrintResponse(consultaInexistente);

Console.WriteLine();
Console.WriteLine("4) Listado de todos los productos");
var listado = await InvokeSoapAsync(client, soapEndpoint, "ListarProductos", ns, Array.Empty<(string Name, string Value)>());
PrintResponse(listado);

Console.WriteLine();
Console.WriteLine("5) Actualización del stock de un producto");
var actualizarStock = await InvokeSoapAsync(client, soapEndpoint, "ActualizarStock", ns, new[]
{
    ("codigo", "P001"),
    ("nuevaCantidad", "15")
});
PrintResponse(actualizarStock);

Console.WriteLine();
Console.WriteLine("6) Cálculo del valor del inventario de un producto");
var valorInventario = await InvokeSoapAsync(client, soapEndpoint, "CalcularValorInventario", ns, new[]
{
    ("codigo", "P001")
});
PrintResponse(valorInventario);

Console.WriteLine();
Console.WriteLine("7) Eliminación de un producto");
var eliminar = await InvokeSoapAsync(client, soapEndpoint, "EliminarProducto", ns, new[]
{
    ("codigo", "P002")
});
PrintResponse(eliminar);

Console.WriteLine();
Console.WriteLine("Flujo completado.");

static async Task<string> InvokeSoapAsync(HttpClient client, string endpoint, string operation, string ns, IEnumerable<(string Name, string Value)> values)
{
    var requestBody = BuildRequestBody(operation, ns, values);
    var envelope = $"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
                   $"<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\">\n" +
                   $"  <soap:Body>\n" +
                   $"    {requestBody}\n" +
                   $"  </soap:Body>\n" +
                   $"</soap:Envelope>";

    using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
    request.Headers.Add("SOAPAction", $"urn:{operation}");
    request.Content = new StringContent(envelope, Encoding.UTF8, "text/xml");

    using var response = await client.SendAsync(request);
    var content = await response.Content.ReadAsStringAsync();
    //response.EnsureSuccessStatusCode();
    string result = await response.Content.ReadAsStringAsync();
if (!response.IsSuccessStatusCode)
{
    Console.WriteLine($"[Aviso] El servidor devolvió un error (Código {(int)response.StatusCode}).");
}
return result;
    return content;
}

static string BuildRequestBody(string operation, string ns, IEnumerable<(string Name, string Value)> values)
{
    var fields = values.Select(v => $"<{v.Name}>{EscapeXml(v.Value)}</{v.Name}>");
    var innerXml = string.Join("", fields);

    if (operation == "ListarProductos")
    {
        return $"<{operation} xmlns=\"{ns}\" />";
    }

    return $"<{operation} xmlns=\"{ns}\">{innerXml}</{operation}>";
}

static string EscapeXml(string input) => string.IsNullOrEmpty(input) ? string.Empty : new XText(input).ToString();

static void PrintResponse(string xml)
{
    Console.WriteLine("--------------------------------------------------");
    try
    {
        var document = XDocument.Parse(xml);
        var body = document.Descendants().FirstOrDefault(e => e.Name.LocalName == "Body");
        var responseElement = body?.Elements().FirstOrDefault();

        if (responseElement is null)
        {
            Console.WriteLine(xml);
            return;
        }

        Console.WriteLine($"[Respuesta] {responseElement.Name.LocalName}");

        if (responseElement.Name.LocalName.Contains("Fault"))
        {
            var text = responseElement.Descendants().FirstOrDefault(e => e.Name.LocalName == "Text")?.Value;
            Console.WriteLine($"Error: {text ?? "Sin detalle"}");
            return;
        }

        foreach (var child in responseElement.Elements())
        {
            if (child.HasElements)
            {
                Console.WriteLine($"{child.Name.LocalName}:");
                foreach (var subChild in child.Elements())
                {
                    Console.WriteLine($"  - {subChild.Name.LocalName}: {subChild.Value}");
                }
            }
            else
            {
                Console.WriteLine($"{child.Name.LocalName}: {child.Value}");
            }
        }

        if (!responseElement.Elements().Any())
        {
            Console.WriteLine(responseElement.Value);
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"No fue posible interpretar la respuesta XML: {ex.Message}");
        Console.WriteLine(xml);
    }
}
