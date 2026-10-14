// Server-side automation that keeps running with no browser open:
//  - scheduled scans (daily / weekly / monthly) created and started through
//    the openvasd API;
//  - a watcher that notices finished scans, summarises them by severity and
//    posts the summary to the team's webhook (Slack, Teams, Discord, …).

import crypto from "node:crypto";

const SEVERITY = [
  ["critical", 9, "Critique"],
  ["high", 7, "Élevée"],
  ["medium", 4, "Moyenne"],
  ["low", 0.1, "Faible"],
];

// CVSS base score (v3.x or v2) of a vector; same formulas as the UI.
function cvss(vector) {
  if (!vector) return null;
  try {
    if (vector.startsWith("CVSS:3")) {
      const m = Object.fromEntries(vector.split("/").slice(1).map((p) => p.split(":")));
      const C = { H: 0.56, L: 0.22, N: 0 };
      const changed = m.S === "C";
      const PR = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR];
      const iss = 1 - (1 - C[m.C]) * (1 - C[m.I]) * (1 - C[m.A]);
      const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
      const expl = 8.22 * { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV] * { L: 0.77, H: 0.44 }[m.AC] * PR * { N: 0.85, R: 0.62 }[m.UI];
      if (impact <= 0) return 0;
      const raw = Math.min(changed ? 1.08 * (impact + expl) : impact + expl, 10);
      return Math.ceil(raw * 10 - 1e-9) / 10;
    }
    const m = Object.fromEntries(vector.split("/").map((p) => p.split(":")));
    const CIA = { N: 0, P: 0.275, C: 0.66 };
    const impact = 10.41 * (1 - (1 - CIA[m.C]) * (1 - CIA[m.I]) * (1 - CIA[m.A]));
    const expl = 20 * { L: 0.395, A: 0.646, N: 1 }[m.AV] * { H: 0.35, M: 0.61, L: 0.71 }[m.AC] * { M: 0.45, S: 0.56, N: 0.704 }[m.Au];
    return Math.round((0.6 * impact + 0.4 * expl - 1.5) * (impact === 0 ? 0 : 1.176) * 10) / 10;
  } catch {
    return null;
  }
}

// Next run time (ms) after `from` for a schedule.
export function nextRun(s, from = Date.now()) {
  const [h, m] = (s.time || "02:00").split(":").map(Number);
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setHours(h, m);
  const advance = () => d.setDate(d.getDate() + 1);
  const matches = () =>
    (s.frequency !== "weekly" || d.getDay() === Number(s.weekday ?? 1)) &&
    (s.frequency !== "monthly" || d.getDate() === Number(s.monthday ?? 1));
  for (let i = 0; i < 400 && (d.getTime() <= from || !matches()); i++) advance();
  return d.getTime();
}

export function createAutomation({ state, catalog, request, json, log = console }) {
  const running = new Map(); // scan id -> last status

  async function startScan(schedule, by) {
    const created = await json("POST", "/scans", schedule.config);
    const id = typeof created === "string" ? created : created?.id;
    if (!id) throw new Error("openvasd n'a pas renvoyé d'identifiant de scan");
    const stamp = new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    state.put("labels", id, { name: `${schedule.name} · ${stamp}`, created: Math.floor(Date.now() / 1000), schedule: schedule.id });
    await json("POST", `/scans/${id}`, { action: "start" });
    running.set(id, "running");
    state.audit(by, "schedule.run", schedule.name, { scan: id });
    return id;
  }

  async function runDue() {
    const now = Date.now();
    for (const s of state.get().schedules) {
      if (!s.enabled) continue;
      s.next ||= nextRun(s, now - 60_000);
      if (s.next > now) continue;
      s.next = nextRun(s, now);
      try {
        s.lastScan = await startScan(s, "planificateur");
        s.lastRun = new Date().toISOString();
        s.lastError = null;
      } catch (err) {
        s.lastError = err.message;
        log.error(`Scheduled scan "${s.name}" failed: ${err.message}`);
      }
      state.save();
    }
  }

  async function summarize(id) {
    const results = (await json("GET", `/scans/${id}/results`)) || [];
    const map = await catalog.ensure().catch(() => null);
    const seen = new Set();
    const counts = { critical: 0, high: 0, medium: 0, low: 0, none: 0 };
    const top = [];
    for (const r of results) {
      if (r.type !== "alarm") continue;
      const key = `${r.oid}|${r.ip_address}|${r.port}|${r.protocol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const vt = map?.get(r.oid);
      const score = cvss(vt?.tag?.severity_vector || vt?.tag?.cvss_base_vector);
      const level = score == null ? "none" : SEVERITY.find(([, min]) => score >= min)?.[0] || "none";
      counts[level]++;
      top.push({ score: score ?? -1, name: vt?.name || r.oid, host: r.ip_address });
    }
    top.sort((a, b) => b.score - a.score);
    return { counts, total: seen.size, hosts: new Set(results.map((r) => r.ip_address).filter(Boolean)).size, top: top.slice(0, 3) };
  }

  async function notify(text, summary) {
    const url = state.get().settings.webhook;
    if (!url) return;
    // "text" is understood by Slack, Mattermost, Rocket.Chat and Teams
    // incoming webhooks; Discord reads "content".
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, content: text, summary }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
  }

  async function watch() {
    let ids = Object.keys(state.get().labels);
    try {
      const listed = await json("GET", "/scans");
      if (Array.isArray(listed)) ids = [...new Set([...ids, ...listed])];
    } catch {
      /* GET /scans disabled: watch the scans the console knows */
    }
    for (const id of ids) {
      const prev = running.get(id);
      if (prev && !["running", "requested"].includes(prev)) continue;
      let st;
      try {
        st = await json("GET", `/scans/${id}/status`);
      } catch {
        continue;
      }
      running.set(id, st.status);
      if (!prev || !["running", "requested"].includes(prev) || !["succeeded", "failed", "stopped"].includes(st.status)) continue;
      const name = state.get().labels[id]?.name || `Scan ${id.slice(0, 8)}`;
      try {
        const sum = await summarize(id);
        const verdict = { succeeded: "terminé", failed: "en échec", stopped: "arrêté" }[st.status];
        const counts = SEVERITY.map(([k, , l]) => `${l} ${sum.counts[k]}`).join(" · ");
        const text = `🛡️ OpenVAS — scan « ${name} » ${verdict}\n${sum.total} vulnérabilité(s) sur ${sum.hosts} hôte(s) : ${counts}${
          sum.top.length ? `\nPriorités : ${sum.top.map((t) => `${t.name} (${t.host}${t.score >= 0 ? `, CVSS ${t.score}` : ""})`).join(" ; ")}` : ""
        }`;
        state.event({ type: "scan.finished", scan: id, name, status: st.status, ...sum });
        await notify(text, sum);
      } catch (err) {
        log.error(`Scan summary / webhook failed: ${err.message}`);
      }
    }
  }

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runDue();
      await watch();
    } finally {
      busy = false;
    }
  };
  setInterval(tick, 60_000).unref();
  setTimeout(tick, 5_000).unref();

  return {
    startScan,
    notify,
    nextRun,
    newId: () => crypto.randomUUID(),
  };
}
