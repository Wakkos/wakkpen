// Documento de la vista previa. Se carga en un iframe sandbox="allow-scripts" (origen opaco),
// así que el código del alumno no puede leer la sesión ni el localStorage de la app.

const bridge = `
<script>
(function () {
  // El iframe tiene origen opaco: localStorage/sessionStorage lanzarían error. Se sustituyen por almacenes en memoria.
  function memoryStorage() {
    var data = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; },
      clear: function () { data = {}; },
      key: function (i) { return Object.keys(data)[i] || null; },
      get length() { return Object.keys(data).length; }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try { window[name].length; } catch (e) {
      try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch (e2) {}
    }
  });
  function send(level, args) {
    try {
      var text = Array.prototype.map.call(args, function (a) {
        if (a instanceof Error) return a.name + ': ' + a.message;
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
        return String(a);
      }).join(' ');
      parent.postMessage({ source: 'wakkpen-preview', level: level, text: text }, '*');
    } catch (e) {}
  }
  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    var original = console[level];
    console[level] = function () { send(level, arguments); original.apply(console, arguments); };
  });
  window.addEventListener('error', function (e) {
    var start = window.__wakkpenJsStart || 0;
    var line = e.lineno && start && e.lineno >= start ? e.lineno - start + 1 : 0;
    send('error', [e.message + (line ? ' (JS, línea ' + line + ')' : '')]);
  });
  window.addEventListener('unhandledrejection', function (e) {
    send('error', ['Promesa rechazada: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)]);
  });
})();
<\/script>`

function escapeScriptEnd(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script')
}

export function buildPreviewDoc(html: string, css: string, js: string): string {
  const head = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${bridge}
<style>${css}</style>
</head>
<body>
${html}
`
  // Línea en la que empieza el JS del alumno, para que los errores apunten a su código.
  const jsStart = head.split('\n').length + 2
  return `${head}<script>window.__wakkpenJsStart = ${jsStart}<\/script>
<script>
${escapeScriptEnd(js)}
<\/script>
</body>
</html>`
}

export function buildExportDoc(html: string, title: string): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title.replace(/</g, '&lt;')}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
${html}
  <script src="script.js"></script>
</body>
</html>
`
}
