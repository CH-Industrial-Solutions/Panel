# CH Industrial Solutions · Panel de trabajo

Panel de accesos directos en HTML, CSS y JavaScript puro. Sin servidor, sin Python, sin instalación.

## Uso

1. Abre `index.html` en **Chrome** o **Edge** (o usa la versión publicada en GitHub Pages).
2. Pulsa **Elegir carpeta** y selecciona tu carpeta de trabajo.
3. La app crea `Accesos_Panel.xlsx` con todos los accesos, `notas.json` con las notas, y las carpetas `imagenes/` y `Correos importantes/` dentro de esa carpeta.

Todo se guarda en la carpeta elegida. No se usa la nube ni almacenamiento externo.
La carpeta queda recordada en el navegador (IndexedDB); si el navegador pide permiso de nuevo, pulsa **Reconectar**.

## Archivos

| Archivo | Función |
|---|---|
| `index.html` | Estructura |
| `styles.css` | Identidad visual (negro con gloss transparente) |
| `app.js` | Motor de operaciones |
| `config.json` | Secciones, máximos y accesos iniciales |

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub y sube estos archivos.
2. En el repositorio: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
3. La página queda disponible en `https://TU-USUARIO.github.io/NOMBRE-REPO/`.

## Notas

- El Excel usa [SheetJS](https://sheetjs.com) desde CDN; se necesita conexión a internet para cargar la librería.
- Los correos arrastrados desde Outlook se guardan tal cual llegan (`.msg` o `.eml`). Si solo llega el texto del correo, se guarda como `.eml`.
