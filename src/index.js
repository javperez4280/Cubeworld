// Servidor de CubeWorld: sirve el juego y guarda/carga mundos en D1.
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/mundos' || url.pathname.startsWith('/api/mundos/')) {
      try {
        return await api(req, env, url);
      } catch (e) {
        return json({ error: 'Error del servidor' }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

let tablaLista = false;
async function asegurarTabla(env) {
  if (tablaLista) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS mundos (
      nombre TEXT PRIMARY KEY,
      semilla INTEGER NOT NULL,
      datos TEXT NOT NULL,
      actualizado TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();
  tablaLista = true;
}

async function api(req, env, url) {
  await asegurarTabla(env);
  const raw = url.pathname.slice('/api/mundos/'.length);
  const nombre = url.pathname.length > '/api/mundos/'.length ? decodeURIComponent(raw).trim().slice(0, 40) : '';

  if (!nombre) {
    if (req.method !== 'GET') return json({ error: 'Método no permitido' }, 405);
    const { results } = await env.DB
      .prepare('SELECT nombre, actualizado FROM mundos ORDER BY actualizado DESC LIMIT 50')
      .all();
    return json(results);
  }

  if (req.method === 'GET') {
    const row = await env.DB
      .prepare('SELECT nombre, semilla, datos FROM mundos WHERE nombre = ?')
      .bind(nombre)
      .first();
    return row ? json(row) : json({ error: 'No existe ese mundo' }, 404);
  }

  if (req.method === 'PUT') {
    const body = await req.json();
    const semilla = Number(body.semilla);
    const cambios = body.cambios;
    if (!Number.isInteger(semilla) || !Array.isArray(cambios) || !cambios.every(Number.isInteger)) {
      return json({ error: 'Datos inválidos' }, 400);
    }
    const datos = JSON.stringify(cambios);
    if (datos.length > 1_000_000) return json({ error: 'Mundo demasiado grande' }, 413);
    await env.DB
      .prepare(
        `INSERT INTO mundos (nombre, semilla, datos, actualizado) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(nombre) DO UPDATE SET semilla = excluded.semilla, datos = excluded.datos, actualizado = excluded.actualizado`
      )
      .bind(nombre, semilla, datos)
      .run();
    return json({ ok: true });
  }

  return json({ error: 'Método no permitido' }, 405);
}
