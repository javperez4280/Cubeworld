var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// wrangler-config:config:middleware/patch-console-prefix
var prefix = "[cubeworld]";

// ../../../tmp/claude-0/-home-claude/b0f9aba8-613b-5542-a325-ee5efdc6899b/scratchpad/wr/node_modules/wrangler/templates/middleware/middleware-patch-console-prefix.ts
["log", "debug", "info"].forEach((method) => {
  globalThis.console[method] = new Proxy(globalThis.console[method], {
    apply(target, thisArg, argumentsList) {
      return target.apply(thisArg, [prefix, ...argumentsList]);
    }
  });
});

// src/index.js
var W = 56;
var H = 32;
var D = 56;
var TOTAL = W * H * D;
var MAX_PARTIDA = 12;
var LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
var DIA = 24 * 60 * 60 * 1e3;
var json = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" }
}), "json");
var lobby = /* @__PURE__ */ __name((env) => env.LOBBY.get(env.LOBBY.idFromName("global")), "lobby");
var cuentas = /* @__PURE__ */ __name((env) => env.CUENTAS.get(env.CUENTAS.idFromName("global")), "cuentas");
var post = /* @__PURE__ */ __name((stub, path, body) => stub.fetch("https://interno" + path, { method: "POST", body: JSON.stringify(body) }), "post");
var PJS = ["brasa", "chispa", "vela", "filo", "tosca", "ronin"];
var src_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === "/api/mundos" || p.startsWith("/api/mundos/")) return await apiMundos(req, env, url);
      if (p === "/api/login" && req.method === "POST") {
        const m = await req.json();
        const r = await post(cuentas(env), "/verificar", { name: m.name, pass: m.pass, crear: !!m.crear });
        if (!r.ok) return json({ err: "Las cuentas no responden. Prob\xE1 en un rato." }, 502);
        const c = await r.json();
        if (c.err) return json({ err: c.err });
        const s = await (await post(lobby(env), "/sesion", { name: c.name })).json();
        return json({ ok: true, name: c.name, nueva: !!c.nueva, token: s.token });
      }
      if (p === "/api/yo") {
        const q = await (await lobby(env).fetch("https://interno/quien?token=" + encodeURIComponent(url.searchParams.get("token") || ""))).json();
        if (!q.ok) return json(q, 401);
        return json({ ok: true, name: q.name });
      }
      if (p === "/api/partidas" && req.method === "GET") return lobby(env).fetch("https://interno/partidas");
      if (p === "/api/partidas" && req.method === "POST") {
        const m = await req.json();
        return post(lobby(env), "/crear", { token: m.token, nombre: m.nombre });
      }
      if (p === "/api/usuarios") {
        const q = String(url.searchParams.get("q") || "").trim().slice(0, 14);
        if (!q) return json({ lista: [] });
        const r = await cuentas(env).fetch("https://interno/buscar?q=" + encodeURIComponent(q));
        if (!r.ok) return json({ err: "Las cuentas no responden. Prob\xE1 en un rato." }, 502);
        const { lista } = await r.json();
        const donde = await (await post(lobby(env), "/donde", { names: lista.map((u) => u.name) })).json();
        return json({ lista: lista.map((u) => ({ ...u, partida: donde[u.name.toLowerCase()] || null })) });
      }
      const sala = p.match(/^\/api\/partida\/([A-Z]{4})$/);
      if (sala) {
        if (req.headers.get("Upgrade") !== "websocket") return new Response("Ac\xE1 va un WebSocket", { status: 426 });
        const destino = new URL(req.url);
        destino.searchParams.set("code", sala[1]);
        return env.MUNDOS.get(env.MUNDOS.idFromName(sala[1])).fetch(new Request(destino, req));
      }
      if (p.startsWith("/api/")) return json({ err: "No encontrado" }, 404);
    } catch (e) {
      return json({ err: "Error del servidor" }, 500);
    }
    return env.ASSETS.fetch(req);
  }
};
var Lobby = class {
  static {
    __name(this, "Lobby");
  }
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sesiones(token TEXT PRIMARY KEY, nombre TEXT, creada INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS partidas(code TEXT PRIMARY KEY, nombre TEXT, host TEXT,
      jugadores INTEGER DEFAULT 0, nombres TEXT DEFAULT '[]', creada INTEGER, actualizada INTEGER)`);
  }
  quien(token) {
    const f = this.sql.exec("SELECT nombre FROM sesiones WHERE token = ? AND creada > ?", String(token || ""), Date.now() - 30 * DIA).toArray()[0];
    return f ? f.nombre : null;
  }
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === "/sesion") {
      const m = await req.json();
      const b = new Uint8Array(24);
      crypto.getRandomValues(b);
      const token = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      this.sql.exec("DELETE FROM sesiones WHERE creada < ?", Date.now() - 30 * DIA);
      this.sql.exec("INSERT INTO sesiones (token, nombre, creada) VALUES (?, ?, ?)", token, m.name, Date.now());
      return json({ token });
    }
    if (p === "/quien") {
      const n = this.quien(url.searchParams.get("token"));
      return n ? json({ ok: true, name: n }) : json({ err: "Sesi\xF3n vencida. Entr\xE1 de nuevo." }, 401);
    }
    if (p === "/partidas") {
      this.sql.exec("DELETE FROM partidas WHERE jugadores <= 0 AND actualizada < ?", Date.now() - 7 * DIA);
      const lista = this.sql.exec(`SELECT code, nombre, host, jugadores, nombres FROM partidas
        ORDER BY jugadores DESC, actualizada DESC LIMIT 100`).toArray().map((f) => ({ code: f.code, nombre: f.nombre, host: f.host, jugadores: f.jugadores, max: MAX_PARTIDA, nombres: JSON.parse(f.nombres || "[]") }));
      return json({ lista });
    }
    if (p === "/crear") {
      const m = await req.json();
      const host = this.quien(m.token);
      if (!host) return json({ err: "Sesi\xF3n vencida. Entr\xE1 de nuevo." }, 401);
      const nombre = String(m.nombre || "").trim().slice(0, 30) || "Mundo de " + host;
      const propias = this.sql.exec("SELECT COUNT(*) AS n FROM partidas WHERE host = ?", host).one().n;
      if (propias >= 5) return json({ err: "Ya ten\xE9s 5 partidas creadas. Us\xE1 una de esas." });
      let code;
      do {
        code = Array.from({ length: 4 }, () => LETRAS[Math.floor(Math.random() * LETRAS.length)]).join("");
      } while (this.sql.exec("SELECT 1 FROM partidas WHERE code = ?", code).toArray().length);
      this.sql.exec("INSERT INTO partidas (code, nombre, host, creada, actualizada) VALUES (?, ?, ?, ?, ?)", code, nombre, host, Date.now(), Date.now());
      return json({ ok: true, code });
    }
    if (p === "/info") {
      const f = this.sql.exec("SELECT code, nombre, host FROM partidas WHERE code = ?", url.searchParams.get("code")).toArray()[0];
      return f ? json(f) : json({ err: "Esa partida no existe." }, 404);
    }
    if (p === "/aviso") {
      const m = await req.json();
      this.sql.exec(
        "UPDATE partidas SET jugadores = ?, nombres = ?, actualizada = ? WHERE code = ?",
        m.nombres.length,
        JSON.stringify(m.nombres),
        Date.now(),
        m.code
      );
      return json({ ok: true });
    }
    if (p === "/donde") {
      const m = await req.json();
      const res = {};
      const filas = this.sql.exec("SELECT code, nombre, nombres FROM partidas WHERE jugadores > 0").toArray();
      for (const f of filas) for (const n of JSON.parse(f.nombres || "[]")) res[String(n).toLowerCase()] = { code: f.code, nombre: f.nombre };
      const out = {};
      for (const n of m.names || []) if (res[n.toLowerCase()]) out[n.toLowerCase()] = res[n.toLowerCase()];
      return json(out);
    }
    return json({ err: "No encontrado" }, 404);
  }
};
var Mundo = class {
  static {
    __name(this, "Mundo");
  }
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS cambios(i INTEGER PRIMARY KEY, b INTEGER)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)");
  }
  meta(k) {
    const f = this.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0];
    return f ? f.v : null;
  }
  setMeta(k, v) {
    this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, String(v));
  }
  datos(ws) {
    try {
      return ws.deserializeAttachment() || {};
    } catch (e) {
      return {};
    }
  }
  enviar(ws, o) {
    try {
      ws.send(JSON.stringify(o));
    } catch (e) {
    }
  }
  todos(o, menos) {
    const s = JSON.stringify(o);
    for (const w of this.ctx.getWebSockets()) if (w !== menos) {
      try {
        w.send(s);
      } catch (e) {
      }
    }
  }
  nombres(menos) {
    return this.ctx.getWebSockets().filter((w) => w !== menos).map((w) => this.datos(w).name).filter(Boolean);
  }
  async avisarLobby(menos) {
    const code = this.meta("code");
    if (code) await post(lobby(this.env), "/aviso", { code, nombres: this.nombres(menos) });
  }
  async fetch(req) {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const L = lobby(this.env);
    const q = await (await L.fetch("https://interno/quien?token=" + encodeURIComponent(url.searchParams.get("token") || ""))).json();
    if (!q.ok) return new Response("Sesi\xF3n vencida", { status: 401 });
    const info = await L.fetch("https://interno/info?code=" + code);
    if (!info.ok) return new Response("Esa partida no existe", { status: 404 });
    const partida = await info.json();
    for (const w of this.ctx.getWebSockets()) {
      if ((this.datos(w).name || "").toLowerCase() === q.name.toLowerCase()) {
        try {
          w.close(4e3, "Entraste desde otro lado");
        } catch (e) {
        }
      }
    }
    const abiertas = this.ctx.getWebSockets().filter((w) => (this.datos(w).name || "").toLowerCase() !== q.name.toLowerCase());
    if (abiertas.length >= MAX_PARTIDA) return new Response("Partida llena", { status: 503 });
    if (!this.meta("seed")) this.setMeta("seed", Math.floor(Math.random() * 1e9));
    this.setMeta("code", code);
    const par = new WebSocketPair();
    this.ctx.acceptWebSocket(par[1]);
    const pedido = url.searchParams.get("pj");
    const pj = PJS.includes(pedido) ? pedido : "brasa";
    par[1].serializeAttachment({ name: q.name, pj, x: 0, y: 0, z: 0, yaw: 0 });
    const cambios = [];
    for (const f of this.sql.exec("SELECT i, b FROM cambios")) cambios.push(f.i, f.b);
    this.enviar(par[1], {
      t: "init",
      yo: q.name,
      pj,
      code,
      nombre: partida.nombre,
      host: partida.host,
      seed: Number(this.meta("seed")),
      cambios,
      jugadores: abiertas.map((w) => this.datos(w)).filter((d) => d.name)
    });
    this.todos({ t: "entra", name: q.name, pj }, par[1]);
    await this.avisarLobby();
    return new Response(null, { status: 101, webSocket: par[0] });
  }
  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > 2e3) return;
    let m;
    try {
      m = JSON.parse(raw);
    } catch (e) {
      return;
    }
    const yo = this.datos(ws);
    if (!yo.name) return;
    const num = /* @__PURE__ */ __name((v) => typeof v === "number" && isFinite(v) ? Math.round(v * 100) / 100 : 0, "num");
    if (m.t === "pos") {
      const d = { name: yo.name, pj: yo.pj, x: num(m.x), y: num(m.y), z: num(m.z), yaw: num(m.yaw) };
      ws.serializeAttachment(d);
      this.todos({ t: "pos", ...d }, ws);
    } else if (m.t === "bloque") {
      const i = m.i | 0, b = m.b | 0;
      if (i < 0 || i >= TOTAL || b < 0 || b > 7) return;
      this.sql.exec("INSERT INTO cambios (i, b) VALUES (?, ?) ON CONFLICT(i) DO UPDATE SET b = excluded.b", i, b);
      this.todos({ t: "bloque", i, b }, ws);
    } else if (m.t === "chat") {
      const txt = String(m.txt || "").trim().slice(0, 120);
      if (txt) this.todos({ t: "chat", name: yo.name, txt });
    }
  }
  async webSocketClose(ws) {
    const n = this.datos(ws).name;
    try {
      ws.close();
    } catch (e) {
    }
    if (n) this.todos({ t: "sale", name: n }, ws);
    await this.avisarLobby(ws);
  }
  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
};
var tablaLista = false;
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
__name(asegurarTabla, "asegurarTabla");
async function apiMundos(req, env, url) {
  await asegurarTabla(env);
  const raw = url.pathname.slice("/api/mundos/".length);
  const nombre = url.pathname.length > "/api/mundos/".length ? decodeURIComponent(raw).trim().slice(0, 40) : "";
  if (!nombre) {
    if (req.method !== "GET") return json({ error: "M\xE9todo no permitido" }, 405);
    const { results } = await env.DB.prepare("SELECT nombre, actualizado FROM mundos ORDER BY actualizado DESC LIMIT 50").all();
    return json(results);
  }
  if (req.method === "GET") {
    const row = await env.DB.prepare("SELECT nombre, semilla, datos FROM mundos WHERE nombre = ?").bind(nombre).first();
    return row ? json(row) : json({ error: "No existe ese mundo" }, 404);
  }
  if (req.method === "PUT") {
    const body = await req.json();
    const semilla = Number(body.semilla);
    const cambios = body.cambios;
    if (!Number.isInteger(semilla) || !Array.isArray(cambios) || !cambios.every(Number.isInteger)) {
      return json({ error: "Datos inv\xE1lidos" }, 400);
    }
    const datos = JSON.stringify(cambios);
    if (datos.length > 1e6) return json({ error: "Mundo demasiado grande" }, 413);
    await env.DB.prepare(
      `INSERT INTO mundos (nombre, semilla, datos, actualizado) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(nombre) DO UPDATE SET semilla = excluded.semilla, datos = excluded.datos, actualizado = excluded.actualizado`
    ).bind(nombre, semilla, datos).run();
    return json({ ok: true });
  }
  return json({ error: "M\xE9todo no permitido" }, 405);
}
__name(apiMundos, "apiMundos");

// ../../../tmp/claude-0/-home-claude/b0f9aba8-613b-5542-a325-ee5efdc6899b/scratchpad/wr/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../tmp/claude-0/-home-claude/b0f9aba8-613b-5542-a325-ee5efdc6899b/scratchpad/wr/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-zIGCFS/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../tmp/claude-0/-home-claude/b0f9aba8-613b-5542-a325-ee5efdc6899b/scratchpad/wr/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-zIGCFS/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  Lobby,
  Mundo,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
