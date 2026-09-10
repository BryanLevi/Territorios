# Encender el trabajo compartido

Sirve para que varias personas vean los cambios al momento, sin recargar y sin
botones de subir y bajar. Todo esto es gratis: el plan sin costo de Firebase no
pide tarjeta, y si algún día se pasara del límite el servicio se detiene hasta
el día siguiente en vez de cobrar.

Mientras `FIREBASE_CONFIG` esté vacío, la página funciona igual que siempre y
todo se queda en el navegador de cada quien.

## 1. Crear el proyecto

1. Entra a <https://console.firebase.google.com> con tu cuenta de Google.
2. **Agregar proyecto** → nombre, por ejemplo `croquis-territorios`.
3. Cuando pregunte por Google Analytics, dile que no. No hace falta.

## 2. Crear la base

1. En el menú de la izquierda: **Firestore Database** → **Crear base de datos**.
2. Elige **modo de producción** (las reglas se ponen en el paso 4).
3. Ubicación: `nam5` o `us-central`. Cualquiera sirve.

## 3. Crear la cuenta con la que entrarán

1. **Authentication** → **Comenzar** → **Correo electrónico/contraseña** →
   actívalo y guarda.
2. Pestaña **Users** → **Agregar usuario**. Pon un correo y una contraseña,
   por ejemplo `territorios@tucongregacion.mx`.
3. Esa contraseña es la que compartes con quienes vayan a editar. Se pide una
   sola vez por dispositivo: Firebase se acuerda de la sesión.

Si algún día quieres saber quién cambió qué, crea una cuenta por persona en
vez de una compartida. La página ya enseña el correo de quien hizo el cambio,
así que no hay que tocar nada del código.

## 4. Poner las reglas

**Firestore Database** → pestaña **Reglas** → borra lo que haya, pega el
contenido de `firestore.rules` (está junto a este archivo) y **Publicar**.

Esto no es opcional. Sin reglas, cualquiera con el enlace de la página puede
borrar el trabajo de todos.

## 5. Registrar la página y copiar la configuración

1. Rueda dentada ⚙ → **Configuración del proyecto**.
2. Abajo, en **Tus apps**, el icono `</>` (Web). Ponle un apodo y registra.
3. Te enseña un bloque `const firebaseConfig = { ... }`. Copia esos valores.
4. Abre `outputs/croquis_territorios.html`, busca `const FIREBASE_CONFIG` —
   está cerca del final, en la parte de *Trabajo compartido* — y pega ahí
   `apiKey`, `authDomain`, `projectId` y `appId`.

Esa clave va a la vista en la página y así tiene que ser: en Firebase la
seguridad la dan las reglas del paso 4, no la clave.

## 6. Usarlo

Sube el cambio a GitHub y abre la página. Arriba a la derecha aparece el botón
**Conectar**: pide el correo y la contraseña una vez, y el punto se pone verde.
A partir de ahí, cada vez que alguien le da a **Guardar cambios**, a los demás
les aparece solo en un segundo.

Si estás a medio pintar una zona, el cambio de otro no te mueve el mapa bajo la
mano: sale un aviso y se aplica en cuanto termines o canceles.

## Lo que conviene saber

- **Cada territorio se guarda por separado.** Si tú pintas Zacamitla y otro
  pinta Opatla, no se pisan. Dentro del mismo territorio gana el último que
  guarde, que es lo razonable porque los dos están viendo lo mismo.
- **Funciona sin señal.** Firestore guarda una copia en el teléfono y sube lo
  pendiente cuando vuelve el internet.
- **Exportar respaldo se queda** como paracaídas, por si entre todos se borra
  algo y hay que volver atrás.
- Los botones de GitHub siguen sirviendo para dejar una copia en el
  repositorio, que es de donde salen los PDF y las láminas.
