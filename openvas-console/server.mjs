#!/usr/bin/env node
// Sentrovyx — vulnerability management console for openvasd (OpenVAS scanner).
//
// Serves the UI, forwards /api/* to openvasd (openvasd sends no CORS headers,
// and the API key / client certificate stay on the server), and adds what a
// security team needs on top of the scanner: accounts and roles, shared
// triage and remediation tracking, threat intelligence (CISA KEV, EPSS),
// scheduled scans, webhook alerts and an audit log.
//
// Zero dependencies:
//   node server.mjs                       start the console
//   node server.mjs user add <nom> <rôle> create an account (admin | analyste | lecteur)
//   node server.mjs user list | del <nom> | role <nom> <rôle>
//
// Environment:
//   PORT             port of the console              (default 8080)
//   HOST             bind address                     (default 127.0.0.1)
//   OPENVASD_URL     base URL of openvasd             (default http://127.0.0.1:3000)
//   OPENVASD_API_KEY X-API-KEY added to every request (optional)
//   OPENVASD_CERT    client certificate (PEM) for mTLS (optional)
//   OPENVASD_KEY     client key (PEM) for mTLS         (optional)
//   OPENVASD_CA      CA bundle (PEM) of openvasd       (optional)
//   CACHE_DIR        VT catalogue cache                (default ./cache)
//   DATA_DIR         team data, accounts, audit log    (default ./data)
//   LOGIN_MAX_ATTEMPTS failed logins per IP before a 1-minute lock (default 5, 0 = off)
//   ZAP_URL          OWASP ZAP daemon URL for web scans (optional)
//   ZAP_API_KEY      ZAP API key                        (optional)

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createCatalog } from "./lib/catalog.mjs";
import { createState, DEFAULT_SLA } from "./lib/state.mjs";
import { createAuth, roleAtLeast, ROLES } from "./lib/auth.mjs";
import { createIntel } from "./lib/intel.mjs";
import { createAutomation, nextRun } from "./lib/automation.mjs";
import { createWebScan } from "./lib/webscan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "public");
const dataDir = process.env.DATA_DIR || path.join(here, "data");
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "127.0.0.1";
const upstream = new URL(process.env.OPENVASD_URL || "http://127.0.0.1:3000");
const apiKey = process.env.OPENVASD_API_KEY || "";
const isHttps = upstream.protocol === "https:";

const readOpt = (p) => (p ? fs.readFileSync(p) : undefined);
const tls = {
  cert: readOpt(process.env.OPENVASD_CERT),
  key: readOpt(process.env.OPENVASD_KEY),
  ca: readOpt(process.env.OPENVASD_CA),
};

const auth = createAuth(dataDir);

// ---- Command line: account management ------------------------------------------

