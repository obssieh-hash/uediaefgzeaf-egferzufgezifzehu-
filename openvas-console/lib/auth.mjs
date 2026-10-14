// Accounts, sessions and roles.
//
// Users live in data/users.json with a salted scrypt hash. While the file is
// empty, authentication is off (the console behaves as before) and the UI
// warns that it is open; adding the first user turns it on.
//
// Two-factor authentication (TOTP) is per account: once enabled, a login
// needs the password then a 6-digit code (or a one-time recovery code).
//
// Roles: "lecteur" reads, "analyste" also runs scans and triages findings,
// "admin" also manages users, schedules and settings.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hashCode, newSecret, otpauthUri, recoveryCodes, verify } from "./totp.mjs";

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
  const tickets = new Map(); // password OK, waiting for the second factor
  const pending = new Map(); // MFA enrolment not confirmed yet

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
    const users = load();
    const prev = users.find((u) => u.username === username);
    const salt = crypto.randomBytes(16).toString("hex");
    const next = { ...prev, username, role, salt, hash: hash(password, salt), created: prev?.created || new Date().toISOString() };
    store([...users.filter((u) => u.username !== username), next]);
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

  function throttle(ip) {
    const f = failures.get(ip) || { n: 0, at: 0 };
    if (f.n >= 5 && Date.now() - f.at < 60_000) throw new Error("Trop de tentatives, réessayez dans une minute");
    return () => failures.set(ip, { n: f.n + 1, at: Date.now() });
  }

  function checkPassword(username, password, ip) {
    const fail = throttle(ip);
    const u = load().find((x) => x.username === username);
    const ok = u && crypto.timingSafeEqual(Buffer.from(hash(password || "", u.salt), "hex"), Buffer.from(u.hash, "hex"));
    if (!ok) {
      fail();
      throw new Error("Identifiants incorrects");
    }
    failures.delete(ip);
    return u;
  }

  function openSession(u) {
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { username: u.username, role: u.role, exp: Date.now() + SESSION_HOURS * 3600_000 });
    return token;
  }

  // Step 1: password. Returns a session token, or a ticket when the account
  // has two-factor authentication.
  function login(username, password, ip) {
    const u = checkPassword(username, password, ip);
    if (u.mfa?.enabled) {
      const ticket = crypto.randomBytes(24).toString("hex");
      tickets.set(ticket, { username: u.username, exp: Date.now() + 5 * 60_000 });
      return { ticket };
    }
    return { token: openSession(u) };
  }

  // Checks a TOTP code or consumes a recovery code; updates the user record.
  function checkSecondFactor(username, code) {
    const users = load();
    const u = users.find((x) => x.username === username);
    if (!u?.mfa?.enabled) return false;
    const step = verify(u.mfa.secret, code, u.mfa.lastCounter ?? -1);
    if (step !== null) {
      u.mfa.lastCounter = step;
      store(users);
      return true;
    }
    const h = hashCode(code);
    const i = (u.mfa.recovery || []).indexOf(h);
    if (i >= 0) {
      u.mfa.recovery.splice(i, 1);
      store(users);
      return "recovery";
    }
    return false;
  }

  // Step 2: the 6-digit code (or a recovery code).
  function loginMfa(ticket, code, ip) {
    const fail = throttle(ip);
    const t = tickets.get(ticket);
    if (!t || t.exp < Date.now()) {
      tickets.delete(ticket);
      throw new Error("Session de connexion expirée, recommencez");
    }
    const ok = checkSecondFactor(t.username, code);
    if (!ok) {
      fail();
      throw new Error("Code de vérification incorrect");
    }
    failures.delete(ip);
    tickets.delete(ticket);
    const u = load().find((x) => x.username === t.username);
    return { token: openSession(u), username: u.username, usedRecovery: ok === "recovery", recoveryLeft: u.mfa.recovery?.length || 0 };
  }

  function mfaSetup(username) {
    const secret = newSecret();
    pending.set(username, { secret, exp: Date.now() + 10 * 60_000 });
    return { secret, uri: otpauthUri(secret, username) };
  }

  function mfaEnable(username, code) {
    const p = pending.get(username);
    if (!p || p.exp < Date.now()) throw new Error("Configuration expirée, recommencez");
    const step = verify(p.secret, code);
    if (step === null) throw new Error("Code incorrect : vérifiez l'heure du téléphone et réessayez");
    const codes = recoveryCodes();
    const users = load();
    const u = users.find((x) => x.username === username);
    if (!u) throw new Error("Utilisateur inconnu");
    u.mfa = { enabled: true, secret: p.secret, lastCounter: step, recovery: codes.map(hashCode), enabledAt: new Date().toISOString() };
    store(users);
    pending.delete(username);
    return codes;
  }

  function mfaDisable(username) {
    const users = load();
    const u = users.find((x) => x.username === username);
    if (!u) throw new Error("Utilisateur inconnu");
    delete u.mfa;
    store(users);
  }

  function session(req) {
    if (!enabled()) return { username: "anonyme", role: "admin", open: true };
    const token = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const s = token && sessions.get(token);
    if (!s || s.exp < Date.now()) {
      if (token) sessions.delete(token);
      return null;
    }
    const u = load().find((x) => x.username === s.username);
    return { ...s, token, mfa: !!u?.mfa?.enabled };
  }

  return {
    enabled,
    addUser,
    removeUser,
    setRole,
    login,
    loginMfa,
    checkPassword,
    checkSecondFactor,
    mfaSetup,
    mfaEnable,
    mfaDisable,
    session,
    logout: (token) => sessions.delete(token),
    users: () => load().map(({ username, role, created, mfa }) => ({ username, role, created, mfa: !!mfa?.enabled })),
    cookie: (token, secure) =>
      `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_HOURS * 3600 : 0}${secure ? "; Secure" : ""}`,
  };
}
