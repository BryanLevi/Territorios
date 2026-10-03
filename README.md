# Croquis de Territorios 2026

Pagina web para generar, pintar, editar y descargar croquis de territorios.

Creada por Bryan Levi.

## Uso

La dirección publicada es `https://bryanlevi.github.io/Territorios/croquis-territorios-jw/`. La página principal abre esta dirección; las rutas anteriores `coquis-territorios-jw/` y `croquis-territorio-jw/` redirigen a ella conservando parámetros y fragmento, y el enlace de `outputs/croquis_territorios.html` sigue funcionando. La publicación genera la ruta nueva desde ese mismo archivo, conservando las bibliotecas, la sincronización y los datos existentes. Para prepararla en un servidor local, ejecuta `node tools/prepare-pages.cjs`; también puedes abrir directamente `outputs/croquis_territorios.html`.

GitHub Pages se publica mediante GitHub Actions (`.github/workflows/pages.yml`), que prepara la ruta antes de subir el sitio. Mantén la fuente de Pages en `GitHub Actions` para conservar esa dirección en cada publicación.

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

`Referencias` reconoce tanto los iconos que colocaste como los símbolos que la página dibuja a partir de OpenStreetMap, incluidos los descargados para uso sin conexión. Puedes elegir qué tipos incluir en la leyenda del PDF y editar sus nombres. La lista se actualiza cuando llegan más referencias sin perder los cambios que estás escribiendo; las referencias retiradas o sustituidas por un icono propio se excluyen. La leyenda del PDF incluye las referencias automáticas que se dibujan dentro de su croquis.

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

## Contraseña por congregación

En Inicio, selecciona una congregación y usa `Contraseña` para crear una clave de exactamente 4 dígitos, solo números (puede empezar por cero). Cada campo tiene un ojo para mostrar u ocultar la contraseña. Al pulsar `Abrir editor`, la página pide la clave; al volver a Inicio o recargar, vuelve a pedirla. Desde el mismo botón se puede cambiar o quitar escribiendo la contraseña actual. Las claves anteriores siguen funcionando y se pueden cambiar por una de 4 dígitos. La clave no se guarda en texto: se conserva un verificador PBKDF2 con sal aleatoria dentro del registro de congregaciones, que se comparte entre equipos al conectar la sincronización. Una congregación sin contraseña sigue abriéndose directamente.

Este bloqueo controla la entrada desde la interfaz. No cifra los croquis, los mapas descargados ni los respaldos. El repositorio y algunos datos publicados siguen siendo accesibles por separado; para privacidad real hacen falta permisos por congregación en Firebase y retirar los datos protegidos de los archivos públicos.

Al crear o cambiar una contraseña se entrega un código de recuperación que puedes copiar o descargar. Guárdalo fuera de la app: solo se muestra en esa ventana y el registro conserva únicamente su verificador. Si olvidas la clave, pulsa `Olvidé mi contraseña`, escribe el código y elige una nueva de 4 dígitos. Se genera otro código y el anterior deja de funcionar. Para congregaciones que ya tienen contraseña, entra en `Cambiar clave`, escribe la actual y pulsa `Activar recuperación`; también puedes renovar el código desde allí sin cambiar la contraseña. Si no se activó la recuperación, el responsable debe usar la contraseña actual para configurarla. El código funciona sin conexión con los datos guardados en ese dispositivo y se comparte su verificador al sincronizar.

## Flechas y espacio del texto en el PDF

Al colocar o seleccionar un destino, activa `Ver espacio del texto en el PDF`. La guía muestra el espacio físico del texto sobre el mapa, según la hoja individual o la lámina seleccionada en `Descargar PDF`; cambia al escribir el destino o ajustar sus puntos. Un aviso naranja indica si taparía una zona pintada u otro destino. Arrastra la guía o usa `Buscar espacio libre` y pulsa `Guardar` para aplicar la posición. Cerrar descarta la propuesta. En el teléfono, el panel se puede minimizar para dejar visible el mapa; el texto también se mueve con las flechas del teclado cuando tiene el foco.

La lámina aprovecha casi todo el lado disponible de cada recuadro y mantiene las proporciones del territorio, los contornos y las marcas exteriores. Las referencias se colocan en una esquina con menos interferencias y conservan letras de 8 puntos e iconos de 4 mm, independientemente de la escala del mapa. En la hoja individual usan 9 puntos e iconos de 5 mm. Una lista muy larga usa columnas y se ajusta solo cuando no cabe completa en su recuadro.

## Mapa sin conexion

