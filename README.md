# Muro de Notas Adhesivas Colaborativo

Aplicación web colaborativa similar a un Padlet simplificado. Permite crear, editar, mover, filtrar y eliminar notas adhesivas; los cambios aparecen en tiempo real para todas las personas conectadas.

## Funciones

- Registro, inicio de sesión y recuperación simulados con almacenamiento local.
- Primer usuario registrado con rol de superadministrador.
- Notas de cinco colores, editables y movibles mediante arrastrar y soltar.
- Sincronización en tiempo real con Socket.io.
- Contador de participantes conectados.
- Filtros por color y panel de administración.
- Diseño adaptable para computadoras y teléfonos.
- Backend sencillo con arreglo en memoria, ideal para la presentación académica.

> Las cuentas se guardan únicamente en el navegador y las notas se reinician al apagar el servidor. Es el alcance intencional de esta versión demostrativa.

## Requisitos

- Node.js 18 o superior.

## Ejecutar

```bash
npm --prefix Backend install
npm --prefix Backend start
```

Abre [http://localhost:3000](http://localhost:3000) en el navegador. Para demostrar el tiempo real, abre la misma dirección en dos ventanas o dispositivos conectados al servidor.

## Estructura

```text
.
├── Backend/
│   ├── package.json
│   ├── package-lock.json
│   └── server.js
├── BaseDeDatos/
│   └── README.md
├── Frontend/
│   ├── app.js
│   ├── index.html
│   └── styles.css
└── README.md
```

La versión actual todavía no incluye una base de datos ni colecciones de Postman. Esas carpetas se completarán únicamente cuando existan archivos reales del proyecto.

## Tecnologías

HTML5, CSS3, JavaScript, Node.js, Express y Socket.io.
