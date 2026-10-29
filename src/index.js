/* CubeWorld — servidor en Cloudflare Workers.

   Piezas:
   - El Worker: sirve el juego (carpeta public) y la API.
   - Lobby  : UN objeto para todo el juego. Guarda las sesiones y la lista de partidas.
   - Mundo  : UN objeto por partida. Guarda los bloques cambiados y lleva a los jugadores conectados.
   - CUENTAS: las cuentas de Bodriostars (mismo objeto que usa ese juego), así un nombre
              es único en los dos juegos y se entra con la misma contraseña.
   - DB (D1): mundos guardados del modo un jugador. */

const W = 56, H = 32, D = 56, TOTAL = W * H * D;   // tamaño del mundo (igual que en el juego)
const MAX_PARTIDA = 12;                             // jugadores por partida
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';          // sin I ni O
const DIA = 24 * 60 * 60 * 1000;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
});
const lobby = env => env.LOBBY.get(env.LOBBY.idFromName('global'));
const cuentas = env => env.CUENTAS.get(env.CUENTAS.idFromName('global'));
const post = (stub, path, body) => stub.fetch('https://interno' + path, { method: 'POST', body: JSON.stringify(body) });
const PJS = ['brasa', 'chispa', 'vela', 'filo', 'tosca', 'ronin'];   // personajes de Bodriostars
async function tengoDe(env, name) {                                   // personajes que esa cuenta compró
  try {
    const r = await (await post(cuentas(env), '/entrar', { name })).json();
    const t = Array.isArray(r.tengo) ? r.tengo.filter(k => PJS.includes(k)) : [];
    return t.length ? t : ['brasa'];
  } catch (e) { return ['brasa']; }
}

/* ================= el Worker ================= */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === '/api/mundos' || p.startsWith('/api/mundos/')) return await apiMundos(req, env, url);

      if (p === '/api/login' && req.method === 'POST') {
        const m = await req.json();
        const r = await post(cuentas(env), '/verificar', { name: m.name, pass: m.pass, crear: !!m.crear });
        if (!r.ok) return json({ err: 'Las cuentas no responden. Probá en un rato.' }, 502);
        const c = await r.json();
        if (c.err) return json({ err: c.err });
        const s = await (await post(lobby(env), '/sesion', { name: c.name })).json();
        return json({ ok: true, name: c.name, nueva: !!c.nueva, token: s.token, tengo: await tengoDe(env, c.name) });
      }

      if (p === '/api/yo') {
        const q = await (await lobby(env).fetch('https://interno/quien?token=' + encodeURIComponent(url.searchParams.get('token') || ''))).json();
        if (!q.ok) return json(q, 401);
        return json({ ok: true, name: q.name, tengo: await tengoDe(env, q.name) });
      }

      if (p === '/api/partidas' && req.method === 'GET') return lobby(env).fetch('https://interno/partidas');
      if (p === '/api/partidas' && req.method === 'POST') {
        const m = await req.json();
        return post(lobby(env), '/crear', { token: m.token, nombre: m.nombre });
      }

      if (p === '/api/usuarios') {
        const q = String(url.searchParams.get('q') || '').trim().slice(0, 14);
        if (!q) return json({ lista: [] });
        const r = await cuentas(env).fetch('https://interno/buscar?q=' + encodeURIComponent(q));
        if (!r.ok) return json({ err: 'Las cuentas no responden. Probá en un rato.' }, 502);
        const { lista } = await r.json();
        const donde = await (await post(lobby(env), '/donde', { names: lista.map(u => u.name) })).json();
        return json({ lista: lista.map(u => ({ ...u, partida: donde[u.name.toLowerCase()] || null })) });
      }

      const sala = p.match(/^\/api\/partida\/([A-Z]{4})$/);
      if (sala) {
        if (req.headers.get('Upgrade') !== 'websocket') return new Response('Acá va un WebSocket', { status: 426 });
        const destino = new URL(req.url);
        destino.searchParams.set('code', sala[1]);
        return env.MUNDOS.get(env.MUNDOS.idFromName(sala[1])).fetch(new Request(destino, req));
      }

      if (p.startsWith('/api/')) return json({ err: 'No encontrado' }, 404);
    } catch (e) {
      return json({ err: 'Error del servidor' }, 500);
    }
    return env.ASSETS.fetch(req);
  },
};

