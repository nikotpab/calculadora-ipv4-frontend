# Calculadora IPv4 - Frontend

Interfaz (HTML, CSS y JavaScript sin dependencias) de la calculadora web de direccionamiento IPv4 de Redes de Datos I, Universidad El Bosque, 2026-II.

El cálculo lo hace la API del backend (`calculadora-ipv4-backend`). La página llama a `POST /api/calcular` y `GET /api/casos-de-prueba` con rutas relativas al mismo origen, así que necesita que el frontend y la API se sirvan juntos: en producción lo hace Nginx; abrir `index.html` con doble clic (`file://`) no funciona.

**Cómo correrla en local**, con los dos repositorios clonados uno al lado del otro:

```bash
cd ../calculadora-ipv4-backend
source .venv/bin/activate
python scripts/servidor_local.py        # http://127.0.0.1:8080
```

El script sirve esta carpeta `app/` y la API desde el mismo puerto, igual que Nginx. Si el frontend está en otra ruta: `python scripts/servidor_local.py --frontend /ruta/a/app`.

```
app/
├── index.html        página única: entrada, casos de prueba y resultado
├── js/app.js         llama a la API y pinta el resultado, la nota o el error
├── css/styles.css    hoja de estilos
└── fuentes/          Ranade (.otf) e IBM Plex Mono (.woff2)
```

`js/app.js` no calcula nada: pinta las filas, la nota y la vista binaria tal como llegan del backend. Estados que maneja:

- **200**: tabla de resultados, nota (si la hay) y representación binaria (la fila "Red" se omite cuando la API la manda en `null`).
- **422**: mensaje de error bajo el campo indicado en `campo` (`entrada`, `direccion` o `mascara`), con `aria-invalid` en el input.
- **Otros errores** (400, 5xx, API caída): aviso en el panel de resultado.

Los casos de prueba se cargan de la API, así que la lista vive en un solo sitio (`calc/casos.py` del backend). "Copiar resultado" usa el portapapeles del navegador y, si la página se sirve por HTTP sin TLS, un método alternativo.

**Despliegue:** copiar el contenido de `app/` (incluida `js/`) a `/var/www/calculadora-ipv4`; ver `deploy/nginx/` en el backend.
