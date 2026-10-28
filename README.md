# CubeWorld

Juego de bloques 3D en el navegador. Caminá, rompé y construí, y guardá tus mundos online.

- `public/index.html`: el juego (Three.js).
- `src/index.js`: servidor en Cloudflare Workers que guarda y carga mundos.
- Modo en línea: partidas multijugador, lista de partidas, buscador de usuarios y chat. Usa las mismas cuentas que Bodriostars.
- `schema.sql`: tabla de la base D1 `cubeworld-db`.
- `wrangler.jsonc`: configuración de Cloudflare.

Se publica solo en Cloudflare cada vez que se sube un cambio a `main`.
