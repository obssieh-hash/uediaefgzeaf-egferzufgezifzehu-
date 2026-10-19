// Client de l'API exposée par server.py (passerelle vers openvasd).

async function call(method, path, body) {
  const res = await fetch("/api" + path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* corps vide */ }
  if (res.status === 401 && path !== "/login") { location.href = "/login.html"; throw new Error("Session expirée"); }
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

export const api = {
  get: (p) => call("GET", p),
  post: (p, b = {}) => call("POST", p, b),
  put: (p, b = {}) => call("PUT", p, b),
  del: (p) => call("DELETE", p),
};
