# Croquis de Territorios 2026

Pagina web para generar, pintar, editar y descargar croquis de territorios.

Creada por Bryan Levi.

## Uso

Abre `index.html` o publica el repositorio con GitHub Pages. La pagina principal redirige al generador ubicado en `outputs/croquis_territorios.html`.

## Rios y arroyos

Los rios se marcan en azul, en pantalla y en el PDF, de dos maneras:

- **Automatico**: se traen de OpenStreetMap junto con las calles. En esta zona OSM solo tiene tres rios, asi que aparecen solos en Ixhuatlan del Cafe, Ixcatla, Pizarrostla y Tomatlan.
- **A mano**: con el boton de ondas (`Dibujar rio`). Toca puntos siguiendo el cauce y presiona guardar. Sirve para los arroyos que se ven en el mapa de Google pero no estan en OSM.

La flecha de deshacer quita el ultimo punto del trazo, `Escape` cancela el lapiz y el bote de basura borra los rios del territorio actual mientras el lapiz este encendido. Cada rio queda guardado por territorio y entra en el respaldo.

## Respaldar colores y textos

Los colores, textos y territorios agregados se guardan en el navegador. Para moverlos a otra computadora o a GitHub Pages, usa:

- `Exportar respaldo`: descarga un archivo `.json` con el trabajo guardado.
- `Importar respaldo`: carga ese archivo `.json` para recuperar colores, textos, recuadros y territorios agregados.

## Token de GitHub

`Guardar GitHub` y `Cargar GitHub` piden un token para escribir en `data/croquis-sync.json`.

- El token se guarda solo en `sessionStorage`: se borra al cerrar la pestana. Hay que pegarlo de nuevo en cada sesion.
- Usa un token detallado (fine-grained) en `Settings` > `Developer settings` > `Personal access tokens` > `Fine-grained tokens`, limitado **solo** al repositorio `Territorios`, con permiso `Contents: read and write` y con fecha de expiracion.
- No uses un token clasico con permiso `repo`: ese da acceso a todos tus repositorios.
- Si alguna vez pegaste un token en una computadora prestada, revocalo en GitHub y genera otro.

## Publicar en GitHub Pages

1. Sube este repositorio a GitHub.
2. En GitHub entra a `Settings` > `Pages`.
3. En `Build and deployment`, elige `Deploy from a branch`.
4. Selecciona la rama `main` y la carpeta `/root`.
5. Guarda los cambios y espera a que GitHub genere el enlace.
