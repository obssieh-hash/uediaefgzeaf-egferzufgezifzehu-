// Accounts, sessions and roles.
//
// Users live in data/users.json with a salted scrypt hash. While the file is
// empty, authentication is off (the console behaves as before) and the UI
// warns that it is open; adding the first user turns it on.
//
// Roles: "lecteur" reads, "analyste" also runs scans and triages findings,
// "admin" also manages users, schedules and settings.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ROLES = ["lecteur", "analyste", "admin"];
const SESSION_HOURS = 12;
const COOKIE = "ovc_session";

export const roleAtLeast = (role, min) => ROLES.indexOf(role) >= ROLES.indexOf(min);

function hash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

export function createAuth(dir) {
  const file = path.join(dir, "users.json");
  const sessions = new Map();
  const failures = new Map();

  const load = () => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return [];
    }
  };
  const store = (users) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(users, null, 2), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  };

  const enabled = () => load().length > 0;

  function addUser(username, password, role) {
    if (!/^[\w.@-]{2,40}$/.test(username)) throw new Error("Nom d'utilisateur invalide (2 à 40 caractères : lettres, chiffres, . _ - @)");
    if (!ROLES.includes(role)) throw new Error(`Rôle invalide (${ROLES.join(", ")})`);
    if (!password || password.length < 8) throw new Error("Mot de passe trop court (8 caractères minimum)");
    const users = load().filter((u) => u.username !== username);
    const salt = crypto.randomBytes(16).toString("hex");
    users.push({ username, role, salt, hash: hash(password, salt), created: new Date().toISOString() });
    store(users);
  }

  function removeUser(username) {
    const users = load();
    const left = users.filter((u) => u.username !== username);
    if (left.length === users.length) throw new Error("Utilisateur inconnu");
    if (users.some((u) => u.role === "admin") && !left.some((u) => u.role === "admin")) throw new Error("Impossible de supprimer le dernier administrateur");
    store(left);
    for (const [t, s] of sessions) if (s.username === username) sessions.delete(t);
  }

  function setRole(username, role) {
    if (!ROLES.includes(role)) throw new Error("Rôle invalide");
    const users = load();
    const u = users.find((x) => x.username === username);
    if (!u) throw new Error("Utilisateur inconnu");
    if (u.role === "admin" && role !== "admin" && users.filter((x) => x.role === "admin").length === 1) throw new Error("Il doit rester au moins un administrateur");
    u.role = role;
    store(users);
    for (const s of sessions.values()) if (s.username === username) s.role = role;
  }

  function login(username, password, ip) {
    const f = failures.get(ip) || { n: 0, at: 0 };
    if (f.n >= 5 && Date.now() - f.at < 60_000) throw new Error("Trop de tentatives, réessayez dans une minute");
    const u = load().find((x) => x.username === username);
    const ok = u && crypto.timingSafeEqual(Buffer.from(hash(password || "", u.salt), "hex"), Buffer.from(u.hash, "hex"));
    if (!ok) {
      failures.set(ip, { n: f.n + 1, at: Date.now() });
      throw new Error("Identifiants incorrects");
    }
    failures.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { username: u.username, role: u.role, exp: Date.now() + SESSION_HOURS * 3600_000 });
    return token;
  }

  function session(req) {
    if (!enabled()) return { username: "anonyme", role: "admin", open: true };
    const token = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const s = token && sessions.get(token);
    if (!s || s.exp < Date.now()) {
      if (token) sessions.delete(token);
      return null;
    }
    return { ...s, token };
  }

  return {
    enabled,
    addUser,
    removeUser,
    setRole,
    login,
    session,
    logout: (token) => sessions.delete(token),
    users: () => load().map(({ username, role, created }) => ({ username, role, created })),
    cookie: (token, secure) =>
      `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_HOURS * 3600 : 0}${secure ? "; Secure" : ""}`,
  };
}