/* ================= Lobby: sesiones y lista de partidas ================= */
export class Lobby {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sesiones(token TEXT PRIMARY KEY, nombre TEXT, creada INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS partidas(code TEXT PRIMARY KEY, nombre TEXT, host TEXT,
      jugadores INTEGER DEFAULT 0, nombres TEXT DEFAULT '[]', creada INTEGER, actualizada INTEGER)`);
  }

  quien(token) {
    const f = this.sql.exec('SELECT nombre FROM sesiones WHERE token = ? AND creada > ?', String(token || ''), Date.now() - 30 * DIA).toArray()[0];
    return f ? f.nombre : null;
  }

  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === '/sesion') {
      const m = await req.json();
      const b = new Uint8Array(24); crypto.getRandomValues(b);
      const token = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
      this.sql.exec('DELETE FROM sesiones WHERE creada < ?', Date.now() - 30 * DIA);
      this.sql.exec('INSERT INTO sesiones (token, nombre, creada) VALUES (?, ?, ?)', token, m.name, Date.now());
      return json({ token });
    }

    if (p === '/quien') {
      const n = this.quien(url.searchParams.get('token'));
      return n ? json({ ok: true, name: n }) : json({ err: 'Sesión vencida. Entrá de nuevo.' }, 401);
    }

    if (p === '/partidas') {
      // las partidas vacías sin uso en 7 días se borran de la lista
      this.sql.exec('DELETE FROM partidas WHERE jugadores <= 0 AND actualizada < ?', Date.now() - 7 * DIA);
      const lista = this.sql.exec(`SELECT code, nombre, host, jugadores, nombres FROM partidas
        ORDER BY jugadores DESC, actualizada DESC LIMIT 100`).toArray()
        .map(f => ({ code: f.code, nombre: f.nombre, host: f.host, jugadores: f.jugadores, max: MAX_PARTIDA, nombres: JSON.parse(f.nombres || '[]') }));
      return json({ lista });
    }

    if (p === '/crear') {
      const m = await req.json();
      const host = this.quien(m.token);
      if (!host) return json({ err: 'Sesión vencida. Entrá de nuevo.' }, 401);
      const nombre = String(m.nombre || '').trim().slice(0, 30) || 'Mundo de ' + host;
      const propias = this.sql.exec('SELECT COUNT(*) AS n FROM partidas WHERE host = ?', host).one().n;
      if (propias >= 5) return json({ err: 'Ya tenés 5 partidas creadas. Usá una de esas.' });
      let code;
      do { code = Array.from({ length: 4 }, () => LETRAS[Math.floor(Math.random() * LETRAS.length)]).join(''); }
      while (this.sql.exec('SELECT 1 FROM partidas WHERE code = ?', code).toArray().length);
      this.sql.exec('INSERT INTO partidas (code, nombre, host, creada, actualizada) VALUES (?, ?, ?, ?, ?)', code, nombre, host, Date.now(), Date.now());
      return json({ ok: true, code });
    }

    if (p === '/info') {
      const f = this.sql.exec('SELECT code, nombre, host FROM partidas WHERE code = ?', url.searchParams.get('code')).toArray()[0];
      return f ? json(f) : json({ err: 'Esa partida no existe.' }, 404);
    }

    if (p === '/aviso') {
      const m = await req.json();
      this.sql.exec('UPDATE partidas SET jugadores = ?, nombres = ?, actualizada = ? WHERE code = ?',
        m.nombres.length, JSON.stringify(m.nombres), Date.now(), m.code);
      return json({ ok: true });
    }

    if (p === '/donde') {
      const m = await req.json();
      const res = {};
      const filas = this.sql.exec('SELECT code, nombre, nombres FROM partidas WHERE jugadores > 0').toArray();
      for (const f of filas) for (const n of JSON.parse(f.nombres || '[]')) res[String(n).toLowerCase()] = { code: f.code, nombre: f.nombre };
      const out = {};
      for (const n of m.names || []) if (res[n.toLowerCase()]) out[n.toLowerCase()] = res[n.toLowerCase()];
      return json(out);
    }

    return json({ err: 'No encontrado' }, 404);
  }
}

/* ================= Mundo: una partida ================= */
export class Mundo {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS cambios(i INTEGER PRIMARY KEY, b INTEGER)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)');
  }

  meta(k) { const f = this.sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray()[0]; return f ? f.v : null; }
  setMeta(k, v) { this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v)); }
  datos(ws) { try { return ws.deserializeAttachment() || {}; } catch (e) { return {}; } }
  enviar(ws, o) { try { ws.send(JSON.stringify(o)); } catch (e) {} }
  todos(o, menos) {
    const s = JSON.stringify(o);
    for (const w of this.ctx.getWebSockets()) if (w !== menos) { try { w.send(s); } catch (e) {} }
  }
  nombres(menos) { return this.ctx.getWebSockets().filter(w => w !== menos).map(w => this.datos(w).name).filter(Boolean); }
  async avisarLobby(menos) {
    const code = this.meta('code');
    if (code) await post(lobby(this.env), '/aviso', { code, nombres: this.nombres(menos) });
  }

  async fetch(req) {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const L = lobby(this.env);

    const q = await (await L.fetch('https://interno/quien?token=' + encodeURIComponent(url.searchParams.get('token') || ''))).json();
    if (!q.ok) return new Response('Sesión vencida', { status: 401 });
    const info = await L.fetch('https://interno/info?code=' + code);
    if (!info.ok) return new Response('Esa partida no existe', { status: 404 });
    const partida = await info.json();

    // la misma cuenta entrando de nuevo: se cierra la conexión vieja
    for (const w of this.ctx.getWebSockets()) {
      if ((this.datos(w).name || '').toLowerCase() === q.name.toLowerCase()) {
        try { w.close(4000, 'Entraste desde otro lado'); } catch (e) {}
      }
    }
    const abiertas = this.ctx.getWebSockets().filter(w => (this.datos(w).name || '').toLowerCase() !== q.name.toLowerCase());
    if (abiertas.length >= MAX_PARTIDA) return new Response('Partida llena', { status: 503 });

    if (!this.meta('seed')) this.setMeta('seed', Math.floor(Math.random() * 1e9));
    this.setMeta('code', code);

    const par = new WebSocketPair();
    this.ctx.acceptWebSocket(par[1]);
    const tengo = await tengoDe(this.env, q.name);
    const pedido = url.searchParams.get('pj');
    const pj = tengo.includes(pedido) ? pedido : tengo[0];
    par[1].serializeAttachment({ name: q.name, pj, x: 0, y: 0, z: 0, yaw: 0 });

    const cambios = [];
    for (const f of this.sql.exec('SELECT i, b FROM cambios')) cambios.push(f.i, f.b);
    this.enviar(par[1], {
      t: 'init', yo: q.name, pj, code, nombre: partida.nombre, host: partida.host,
      seed: Number(this.meta('seed')), cambios,
      jugadores: abiertas.map(w => this.datos(w)).filter(d => d.name),
    });
    this.todos({ t: 'entra', name: q.name, pj }, par[1]);
    await this.avisarLobby();
    return new Response(null, { status: 101, webSocket: par[0] });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 2000) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const yo = this.datos(ws);
    if (!yo.name) return;
    const num = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : 0);

    if (m.t === 'pos') {
      const d = { name: yo.name, pj: yo.pj, x: num(m.x), y: num(m.y), z: num(m.z), yaw: num(m.yaw) };
      ws.serializeAttachment(d);
      this.todos({ t: 'pos', ...d }, ws);
    } else if (m.t === 'bloque') {
      const i = m.i | 0, b = m.b | 0;
      if (i < 0 || i >= TOTAL || b < 0 || b > 7) return;
      this.sql.exec('INSERT INTO cambios (i, b) VALUES (?, ?) ON CONFLICT(i) DO UPDATE SET b = excluded.b', i, b);
      this.todos({ t: 'bloque', i, b }, ws);
    } else if (m.t === 'chat') {
      const txt = String(m.txt || '').trim().slice(0, 120);
      if (txt) this.todos({ t: 'chat', name: yo.name, txt });
    }
  }

  async webSocketClose(ws) {
    const n = this.datos(ws).name;
    try { ws.close(); } catch (e) {}
    if (n) this.todos({ t: 'sale', name: n }, ws);
    await this.avisarLobby(ws);
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }
}

/* ================= mundos guardados (modo un jugador, D1) ================= */
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

async function apiMundos(req, env, url) {
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
    const row = await env.DB.prepare('SELECT nombre, semilla, datos FROM mundos WHERE nombre = ?').bind(nombre).first();
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
    await env.DB.prepare(
      `INSERT INTO mundos (nombre, semilla, datos, actualizado) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(nombre) DO UPDATE SET semilla = excluded.semilla, datos = excluded.datos, actualizado = excluded.actualizado`
    ).bind(nombre, semilla, datos).run();
    return json({ ok: true });
  }

  return json({ error: 'Método no permitido' }, 405);
}
