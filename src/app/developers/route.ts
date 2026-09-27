/**
 * The API reference for the ERP's developers: the live OpenAPI document,
 * rendered by Scalar. Public, like the specification it reads; the written
 * guide is API.md in the repository.
 */
export const dynamic = "force-static";

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HRMS API reference</title>
    <meta name="description" content="The HR module's two-way API for the client's ERP." />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <script id="api-reference" data-url="/api/v1/openapi.json"></script>
    <script>
      document.getElementById("api-reference").dataset.configuration = JSON.stringify({
        theme: "default",
        layout: "modern",
        hideDownloadButton: false,
        defaultHttpClient: { targetKey: "shell", clientKey: "curl" },
      });
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1"></script>
  </body>
</html>`;

export function GET(): Response {
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