// One readline for every question so piped input (echo pw | …) also works.
function prompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  let mute = false;
  const write = rl._writeToOutput?.bind(rl);
  if (write) rl._writeToOutput = (s) => (mute ? undefined : write(s));
  const lines = [];
  const waiting = [];
  rl.on("line", (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
  return {
    ask(question) {
      process.stdout.write(question);
      mute = true;
      return new Promise((resolve) => (lines.length ? resolve(lines.shift()) : waiting.push(resolve))).then((answer) => {
        mute = false;
        process.stdout.write("\n");
        return answer;
      });
    },
    close: () => rl.close(),
  };
}

if (process.argv[2] === "user") {
  const [, , , cmd, name, role] = process.argv;
  try {
    if (cmd === "add") {
      const p = prompter();
      const pass = await p.ask(`Mot de passe pour ${name} : `);
      const again = await p.ask("Confirmez : ");
      p.close();
      if (again !== pass) throw new Error("Les mots de passe ne correspondent pas");
      auth.addUser(name, pass, role || "analyste");
      console.log(`Compte « ${name} » (${role || "analyste"}) enregistré.`);
    } else if (cmd === "del") {
      auth.removeUser(name);
      console.log(`Compte « ${name} » supprimé.`);
    } else if (cmd === "mfa-reset") {
      auth.mfaDisable(name);
      console.log(`Double authentification de « ${name} » réinitialisée : le compte se connectera avec son seul mot de passe.`);
    } else if (cmd === "role") {
      auth.setRole(name, role);
      console.log(`« ${name} » est maintenant ${role}.`);
    } else {
      const users = auth.users();
      console.log(users.length ? users.map((u) => `${u.username.padEnd(24)} ${u.role.padEnd(10)} ${u.mfa ? "MFA" : ""}`).join("\n") : "Aucun compte : la console est ouverte sans connexion.");
      if (cmd !== "list") console.log(`\nUsage : node server.mjs user add <nom> <${ROLES.join("|")}> | del <nom> | role <nom> <rôle> | mfa-reset <nom> | list`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`Erreur : ${err.message}`);
    process.exit(1);
  }
}

// ---- openvasd access ------------------------------------------------------------------

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const headers = apiKey ? { "x-api-key": apiKey } : {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const out = (isHttps ? https : http).request(new URL(pathname, upstream), { method, headers, ...(isHttps ? tls : {}) }, resolve);
    out.on("error", reject);
    out.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function upstreamJson(method, pathname, body) {
  const res = await request(method, pathname, body);
  let text = "";
  res.setEncoding("utf8");
  for await (const chunk of res) text += chunk;
  if (res.statusCode >= 400) throw new Error(`openvasd ${res.statusCode} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const state = createState(dataDir);
const catalog = createCatalog({ cacheDir: process.env.CACHE_DIR || path.join(here, "cache"), request });
const intel = createIntel(dataDir);
const automation = createAutomation({ state, catalog, request, json: upstreamJson });
// Web application scanning (OWASP ZAP), when a ZAP daemon is configured.
const webscan = createWebScan({ url: process.env.ZAP_URL || "", apiKey: process.env.ZAP_API_KEY || "", state, notify: (text, sum) => automation.notify(text, sum) });

// ---- HTTP helpers -----------------------------------------------------------------------

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-cache", ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 60e6) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("Requête trop volumineuse"), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const buf = await readBody(req);
  return buf.length ? JSON.parse(buf.toString("utf8")) : null;
}

const clientIp = (req) => req.socket.remoteAddress || "?";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function need(user, role) {
  if (!roleAtLeast(user.role, role)) throw new HttpError(403, `Action réservée au rôle ${role} ou supérieur`);
}

// ---- Proxy to openvasd ----------------------------------------------------------------------

async function proxy(req, res, user) {
  const write = req.method !== "GET" && req.method !== "HEAD";
  if (write) need(user, "analyste");
  const target = new URL(req.url.replace(/^\/api/, "") || "/", upstream);
  const headers = { ...req.headers, host: upstream.host };
  for (const h of ["origin", "referer", "cookie"]) delete headers[h];
  if (apiKey) headers["x-api-key"] = apiKey;
  const body = write ? await readBody(req) : null;
  if (body) headers["content-length"] = body.length;

  const out = (isHttps ? https : http).request(target, { method: req.method, headers, ...(isHttps ? tls : {}) }, (up) => {
    res.writeHead(up.statusCode || 502, { ...up.headers, "access-control-expose-headers": "api-version, feed-version, authentication" });
    if (!write || up.statusCode >= 400) return up.pipe(res);
    // Record scan creation / start / stop / deletion in the audit log.
    let text = "";
    up.on("data", (c) => {
      text += c;
      res.write(c);
    });
    up.on("end", () => {
      res.end();
      const m = target.pathname.match(/^\/scans(?:\/([\w-]+))?$/);
      if (!m) return;
      let action = req.method === "DELETE" ? "scan.delete" : "scan.create";
      let scan = m[1];
      if (m[1] && req.method === "POST") {
        try {
          action = `scan.${JSON.parse(body.toString()).action}`;
        } catch {
          action = "scan.action";
        }
      }
      if (!m[1]) {
        try {
          scan = JSON.parse(text);
        } catch {
          /* id unknown */
        }
      }
      if (action === "scan.delete") state.put("labels", m[1], null);
      state.audit(user.username, action, scan);
    });
  });
  out.on("error", (err) => {
    if (res.headersSent) return res.destroy();
    json(res, 502, { error: "openvasd unreachable", detail: err.message });
  });
  out.end(body || undefined);
}

// ---- Console API -----------------------------------------------------------------------------

// Accounts without a second factor in an organisation that requires one may
// only enrol (and sign out) until they do.
const mfaRequired = (user) => !user.open && !!state.get().settings.requireMfa && !user.mfa;

const MAP_NAMESPACES = { labels: "analyste", triage: "analyste", assets: "analyste" };

function publicState(user) {
  const s = state.get();
  return {
    labels: s.labels,
    triage: s.triage,
    assets: s.assets,
    events: s.events.slice(0, 50),
    settings: {
      sla: s.settings.sla || DEFAULT_SLA,
      requireMfa: !!s.settings.requireMfa,
      webhook: roleAtLeast(user.role, "admin") ? s.settings.webhook : s.settings.webhook ? "configuré" : "",
    },
  };
}

function schedulesView() {
  return state.get().schedules.map((s) => ({ ...s, config: undefined, targets: s.config?.target?.hosts || [], next: s.enabled ? s.next || nextRun(s) : null }));
}

async function consoleApi(req, res, user) {
  const url = new URL(req.url, "http://x");
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // after "console"
  const [area, a, b] = parts;
  const M = req.method;

  if (area === "me" && M === "GET") {
    return json(res, 200, { username: user.username, role: user.role, authEnabled: !user.open, mfa: !!user.mfa, mfaRequired: mfaRequired(user) });
  }

  if (area === "me" && a === "mfa") {
    if (user.open) throw new HttpError(400, "Créez d'abord un compte : la double authentification s'applique aux comptes");
    const body = (await readJson(req)) || {};
    if (b === "setup" && M === "POST") return json(res, 200, auth.mfaSetup(user.username));
    if (b === "enable" && M === "POST") {
      const codes = auth.mfaEnable(user.username, body.code);
      state.audit(user.username, "mfa.enable", user.username);
      return json(res, 200, { recovery: codes });
    }
    if (b === "disable" && M === "POST") {
      if (state.get().settings.requireMfa) throw new HttpError(400, "La double authentification est obligatoire dans cette organisation");
      if (!auth.checkSecondFactor(user.username, body.code)) throw new HttpError(400, "Code de vérification incorrect");
      auth.mfaDisable(user.username);
      state.audit(user.username, "mfa.disable", user.username);
      return json(res, 200, { ok: true });
    }
  }

  if (area === "me" && a === "password" && M === "POST") {
    if (user.open) throw new HttpError(400, "Aucun compte n'est configuré");
    const { current, password } = (await readJson(req)) || {};
    auth.checkPassword(user.username, current, clientIp(req)); // throws when wrong
    auth.addUser(user.username, password, user.role);
    state.audit(user.username, "user.password", user.username);
    return json(res, 200, { ok: true });
  }

  if (area === "vts" && a === "status") {
    await catalog.ensure().catch(() => null);
    return json(res, 200, catalog.status());
  }
  if (area === "vts" && !a) {
    const map = await catalog.ensure();
    if (!map) return json(res, 503, catalog.status());
    if (M === "GET") return json(res, 200, [...map.values()]);
    const oids = (await readJson(req)) || [];
    return json(res, 200, oids.map((o) => map.get(o)).filter(Boolean));
  }

  // Re-scan one finding to confirm it is fixed.
  if (area === "verify" && M === "POST") {
    need(user, "analyste");
    const f = (await readJson(req)) || {};
    if (!f.key || !f.oid || !f.ip) throw new HttpError(400, "Vulnérabilité incomplète : oid et hôte requis");
    return json(res, 200, await automation.startVerification(f, user.username));
  }

  if (area === "intel" && M === "POST") {
    const { cves = [] } = (await readJson(req)) || {};
    return json(res, 200, await intel.lookup(cves));
  }

  // Evidence about the organisation itself, for the compliance page.
  if (area === "facts" && M === "GET") {
    const users = auth.users();
    const st = state.get();
    const audit = state.readAudit(5000);
    const monthAgo = Date.now() - 30 * 86_400_000;
    return json(res, 200, {
      authEnabled: auth.enabled(),
      users: users.length,
      roles: [...new Set(users.map((u) => u.role))],
      mfaUsers: users.filter((u) => u.mfa).length,
      adminsWithoutMfa: users.filter((u) => u.role === "admin" && !u.mfa).length,
      requireMfa: !!st.settings.requireMfa,
      schedules: st.schedules.filter((x) => x.enabled).length,
      webhook: !!st.settings.webhook,
      auditEvents30d: audit.filter((a) => Date.parse(a.at) > monthAgo).length,
      verifications: Object.values(st.triage).filter((t) => t.verification?.status === "verified").length,
      intel: intel.status(),
      catalog: catalog.status().state,
    });
  }

  if (area === "status" && M === "GET") {
    return json(res, 200, { catalog: catalog.status(), intel: intel.status(), authEnabled: auth.enabled(), users: auth.users().length });
  }

  if (area === "state") {
    if (M === "GET" && !a) return json(res, 200, publicState(user));
    if (M === "PUT" && MAP_NAMESPACES[a] && b) {
      need(user, MAP_NAMESPACES[a]);
      const key = decodeURIComponent(b);
      const value = await readJson(req);
      const prev = state.get()[a][key];
      state.put(a, key, value);
      const commented = (value?.comments?.length || 0) > (prev?.comments?.length || 0);
      const detail =
        a === "triage"
          ? {
              ...(prev?.state !== value?.state ? { from: prev?.state, to: value?.state } : {}),
              ...(prev?.owner !== value?.owner ? { owner: value?.owner } : {}),
              ...(prev?.due !== value?.due ? { due: value?.due } : {}),
              ...(commented ? { commentaire: value.comments.at(-1).text.slice(0, 120) } : {}),
            }
          : value;
      state.audit(user.username, `${a}.${value === null ? "delete" : "update"}`, key, detail);
      return json(res, 200, { ok: true });
    }
  }

  if (area === "settings" && M === "PUT") {
    need(user, "admin");
    const body = (await readJson(req)) || {};
    const s = state.get().settings;
    if (typeof body.webhook === "string") s.webhook = body.webhook.trim();
    if (typeof body.requireMfa === "boolean") s.requireMfa = body.requireMfa;
    if (body.sla) s.sla = Object.fromEntries(Object.entries(DEFAULT_SLA).map(([k, d]) => [k, Math.max(1, Number(body.sla[k]) || d)]));
    state.save();
    state.audit(user.username, "settings.update", "console", { webhook: !!s.webhook, sla: s.sla, requireMfa: !!s.requireMfa });
    return json(res, 200, { ok: true });
  }
  if (area === "settings" && a === "test-webhook" && M === "POST") {
    need(user, "admin");
    if (!state.get().settings.webhook) throw new HttpError(400, "Aucun webhook configuré");
    await automation.notify(`✅ Sentrovyx — test d'alerte envoyé par ${user.username}`, null);
    return json(res, 200, { ok: true });
  }

  if (area === "schedules") {
    const list = state.get().schedules;
    if (M === "GET") return json(res, 200, schedulesView());
    need(user, "analyste");
    if (M === "POST" && !a) {
      const body = await readJson(req);
      if (!body?.name || !body?.config?.target?.hosts?.length) throw new HttpError(400, "Nom et cibles requis");
      const s = {
        id: automation.newId(),
        name: String(body.name).slice(0, 120),
        frequency: ["daily", "weekly", "monthly"].includes(body.frequency) ? body.frequency : "weekly",
        time: /^\d{2}:\d{2}$/.test(body.time) ? body.time : "02:00",
        weekday: Number(body.weekday ?? 1),
        monthday: Math.min(28, Math.max(1, Number(body.monthday ?? 1))),
        enabled: body.enabled !== false,
        config: body.config,
        createdBy: user.username,
        createdAt: new Date().toISOString(),
      };
      s.next = nextRun(s);
      list.push(s);
      state.save();
      state.audit(user.username, "schedule.create", s.name);
      return json(res, 201, { id: s.id });
    }
    const s = list.find((x) => x.id === a);
    if (!s) throw new HttpError(404, "Planification introuvable");
    if (M === "POST" && b === "run") {
      const id = await automation.startScan(s, user.username);
      s.lastScan = id;
      s.lastRun = new Date().toISOString();
      state.save();
      return json(res, 200, { scan: id });
    }
    if (M === "PUT") {
      const body = (await readJson(req)) || {};
      for (const k of ["name", "frequency", "time", "weekday", "monthday", "enabled"]) if (k in body) s[k] = body[k];
      s.next = nextRun(s);
      state.save();
      state.audit(user.username, "schedule.update", s.name, { enabled: s.enabled });
      return json(res, 200, { ok: true });
    }
    if (M === "DELETE") {
      list.splice(list.indexOf(s), 1);
      state.save();
      state.audit(user.username, "schedule.delete", s.name);
      return json(res, 200, { ok: true });
    }
  }

  // Names of the analysts, to assign findings (any signed-in user).
  if (area === "members" && M === "GET") return json(res, 200, auth.users().map(({ username, role }) => ({ username, role })));

  if (area === "users") {
    need(user, "admin");
    if (M === "GET") return json(res, 200, auth.users());
    const body = (await readJson(req)) || {};
    if (M === "POST") {
      auth.addUser(body.username, body.password, body.role);
      state.audit(user.username, "user.create", body.username, { role: body.role });
      return json(res, 201, { ok: true });
    }
    const name = decodeURIComponent(a || "");
    if (M === "PUT") {
      if (body.role) auth.setRole(name, body.role);
      if (body.password) auth.addUser(name, body.password, body.role || auth.users().find((u) => u.username === name)?.role);
      if (body.resetMfa) auth.mfaDisable(name);
      state.audit(user.username, "user.update", name, { role: body.role, password: !!body.password, mfaReset: !!body.resetMfa });
      return json(res, 200, { ok: true });
    }
    if (M === "DELETE") {
      auth.removeUser(name);
      state.audit(user.username, "user.delete", name);
      return json(res, 200, { ok: true });
    }
  }

  if (area === "audit" && M === "GET") {
    need(user, "admin");
    return json(res, 200, state.readAudit(Number(url.searchParams.get("limit")) || 300));
  }

  // Web application scanning (OWASP ZAP).
  if (area === "webscan") {
    if (a === "status" && M === "GET") {
      return json(res, 200, await webscan.version().catch((err) => ({ enabled: webscan.enabled, error: err.message })));
    }
    if (!a && M === "GET") return json(res, 200, webscan.list());
    if (!a && M === "POST") {
      need(user, "analyste");
      if (!webscan.enabled) throw new HttpError(400, "Aucun serveur ZAP configuré : définissez ZAP_URL pour activer le scan web.");
      const body = (await readJson(req)) || {};
      if (!body.target) throw new HttpError(400, "Adresse du site requise");
      return json(res, 201, await webscan.start(body, user.username));
    }
    const id = decodeURIComponent(a || "");
    if (b === "alerts" && M === "GET") {
      const job = await webscan.status(id);
      return json(res, 200, await webscan.alerts(job.target));
    }
    if (b === "stop" && M === "POST") {
      need(user, "analyste");
      return json(res, 200, await webscan.stop(id, user.username));
    }
    if (!b && M === "GET") return json(res, 200, await webscan.status(id));
    if (!b && M === "DELETE") {
      need(user, "analyste");
      return json(res, 200, await webscan.remove(id, user.username));
    }
  }

  throw new HttpError(404, "Not found");
}

// ---- Static files -------------------------------------------------------------------------------

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  res.writeHead(200, {
    "content-type": mime[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  fs.createReadStream(file).pipe(res);
}

// ---- Router -----------------------------------------------------------------------------------------

async function handle(req, res) {
  const isApi = req.url.startsWith("/api/") || req.url === "/api";
  const isConsole = req.url.startsWith("/console/");
  if (!isApi && !isConsole) return serveStatic(req, res);

  try {
    if (req.url === "/console/login" && req.method === "POST") {
      const { username, password } = (await readJson(req)) || {};
      const out = auth.login(String(username || ""), String(password || ""), clientIp(req));
      if (out.ticket) return json(res, 200, { mfa: true, ticket: out.ticket });
      state.audit(username, "login", clientIp(req));
      return json(res, 200, { ok: true }, { "set-cookie": auth.cookie(out.token, req.headers["x-forwarded-proto"] === "https") });
    }
    if (req.url === "/console/login/mfa" && req.method === "POST") {
      const { ticket, code } = (await readJson(req)) || {};
      const out = auth.loginMfa(String(ticket || ""), String(code || ""), clientIp(req));
      state.audit(out.username, out.usedRecovery ? "login.recovery" : "login", clientIp(req), out.usedRecovery ? { codesRestants: out.recoveryLeft } : { mfa: true });
      return json(res, 200, { ok: true, usedRecovery: out.usedRecovery, recoveryLeft: out.recoveryLeft }, { "set-cookie": auth.cookie(out.token, req.headers["x-forwarded-proto"] === "https") });
    }
    const user = auth.session(req);
    if (req.url === "/console/logout" && req.method === "POST") {
      if (user?.token) auth.logout(user.token);
      return json(res, 200, { ok: true }, { "set-cookie": auth.cookie("", false) });
    }
    if (!user) return json(res, 401, { error: "Connexion requise" });
    if (mfaRequired(user) && !req.url.startsWith("/console/me")) return json(res, 403, { error: "Double authentification obligatoire : activez-la pour continuer", mfaSetup: true });
    // Writes must come from the console itself (simple CSRF guard on top of SameSite cookies).
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-requested-with"] !== "ovc") {
      throw new HttpError(403, "Requête refusée");
    }
    return isApi ? await proxy(req, res, user) : await consoleApi(req, res, user);
  } catch (err) {
    if (res.headersSent) return res.destroy();
    // 401 only for the login itself: elsewhere it would sign the user out.
    const status = err.status || (req.url.startsWith("/console/login") && /incorrects?|tentatives|expirée/.test(err.message) ? 401 : /incorrects?|tentatives|expirée/.test(err.message) ? 400 : /invalide|court|requis|dernier|rester|inconnu/i.test(err.message) ? 400 : 500);
    return json(res, status, { error: err.message });
  }
}

http.createServer(handle).listen(port, host, () => {
  console.log(`Sentrovyx        → http://${host}:${port}`);
  console.log(`openvasd backend → ${upstream.href}${apiKey ? " (API key injected)" : ""}`);
  if (webscan.enabled) console.log(`ZAP (scan web)   → ${process.env.ZAP_URL}`);
  console.log(auth.enabled() ? `Comptes : ${auth.users().length}` : "⚠ Aucun compte : la console est ouverte. Créez un administrateur : node server.mjs user add admin admin");
  catalog.ensure().catch((err) => console.error(`openvasd not reachable yet: ${err.message}`));
  intel.warm();
});
