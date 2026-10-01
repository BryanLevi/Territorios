# Croquis de Territorios 2026

Pagina web para generar, pintar, editar y descargar croquis de territorios.

Creada por Bryan Levi.

## Uso

Abre `index.html` o publica el repositorio con GitHub Pages. La pagina principal redirige al generador ubicado en `outputs/croquis_territorios.html`.

## Congregaciones

En Inicio, junto al selector de congregacion, usa `Agregar`, `Renombrar` o `Eliminar`. Las acciones se abren en un formulario dentro de la pagina. Una nueva congregacion empieza sin territorios y queda seleccionada para abrir el editor.

Renombrar conserva la identidad de la congregacion y sus dibujos. Eliminar requiere escribir su nombre y deja seleccionada otra congregacion; no se permite eliminar la ultima. Los cambios de nombre y las eliminaciones se incluyen en el registro compartido y en los respaldos.

La guia de herramientas esta organizada en cuatro secciones desplegables. El inicio, los formularios y los botones comparten el mismo estilo del editor.

Las pruebas de congregaciones se ejecutan con `node --test tests/congregaciones.test.cjs`.

## Estilo visual

Inicio, formularios y controles del editor comparten una tematica azul marino y cobalto, superficies claras y botones redondeados. Al entrar a Inicio, el contenido aparece con una transicion suave. El mapa ilustrado, su marcador, las burbujas y la flecha se animan automaticamente mientras Inicio esta abierto, con ciclos al doble de velocidad. Al volver a Inicio, las animaciones comienzan de nuevo sin controles de reproduccion. La opcion de reducir movimiento del dispositivo desactiva estas animaciones. Las burbujas no interceptan clics y el contenido permanece legible e interactivo. El credito «Creado por Bryan Levi» aparece junto al nombre de la aplicacion. Los avisos del mapa usan un recuadro azul claro con acento turquesa; los errores conservan su color rojo. El estilo se basa en las recomendaciones de [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), adaptadas al generador y a sus controles nativos.

Los estilos visuales se aplican solo en pantalla. El color elegido para pintar, los dibujos guardados, el punto de ubicacion y el contenido de los PDF conservan sus colores.

## Recuadro del territorio

Junto a `Recuadro`, pulsa `Mover` y arrastra el control azul del centro para cambiar su posición conservando el tamaño. Se guarda al soltar y `Listo` termina la edición. También admite las flechas del teclado (Mayús para avanzar más), `Escape` y `Deshacer`. La posición se conserva por territorio y congregación al recargar, compartir y recuperar respaldos, y el PDF usa ese nuevo encuadre. El botón de restablecer devuelve su posición y tamaño originales. Los dibujos conservan sus coordenadas del mapa.

## Calles con nombre y referencias

Toca una calle blanca, carretera o río dibujado para seleccionarlo, incluso sobre una zona pintada. Arrastra sus puntos blancos para moverlos, toca un punto pequeño para agregar un vértice y usa doble clic en un vértice para quitarlo (el trazo conserva al menos dos puntos). `Borrar` o `Supr` eliminan únicamente el trazo seleccionado; `Deshacer` lo recupera. Texto e iconos siguen teniendo su propia selección.

`Renombrar` permite editar el nombre completo, sus paréntesis y la descripción final del selector de localidad. En el campo de descripción, `auto` restaura el conteo de subterritorios y dejarlo vacío oculta el sufijo. Esta descripción no cambia las divisiones ni los dibujos guardados.

La selección de territorios del PDF usa texto de 11 px y filas compactas; las casillas pequeñas conservan su área táctil. Las pruebas se ejecutan con `node --test tests/*.test.cjs`.

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

## Mapa sin conexion

En Inicio, selecciona la congregacion y abre el editor. Alli pulsa `Mapa sin conexion` para abrir su panel independiente y `Descargar congregacion` mientras tengas internet. Se guardan las calles y referencias de **todos** sus territorios, ademas de los archivos necesarios para abrir la pagina. La descarga muestra el avance y se puede cancelar o reanudar; `Quitar descarga` borra solo los datos del mapa de esa congregacion. Los colores, textos y trazos se conservan en el almacenamiento local habitual. El selector `Mapa descargado` permite verlo tambien con internet y se activa automaticamente al perder la conexion. Cada congregacion muestra por separado su estado de descarga.

Este mapa usa datos vectoriales abiertos de OpenStreetMap, no teselas de Google, CARTO ni del servidor de teselas de OpenStreetMap. Muestra calles, rios y referencias disponibles en esos datos; el aspecto y detalle pueden diferir del mapa en linea. Los PDF requieren volver a una vista con conexion. `Mi ubicacion` puede mostrar el punto sin internet cuando el dispositivo y el navegador entregan una lectura reciente con permiso; la posicion no se guarda en la descarga. Para conservar la descarga, abre siempre la misma direccion HTTPS en el mismo navegador y evita borrar sus datos del sitio. Los limites de almacenamiento del navegador y la disponibilidad del servidor de calles pueden interrumpir una descarga; al reintentar se conservan los territorios ya guardados.

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
