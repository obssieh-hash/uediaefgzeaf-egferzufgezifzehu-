// Team data (scan names, finding triage and remediation, asset records,
// settings, events) and the signed-in user.
//
// With the console server it lives on the server so every analyst sees the
// same thing; in demo mode (or when the console is served by another web
// server) it falls back to this browser's storage.

const LOCAL_KEY = "ovc.team";
const DEFAULT_SLA = { critical: 7, high: 30, medium: 90, low: 180 };

let data = { labels: {}, triage: {}, assets: {}, events: [], settings: { sla: { ...DEFAULT_SLA }, webhook: "" } };
let remote = false;
let me = { username: "démo", role: "admin", authEnabled: false };
let members = [];
let revision = 0;

export class AuthError extends Error {}

function readLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY)) || {};
    // Earlier versions kept scan names and triage states separately.
    const oldLabels = JSON.parse(localStorage.getItem("ovc.scans") || "{}");
    const oldTriage = JSON.parse(localStorage.getItem("ovc.triage") || "{}");
    saved.labels = { ...oldLabels, ...(saved.labels || {}) };
    saved.triage = { ...Object.fromEntries(Object.entries(oldTriage).map(([k, v]) => [k, typeof v === "string" ? { state: v } : v])), ...(saved.triage || {}) };
    return saved;
  } catch {
    return {};
  }
}

function writeLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ labels: data.labels, triage: data.triage, assets: data.assets, settings: data.settings }));
  } catch {
    /* storage unavailable: kept for this tab only */
  }
}

export async function call(method, path, body) {
  const headers = { accept: "application/json" };
  if (method !== "GET") headers["x-requested-with"] = "ovc";
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
  const out = await res.json().catch(() => null);
  if (res.status === 401 && !path.endsWith("/login")) {
    window.dispatchEvent(new CustomEvent("ovc:auth"));
    throw new AuthError(out?.error || "Connexion requise");
  }
  if (!res.ok) throw Object.assign(new Error(out?.error || `Erreur HTTP ${res.status}`), { status: res.status, body: out });
  return out;
}

// Loads the user and the shared data. Throws AuthError when a login is needed.
export async function loadTeam(mode) {
  const local = readLocal();
  data = { ...data, ...local, settings: { ...data.settings, ...(local.settings || {}) } };
  if (mode === "demo") {
    remote = false;
    me = { username: "démo", role: "admin", authEnabled: false };
    members = [{ username: "démo", role: "admin" }, { username: "amina", role: "analyste" }, { username: "yacin", role: "analyste" }, { username: "direction", role: "lecteur" }];
    return me;
  }
  try {
    me = await call("GET", "/console/me");
  } catch (err) {
    if (err instanceof AuthError) throw err;
    // Not served by server.mjs: no accounts, no shared data.
    remote = false;
    me = { username: "local", role: "admin", authEnabled: false, standalone: true };
    return me;
  }
  remote = true;
  await refreshTeam();
  call("GET", "/console/members").then((m) => (members = m), () => null);
  return me;
}

export async function refreshTeam() {
  if (!remote) return false;
  const next = await call("GET", "/console/state");
  const changed = JSON.stringify(next) !== JSON.stringify(data);
  data = next;
  if (changed) revision++;
  return changed;
}

export const team = {
  get: (ns, key) => data[ns]?.[key],
  all: (ns) => data[ns] || {},
  events: () => data.events || [],
  settings: () => ({ sla: { ...DEFAULT_SLA, ...(data.settings?.sla || {}) }, webhook: data.settings?.webhook || "" }),
  async set(ns, key, value) {
    if (value === null) delete data[ns][key];
    else data[ns][key] = value;
    revision++;
    if (remote) await call("PUT", `/console/state/${ns}/${encodeURIComponent(key)}`, value);
    else writeLocal();
  },
  remote: () => remote,
  revision: () => revision,
};

export const currentUser = () => me;
export const teamMembers = () => members;

const RANK = { lecteur: 0, analyste: 1, admin: 2 };
export const can = (role) => RANK[me.role] >= RANK[role];

export async function login(username, password) {
  await call("POST", "/console/login", { username, password });
}

export async function logout() {
  await call("POST", "/console/logout").catch(() => null);
  location.reload();
}
