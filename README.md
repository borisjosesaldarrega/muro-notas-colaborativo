# Muro de Notas Adhesivas Colaborativo

Aplicación web inspirada en el diseño de Figma de Muro: permite organizar varios muros, invitar personas con permisos distintos y colaborar con notas adhesivas sincronizadas en tiempo real.

## Funciones principales

- Registro, inicio de sesión, restauración de sesión, recuperación simulada y cambio de contraseña.
- La primera cuenta registrada recibe el rol `superadmin`; las demás son usuarios normales.
- Panel “Mis muros” para crear, abrir, editar y eliminar espacios independientes.
- Miembros por muro con permisos `propietario`, `editor` y `lector`.
- Notas de hasta 280 caracteres, movimiento táctil o con mouse y cinco colores exactos.
- Perfil con nombre y avatar, y configuración persistida en el servidor.
- Temas claro, oscuro y automático según el sistema, sin destello inicial de tema.
- Menú de avatar accesible, desplegable en escritorio y tipo *bottom sheet* en móvil.
- Administración de usuarios, roles, muros, miembros, estadísticas y vaciado de notas.
- Roles y acciones privilegiadas validados en el servidor; el navegador nunca decide si alguien es administrador.

## Tecnologías

- HTML5, CSS3 y JavaScript sin framework.
- Node.js, Express y Socket.io.
- `node:test` y `socket.io-client` para pruebas de integración.

## Instalación y ejecución

Requiere Node.js 18 o superior.

```bash
npm install
npm start
```

Abre [http://localhost:3000](http://localhost:3000). El estado del servidor está disponible en [http://localhost:3000/api/health](http://localhost:3000/api/health).

Para comprobar sintaxis y ejecutar todas las pruebas:

```bash
npm run check
```

## Probar la colaboración

1. Inicia el servidor y abre `http://localhost:3000` en dos ventanas o dispositivos.
2. Registra una cuenta distinta en cada uno. La primera será superadministradora.
3. Desde una cuenta propietaria, crea un muro e invita el correo registrado de la otra persona.
4. Asigna permiso de edición o lectura y abre el mismo muro en ambas ventanas.
5. Crea, edita, mueve o elimina una nota y confirma que el cambio aparece en tiempo real.

Para probar desde otro dispositivo de la misma red, usa `http://IP_DEL_EQUIPO:3000` y permite el puerto 3000 en el cortafuegos local.

## Persistencia y alcance de la demostración

Usuarios, contraseñas, sesiones, ajustes, muros, permisos y notas viven en memoria del servidor. Esto permite verificar autorizaciones desde Socket.io sin confiar en `localStorage`, pero todos los datos se reinician al detener el proceso de Node.js.

El navegador solo conserva:

- El token opaco de sesión en `sessionStorage`.
- La preferencia de tema en `localStorage` para aplicarla antes de pintar la página y evitar un destello de color. La fuente de verdad vuelve a ser la configuración de usuario enviada por el servidor.

La interfaz inserta contenido mediante APIs seguras del DOM y el servidor limita textos, imágenes, colores y coordenadas. Aun así, esta es una demostración académica: las contraseñas permanecen en memoria sin hash y debe añadirse una base de datos, hash seguro, HTTPS, protección de fuerza bruta y recuperación real antes de usarla en producción.

## Estructura

```text
.
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── test/
│   └── server.test.js
├── package.json
├── package-lock.json
├── README.md
└── server.js
```

## Limitaciones actuales

- No hay base de datos: reiniciar el servidor borra todo.
- La recuperación de contraseña solo simula una respuesta segura y uniforme.
- No hay historial de versiones, cursores remotos ni resolución avanzada de ediciones simultáneas.
- La representación de las nuevas pantallas en Figma queda pendiente si la cuenta alcanza el límite de llamadas del complemento; el código sí contiene todos los estados descritos.
