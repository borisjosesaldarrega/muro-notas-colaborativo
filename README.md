# Muro de Notas Adhesivas Colaborativo

Aplicación web colaborativa similar a un Padlet o Jamboard simplificado. Permite crear, editar, mover, filtrar y eliminar notas adhesivas; los cambios se sincronizan en tiempo real para todas las personas conectadas.

## Funciones principales

- Registro, inicio de sesión, recuperación de contraseña y cierre de sesión simulados.
- Primer usuario registrado en cada navegador con rol de superadministrador.
- Notas de hasta 280 caracteres en amarillo, rosa, azul, verde o lila.
- Edición y movimiento con mouse, pantalla táctil o lápiz.
- Filtros por color, nota inicial de bienvenida y autor visible.
- Sincronización con Socket.io y contador de personas conectadas.
- Panel exclusivo de superadministrador con estadísticas y limpieza global del muro.
- Confirmaciones destructivas, notificaciones, estado de conexión y controles accesibles.
- Diseño morado, adaptable a computadoras y teléfonos.

## Tecnologías

- HTML5, CSS3 y JavaScript sin framework en el frontend.
- Node.js, Express y Socket.io en el backend.
- `node:test` y `socket.io-client` para la prueba de integración.

## Requisitos

- Node.js 18 o superior.
- npm (incluido con Node.js).

## Instalación y ejecución

```bash
npm install
npm start
```

Abre [http://localhost:3000](http://localhost:3000). El endpoint de estado está en [http://localhost:3000/api/health](http://localhost:3000/api/health).

Para validar sintaxis y ejecutar las pruebas automatizadas:

```bash
npm run check
```

## Probar la colaboración en tiempo real

1. Inicia el servidor con `npm start`.
2. Abre `http://localhost:3000` en dos ventanas. Para simular cuentas locales independientes, usa dos perfiles del navegador o dos dispositivos.
3. Registra una cuenta e inicia sesión en cada ventana.
4. Crea, edita, mueve o elimina una nota en una ventana.
5. Confirma que la otra ventana recibe el cambio de inmediato y que el contador muestra ambas conexiones.

En otro dispositivo de la misma red se debe usar `http://IP_DEL_EQUIPO:3000` y permitir el puerto 3000 en el cortafuegos local.

## Estructura

```text
.
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── test/
│   └── server.test.js
├── .gitignore
├── package-lock.json
├── package.json
├── README.md
└── server.js
```

## Persistencia y seguridad de esta demostración

Las notas viven en un arreglo en memoria del servidor: todas las personas conectadas comparten el mismo muro, pero el contenido se reinicia al reiniciar el proceso de Node.js. Esto es intencional para la presentación académica.

Las cuentas, contraseñas y roles se almacenan localmente en `localStorage`; la sesión de la pestaña se conserva en `sessionStorage`. Esta autenticación es simulada y **no es apta para producción**. Aunque el servidor exige el valor `superadmin` para limpiar el muro, ese rol proviene del navegador y el control es únicamente demostrativo, no una barrera de seguridad real.

El servidor limita texto, autor, colores y coordenadas. La interfaz inserta el contenido como texto mediante propiedades seguras del DOM, sin interpretarlo como HTML.

## Limitaciones

- No hay base de datos ni persistencia después de reiniciar el servidor.
- No existe autenticación criptográfica, control de sesiones en el servidor ni autorización verificable.
- Hay un único muro compartido; todavía no hay espacios separados, historial ni resolución avanzada de conflictos simultáneos.
- Las cuentas creadas en un navegador no aparecen automáticamente en otro dispositivo.

## Mejoras futuras

- Persistencia en una base de datos y varios espacios de trabajo.
- Autenticación real con contraseñas cifradas y permisos comprobados por el servidor.
- Historial de versiones, cursores colaborativos, búsqueda, etiquetas y exportación.
- Pruebas end-to-end adicionales y despliegue con HTTPS.