El mapa descargado muestra los nombres de calles y carreteras, localidades y lugares disponibles en los datos guardados. Incluye edificios, parques, áreas verdes, campos y zonas de agua cartografiados en OpenStreetMap. Las letras llevan un halo blanco para mantener el contraste sobre las zonas pintadas y se recolocan al acercar o mover el mapa, sin nuevas peticiones a internet. Los nombres de las referencias aparecen junto a sus iconos cuando hay espacio, sin estorbar los números del territorio ni la edición.

El zoom sin conexión responde directamente con los datos que ya están en memoria. Las calles, referencias y nombres se actualizan juntos una sola vez por cuadro de pantalla, también al hacer varios acercamientos seguidos; los botones, la rueda, el teclado y el gesto con dos dedos evitan la espera de la animación. Al volver al mapa en línea se recupera su comportamiento habitual.

Las descargas anteriores siguen siendo utilizables. Si el panel indica `Actualización disponible`, conéctate y toca `Actualizar mapa` para agregar estos detalles. Cada territorio se reemplaza solo cuando se recibe y guarda su actualización completa; cancelar, perder conexión o recibir una respuesta incompleta conserva su copia anterior. Los colores, textos y dibujos no se modifican. El botón verde indica que todos los territorios tienen la versión detallada y que la página está preparada para abrirse sin internet.

Al actualizar, la página comprueba que la versión nueva para trabajar sin conexión esté activa antes de guardar los mapas. Una versión anterior del navegador no puede dar la descarga por completa. Si ocurre un fallo, su motivo permanece visible al cerrar y volver a abrir el panel; el siguiente intento continúa conservando lo ya guardado.

En Inicio, selecciona la congregacion y abre el editor. Alli pulsa `Mapa sin conexion` para abrir su panel independiente y `Descargar congregacion` mientras tengas internet. Se guardan las calles y referencias de **todos** sus territorios, ademas de los archivos necesarios para abrir la pagina. La descarga muestra el avance y se puede cancelar o reanudar; `Quitar descarga` borra solo los datos del mapa de esa congregacion. Los colores, textos y trazos se conservan en el almacenamiento local habitual. Cuando la congregacion esta completamente preparada, el boton `Mapa sin conexion` aparece verde con una marca de verificacion. Desde su panel, `Ver mapa guardado` permite revisar la descarga en el mismo mapa; al perder conexion se usa automaticamente y al recuperarla vuelve a la vista en linea. No hay una opcion de descarga separada en el selector de mapas. Cada congregacion muestra por separado su estado de descarga.

Este mapa usa datos vectoriales abiertos de OpenStreetMap, no teselas de Google, CARTO ni del servidor de teselas de OpenStreetMap. Muestra calles, rios y referencias disponibles en esos datos; el aspecto y detalle pueden diferir del mapa en linea. Los PDF requieren volver a una vista con conexion. `Mi ubicacion` puede mostrar el punto sin internet cuando el dispositivo y el navegador entregan una lectura reciente con permiso; la posicion no se guarda en la descarga. Para conservar la descarga, abre siempre la misma direccion HTTPS en el mismo navegador y evita borrar sus datos del sitio. Los limites de almacenamiento del navegador y la disponibilidad del servidor de calles pueden interrumpir una descarga; al reintentar se conservan los territorios ya guardados.

Los 21 territorios originales tienen un paquete detallado ya preparado en `outputs/offline-map-pack.json`, con versión 2, calles, referencias, polígonos y nombres de localidades. La descarga guarda ese paquete en el dispositivo sin consultar el servidor de calles por cada territorio. Si agregas una zona o amplias su recuadro fuera del area preparada, solo esa zona necesita una consulta adicional. Las consultas tienen un tiempo limitado, prueban otro servidor y dividen la zona cuando es necesario; una respuesta incompleta nunca se marca como lista. Si una zona falla, se continua con las demas y al reanudar se descargan solo los pendientes. La preparacion se pausa a los tres minutos para conservar lo guardado y permitir reintentar.

Para actualizar el paquete publico, usa `tools/offline-map-bounds.json` como lista de areas, `tools/fetch-offline-map-source.py` para obtener los datos de esas areas y `tools/build-offline-pack.cjs` para convertirlos al formato de la app. Ambos muestran sus argumentos al principio del archivo; el punto de control permite continuar una preparacion interrumpida. Los datos del paquete son © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), disponibles bajo ODbL. El paquete contiene geografia publica; los colores personales, las contraseñas y la ubicacion del dispositivo permanecen fuera de el.

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
