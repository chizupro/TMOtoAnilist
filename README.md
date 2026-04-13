# TMO → AniList Importer

Importa tus listas del backup de TuMangaOnline (TMO) a [AniList](https://anilist.co) de forma automática.

> **¿Por qué existe esto?** TMO cerró y muchos usuarios perdieron acceso a sus listas. Gracias a un backup comunitario se pudieron recuperar los datos como archivos HTML. Esta herramienta parsea esos HTMLs y los sube a tu cuenta de AniList automáticamente.

## ✨ Características

- **Sin instalación** — Solo abre `index.html` en tu navegador
- **Detección automática del estado** — Detecta si un archivo es "Siguiendo", "Completado", "Abandonado", etc. a partir del nombre del archivo o del título de la página HTML
- **Búsqueda inteligente** — Busca cada manga por su título original Y por el título en español, comparando contra todos los títulos alternativos y sinónimos de AniList
- **Múltiples listas a la vez** — Sube todos tus HTMLs de una vez
- **Respeta el rate limit** — Espera automáticamente si AniList limita las peticiones
- **Reporte CSV** — Descarga un reporte de qué se importó y qué no se encontró

## 🚀 Cómo usarlo

### 1. Obtener tu Client ID de AniList

1. Ve a [anilist.co/settings/developer](https://anilist.co/settings/developer)
2. Haz clic en **"Create new client"**
3. Ponle cualquier nombre (ej: `TMO Importer`)
4. En **Redirect URL** pon: `https://anilist.co/api/v2/oauth/pin`
5. Guarda y copia el **Client ID**

### 2. Ejecutar el importador

1. Descarga o clona este repositorio
2. Abre `index.html` en tu navegador (no necesita servidor)
3. Pega tu Client ID y autoriza la app en AniList
4. Sube tus archivos HTML del backup de TMO
5. Revisa la vista previa y haz clic en **Importar**

### 3. Formato del HTML de TMO

El importador espera el formato estándar del backup de TMO:

```html
<div class="topnav">Siguiendo</div>
<table>
  <tbody>
    <tr>
      <td><img src="..." alt="Título Original en Japonés/Coreano"></td>
      <td><a href="https://zonatmo...">Título en Español</a></td>
    </tr>
    ...
  </tbody>
</table>
```

Los archivos típicos son:
- `Siguiendo.html` → Estado: **Leyendo** (CURRENT)
- `Plan_a_leer.html` → Estado: **Plan a leer** (PLANNING)
- `Completado.html` → Estado: **Completado** (COMPLETED)
- `Abandonado.html` → Estado: **Abandonado** (DROPPED)
- `Pausado.html` → Estado: **Pausado** (PAUSED)

Puedes cambiar el mapeo manualmente en la interfaz antes de importar.

## 📁 Estructura del proyecto

```
tmo-anilist-importer/
├── index.html     # Interfaz principal
├── style.css      # Estilos
├── importer.js    # Lógica de parseo e importación
└── README.md
```

## 🔒 Privacidad

- Todo el procesamiento ocurre **en tu navegador** — ningún dato pasa por servidores externos (salvo las peticiones directas a la API de AniList)
- El token de AniList se guarda solo en memoria, no en `localStorage` ni cookies
- No se recopila ningún dato de uso

## ⚠️ Limitaciones conocidas

- **Mangas no encontrados**: AniList puede no tener todos los títulos que existían en TMO, especialmente traducciones al español muy específicas o títulos de publicación reciente. El reporte CSV indica cuáles no se encontraron.
- **Rate limit**: AniList permite ~90 peticiones por minuto. El importador espera automáticamente si se alcanza el límite, así que listas muy grandes pueden tardar varios minutos.
- **Capítulo leído**: El backup HTML de TMO no incluye el número de capítulo en el que ibas. Solo se importa el estado (Leyendo, Completado, etc.).

## 🤝 Contribuir

¡Los PRs son bienvenidos! Si tienes un formato de backup diferente o encuentras mangas que no se detectan correctamente, abre un issue.

## 📄 Licencia

MIT — Úsalo, modifícalo, compártelo.
