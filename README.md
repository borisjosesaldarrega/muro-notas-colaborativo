# Muro de Notas Adhesivas Colaborativo

Aplicación web colaborativa similar a un Padlet simplificado. Permite crear, editar, mover, filtrar y eliminar notas adhesivas; los cambios aparecen en tiempo real para todas las personas conectadas.

## Funciones

- Registro, inicio de sesión, recuperación y sesiones mediante el backend.
- Notas de cinco colores, editables y movibles mediante arrastrar y soltar.
- Sincronización en tiempo real con Socket.io.
- Contador de participantes conectados.
- Filtros por color y panel de administración.
- Diseño adaptable para computadoras y teléfonos.
- Backend con Socket.io, permisos, pruebas y persistencia opcional en Supabase.

> Sin variables de Supabase, el backend utiliza memoria para permitir las pruebas locales. Con Supabase configurado, los usuarios, muros, integrantes y notas se almacenan en la base de datos.

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
│   ├── lib/
│   ├── test/
│   ├── .env.example
│   ├── README.md
│   ├── package.json
│   ├── package-lock.json
│   └── server.js
├── BaseDeDatos/
│   ├── supabase/migrations/
│   └── README.md
├── Frontend/
│   ├── app.js
│   ├── index.html
│   └── styles.css
└── README.md
```

La validación completa de invitaciones mediante enlace o código permanece pendiente y está documentada en `Backend/README.md`.

## Tecnologías

HTML5, CSS3, JavaScript, Node.js, Express, Socket.io, PostgreSQL y Supabase.
