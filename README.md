# Croquis de Territorios 2026

Pagina web para generar, pintar, editar y descargar croquis de territorios.

Creada por Bryan Levi.

## Uso

Abre `index.html` o publica el repositorio con GitHub Pages. La pagina principal redirige al generador ubicado en `outputs/croquis_territorios.html`.

## Calles con nombre y referencias

Se traen de OpenStreetMap con Overpass, **una sola vez por territorio**, y quedan guardadas en el navegador. Moverse o acercarse ya no vuelve a pedirlas, y al reabrir la pagina se usan las guardadas sin tocar la red.

Si el servidor esta saturado se reintenta hasta tres veces, alternando entre dos servidores y esperando cada vez mas. Un territorio ya cargado se sigue viendo aunque Overpass este caido.

## Rios y arroyos

Los rios se marcan en azul, en pantalla y en el PDF, de dos maneras:

- **Automatico**: se traen de OpenStreetMap junto con las calles. En esta zona OSM solo tiene tres rios, asi que aparecen solos en Ixhuatlan del Cafe, Ixcatla, Pizarrostla y Tomatlan.
- **A mano**: con el boton de ondas (`Dibujar rio`). Toca puntos siguiendo el cauce y presiona guardar. Sirve para los arroyos que se ven en el mapa de Google pero no estan en OSM.

La flecha de deshacer quita el ultimo punto del trazo, `Escape` cancela el lapiz y el bote de basura borra los rios del territorio actual mientras el lapiz este encendido. Cada rio queda guardado por territorio y entra en el respaldo.

## Respaldar colores y textos

Los colores, textos y territorios agregados se guardan en el navegador. Para moverlos a otra computadora o a GitHub Pages, usa:

- `Exportar respaldo`: descarga un archivo `.json` con el trabajo guardado.
- `Importar respaldo`: carga ese archivo `.json` para recuperar colores, textos, recuadros y territorios agregados.

## Mi ubicacion

`Mi ubicación` pide una lectura actual del dispositivo y muestra el punto azul con su circulo de precision. Una lectura reciente con margen de 99 metros se muestra como ubicacion aproximada mientras sigue actualizandose; no se exige llegar a 50 metros para verla. Cada clic vuelve a buscar la posicion, incluso si el seguimiento ya esta activo. La propuesta de abrir otro territorio requiere un margen de hasta 50 metros y conserva el centro en la posicion del dispositivo.

Al arrastrar el mapa se pausa el centrado automatico; vuelve a tocar `Mi ubicación` para regresar. Si llega una lectura durante el zoom de un territorio, la pagina centra la ultima lectura reciente al terminar esa transicion. `Detener` apaga el seguimiento y quita el punto. La posicion no se guarda ni entra en los respaldos.

El navegador necesita permiso de ubicacion y una pagina segura (HTTPS o localhost). El cerco azul muestra el margen de precision que devuelve el dispositivo. Las lecturas antiguas o con margen superior a 1000 metros no mueven el mapa. La pagina espera hasta 45 segundos si aun no pudo mostrar una posicion; una lectura aproximada ya visible no se borra al cumplir ese plazo. El estado aparece en el boton y su detalle se consulta al pasar el puntero; tambien se anuncia a lectores de pantalla, sin un texto persistente sobre la barra o el mapa. Durante el seguimiento conserva el ultimo punto estimado si la señal empeora. La precision disponible depende del dispositivo y de sus permisos de ubicacion.

Las pruebas de ubicacion se ejecutan con `node --test tests/ubicacion.test.cjs`.

## Token de GitHub

`Guardar GitHub` y `Cargar GitHub` piden un token para escribir en `data/croquis-sync.json`.

- El token se guarda solo mientras esta abierta la pestana: al cerrarla hay que pegarlo de nuevo.
- Usa un token detallado (fine-grained) en `Settings` > `Developer settings` > `Personal access tokens` > `Fine-grained tokens`, limitado **solo** al repositorio `Territorios`, con permiso `Contents: read and write`.
- No uses un token clasico con permiso `repo`: ese da acceso a todos tus repositorios.
- Si alguna vez pegaste un token en una computadora prestada, revocalo en GitHub y genera otro.

## Publicar en GitHub Pages

1. Sube este repositorio a GitHub.
2. En GitHub entra a `Settings` > `Pages`.
3. En `Build and deployment`, elige `Deploy from a branch`.
4. Selecciona la rama `main` y la carpeta `/root`.
5. Guarda los cambios y espera a que GitHub genere el enlace.
