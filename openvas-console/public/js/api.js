// Client for the openvasd HTTP API (rust/api/openapi.yml in openvas-scanner).
// The same interface is implemented by the in-browser simulator in mock.js,
// so every view works identically in demo and live mode.

import { createMock } from "./mock.js";

const SETTINGS_KEY = "ovc.settings";
const LABELS_KEY = "ovc.scans";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings live for this tab only */
  }
}

export const settings = {
  ...{ mode: null, base: "/api", apiKey: "", poll: 3, enrich: false },
  ...load(SETTINGS_KEY, {}),
};

export function saveSettings(patch) {
  const conn = ({ mode, base, apiKey }) => `${mode}|${base}|${apiKey}`;
  const before = conn(settings);
  Object.assign(settings, patch);
  save(SETTINGS_KEY, settings);
  if (conn(settings) !== before) backend = null;
}

// Scan names and creation dates are not part of the API: keep them locally.
export const labels = {
  all: () => load(LABELS_KEY, {}),
  get: (id) => load(LABELS_KEY, {})[id] || {},
  set(id, data) {
    const all = load(LABELS_KEY, {});
    all[id] = { ...all[id], ...data };
    save(LABELS_KEY, all);
  },
  remove(id) {
    const all = load(LABELS_KEY, {});
    delete all[id];
    save(LABELS_KEY, all);
  },
};

function createLive() {
  async function request(method, path, body) {
    const headers = { accept: "application/json" };
    if (settings.apiKey) headers["x-api-key"] = settings.apiKey;
    if (body !== undefined) headers["content-type"] = "application/json";
    let res;
    try {
      res = await fetch(settings.base.replace(/\/$/, "") + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new ApiError(0, `openvasd injoignable (${err.message})`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, describe(res.status, text));
    }
    const text = method === "HEAD" || res.status === 204 ? "" : await res.text();
    return { headers: res.headers, data: text ? JSON.parse(text) : null };
  }

  return {
    mode: "live",
    async info() {
      const head = await request("HEAD", "/health");
      const [alive, ready] = await Promise.all(
        ["/health/alive", "/health/ready"].map((p) =>
          request("GET", p).then(() => true, () => false),
        ),
      );
      return {
        apiVersion: head.headers.get("api-version") || "—",
        feedVersion: head.headers.get("feed-version") || "—",
        auth: head.headers.get("authentication") || "aucune",
        alive,
        ready,
      };
    },
    async listScans() {
      try {
        return (await request("GET", "/scans")).data || [];
      } catch (err) {
        // GET /scans is disabled unless openvasd runs with --enable-get-scans:
        // fall back to the scans created from this browser.
        if (err.status === 404 || err.status === 405) {
          return Object.entries(labels.all()).filter(([, l]) => !l.demo).map(([id]) => id);
        }
        throw err;
      }
    },
    getScan: async (id) => (await request("GET", `/scans/${id}`)).data,
    getStatus: async (id) => (await request("GET", `/scans/${id}/status`)).data,
    getResults: async (id, from = 0) =>
      (await request("GET", `/scans/${id}/results?range=${from}`)).data || [],
    createScan: async (body) => (await request("POST", "/scans", body)).data,
    action: (id, action) => request("POST", `/scans/${id}`, { action }),
    deleteScan: (id) => request("DELETE", `/scans/${id}`),
    preferences: async () => (await request("GET", "/scans/preferences")).data || [],
    vts: async () => (await request("GET", "/vts?information=1")).data || [],
    notusProducts: async () => (await request("GET", "/notus")).data || [],
    notusRun: async (os, packages) =>
      (await request("POST", `/notus/${encodeURIComponent(os)}`, packages)).data || {},
  };
}

function describe(status, body) {
  const known = {
    400: "Requête invalide",
    401: "Non autorisé — vérifiez la clé API ou le certificat client",
    404: "Ressource introuvable",
    409: "Action impossible dans l'état actuel du scan",
    502: "openvasd injoignable via le proxy",
    503: "Feed en cours de mise à jour, réessayez plus tard",
  };
  const detail = body && body.length < 300 ? ` : ${body}` : "";
  return `${known[status] || `Erreur HTTP ${status}`}${detail}`;
}

let backend = null;

export function api() {
  if (!backend) backend = settings.mode === "live" ? createLive() : createMock(labels);
  return backend;
}

// First visit: use the real scanner if one answers behind /api, else the demo.
export async function detectMode() {
  if (settings.mode) return settings.mode;
  try {
    const res = await fetch(`${settings.base}/health/alive`);
    saveSettings({ mode: res.ok ? "live" : "demo" });
  } catch {
    saveSettings({ mode: "demo" });
  }
  return settings.mode;
}
