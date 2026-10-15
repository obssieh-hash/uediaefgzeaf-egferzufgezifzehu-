// Web application scanning with OWASP ZAP (https://www.zaproxy.org).
//
// openvasd finds flaws in the SERVER (service versions, TLS, open ports,
// known CVEs). It does not crawl a web application and test its pages for
// injection, XSS and the like. ZAP does exactly that, so Sentrovyx drives a
// ZAP daemon over its REST API to add a dynamic application scan (DAST).
//
// ZAP runs separately, in daemon mode, reachable over HTTP:
//   zap.sh -daemon -host 127.0.0.1 -port 8090 \
//          -config api.key=CHANGE_ME -config api.addrs.addr.name=127.0.0.1
// and the console is pointed at it with ZAP_URL / ZAP_API_KEY.
//
// A web scan runs in two phases: the spider crawls the site to discover its
// pages, then the active scanner attacks each one. The console tracks the job
// (phase, progress, the two ZAP scan ids) in the shared team state so every
// analyst sees it and it survives a console restart. A background tick drives
// each job forward (spider done -> start active scan) with no browser open,
// and posts a summary to the team webhook when a scan finishes.

// Risk levels ZAP reports, mapped to the console's severity keys and an
// indicative CVSS-like score so web alerts sit on the same scale as the
// network findings.
const RISK = [
  { zap: "High", code: 3, key: "high", label: "Élevée", score: 8 },
  { zap: "Medium", code: 2, key: "medium", label: "Moyenne", score: 5 },
  { zap: "Low", code: 1, key: "low", label: "Faible", score: 3 },
  { zap: "Informational", code: 0, key: "none", label: "Information", score: null },
];
const riskByCode = (c) => RISK.find((r) => r.code === Number(c)) || RISK[3];

export function createWebScan({ url, apiKey, state, notify, log = console, fetchImpl = fetch }) {
  const base = (url || "").replace(/\/$/, "");
  const enabled = !!base;

  // Every ZAP API call is a GET with the api key and parameters in the query
  // string; the JSON views return an object, the actions return {scan} / {Result}.
  async function zap(component, type, name, params = {}) {
    if (!enabled) throw new Error("Aucun serveur ZAP configuré (variable ZAP_URL)");
    const q = new URLSearchParams({ ...(apiKey ? { apikey: apiKey } : {}), ...params });
    const target = `${base}/JSON/${component}/${type}/${name}/?${q}`;
    let res;
    try {
      res = await fetchImpl(target, { signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      throw new Error(`ZAP injoignable : ${err.message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`ZAP HTTP ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  }

  const jobs = () => state.get().webscans;
  const save = (id, job) => state.put("webscans", id, job);

  async function version() {
    if (!enabled) return { enabled: false };
    const v = await zap("core", "view", "version");
    return { enabled: true, version: v.version };
  }

  // Normalise a user-typed target into a URL ZAP accepts (adds http:// when no
  // scheme is given); throws on anything that is not an http(s) address.
  function normalizeUrl(raw) {
    const t = String(raw || "").trim();
    if (!t) throw new Error("Indiquez l'adresse du site à analyser");
    const withScheme = /^https?:\/\//i.test(t) ? t : `http://${t}`;
    let u;
    try {
      u = new URL(withScheme);
    } catch {
      throw new Error(`Adresse invalide : ${raw}`);
    }
    if (!/^https?:$/.test(u.protocol)) throw new Error("Seules les adresses http:// et https:// sont acceptées");
    return u.toString();
  }

  // Deep mode: crawl further and attack harder. These are global ZAP options
  // (they apply to the default policy), each wrapped so an unknown id or an
  // older ZAP never aborts the scan.
  async function tuneDeep() {
    const quiet = (p) => p.catch(() => null);
    // Spider: go deep, follow every child, read comments and the sitemap /
    // robots file for hidden links.
    await quiet(zap("spider", "action", "setOptionMaxDepth", { Integer: "10" }));
    await quiet(zap("spider", "action", "setOptionMaxChildren", { Integer: "0" }));
    await quiet(zap("spider", "action", "setOptionThreadCount", { Integer: "5" }));
    await quiet(zap("spider", "action", "setOptionParseComments", { Boolean: "true" }));
    await quiet(zap("spider", "action", "setOptionParseSitemapXml", { Boolean: "true" }));
    await quiet(zap("spider", "action", "setOptionParseRobotsTxt", { Boolean: "true" }));
    // Active scan: enable every rule, attack at HIGH strength, report at LOW
    // threshold (more findings). Policy categories are ids 0..15.
    await quiet(zap("ascan", "action", "enableAllScanners", { scanPolicyName: "" }));
    for (let id = 0; id <= 15; id++) {
      await quiet(zap("ascan", "action", "setPolicyAttackStrength", { id: String(id), attackStrength: "HIGH", scanPolicyName: "" }));
      await quiet(zap("ascan", "action", "setPolicyAlertThreshold", { id: String(id), alertThreshold: "LOW", scanPolicyName: "" }));
    }
  }

  // Set up form-based authentication in ZAP so the crawl and the active scan
  // run as a logged-in user: a context, the login request, a user with the
  // given credentials, and forced-user mode. The password is used here only;
  // it is never stored on the job or in the shared state.
  async function setupAuth(job, auth) {
    const ctxName = `sentrovyx-${job.id.slice(0, 8)}`;
    const origin = new URL(job.target).origin;
    const ctx = await zap("context", "action", "newContext", { contextName: ctxName });
    const contextId = String(ctx.contextId ?? ctx.contextID ?? "");
    await zap("context", "action", "includeInContext", { contextName: ctxName, regex: `\\Q${origin}\\E.*` });
    const userField = auth.userField || "username";
    const passField = auth.passField || "password";
    const loginRequestData = `${userField}={%username%}&${passField}={%password%}`;
    const cfg = `loginUrl=${encodeURIComponent(auth.loginUrl)}&loginRequestData=${encodeURIComponent(loginRequestData)}`;
    await zap("authentication", "action", "setAuthenticationMethod", { contextId, authMethodName: "formBasedAuthentication", authMethodConfigParams: cfg });
    if (auth.loggedInRegex) await zap("authentication", "action", "setLoggedInIndicator", { contextId, loggedInIndicatorRegex: auth.loggedInRegex }).catch(() => null);
    const u = await zap("users", "action", "newUser", { contextId, name: auth.username || "user" });
    const userId = String(u.userId ?? u.userID ?? "");
    const creds = `username=${encodeURIComponent(auth.username)}&password=${encodeURIComponent(auth.password)}`;
    await zap("users", "action", "setAuthenticationCredentials", { contextId, userId, authCredentialsConfigParams: creds });
    await zap("users", "action", "setUserEnabled", { contextId, userId, enabled: "true" });
    await zap("forcedUser", "action", "setForcedUser", { contextId, userId }).catch(() => null);
    await zap("forcedUser", "action", "setForcedUserModeEnabled", { boolean: "true" }).catch(() => null);
    job.contextId = contextId;
    job.userId = userId;
    job.ctxName = ctxName;
    job.authUser = auth.username;
  }

  async function start({ name, target, mode = "active", recurse = true, ajax = false, deep = false, auth = null }, by) {
    const url = normalizeUrl(target);
    const id = crypto.randomUUID();
    // Deep mode always adds the AJAX spider: many sites render their links in
    // JavaScript, where the classic spider finds nothing to crawl.
    const useAjax = !!ajax || !!deep;
    const authed = auth && auth.loginUrl && auth.username ? auth : null;
    const job = {
      id,
      name: (name || url).slice(0, 120),
      target: url,
      mode: mode === "spider" ? "spider" : "active",
      ajax: useAjax,
      deep: !!deep,
      authenticated: !!authed,
      recurse: recurse !== false,
      phase: "spider",
      spiderScan: null,
      ascanScan: null,
      progress: 0,
      createdBy: by,
      startedAt: new Date().toISOString(),
      endedAt: null,
      error: null,
    };
    if (job.deep) await tuneDeep();
    if (authed) await setupAuth(job, authed);
    // Always start with the classic spider (as the logged-in user when
    // authenticated); the AJAX spider and the active scan follow in advance().
    const crawlOpts = { url, recurse: String(job.recurse), maxChildren: job.deep ? "0" : "10" };
    const out = authed
      ? await zap("spider", "action", "scanAsUser", { contextId: job.contextId, userId: job.userId, ...crawlOpts })
      : await zap("spider", "action", "scan", crawlOpts);
    job.spiderScan = String(out.scan ?? "");
    save(id, job);
    state.audit(by, "webscan.start", job.name, { target: url, mode: job.mode, deep: job.deep, authenticated: job.authenticated });
    return { id };
  }

  async function phaseProgress(job) {
    if (job.phase === "spider") {
      const st = await zap("spider", "view", "status", { scanId: job.spiderScan });
      const pct = Number(st.status) || 0;
      return { done: pct >= 100, pct };
    }
    if (job.phase === "ajax") {
      const st = await zap("ajaxSpider", "view", "status"); // "running" | "stopped"
      return { done: st.status !== "running", pct: st.status !== "running" ? 100 : 50 };
    }
    const st = await zap("ascan", "view", "status", { scanId: job.ascanScan });
    const pct = Number(st.status) || 0;
    return { done: pct >= 100, pct };
  }

  async function startActive(job) {
    const out = job.authenticated
      ? await zap("ascan", "action", "scanAsUser", { url: job.target, contextId: job.contextId, userId: job.userId, recurse: String(job.recurse), scanPolicyName: "" })
      : await zap("ascan", "action", "scan", { url: job.target, recurse: String(job.recurse), inScopeOnly: "false" });
    job.ascanScan = String(out.scan ?? "");
    job.phase = "active";
    job.progress = SPLIT.activeStart;
  }

  // Progress split depends on whether an AJAX crawl phase runs.
  const splitFor = (job) => (job.ajax ? { spiderMax: 30, ajaxMax: 45, activeStart: 45 } : { spiderMax: 45, ajaxMax: 45, activeStart: 45 });
  let SPLIT = { activeStart: 45 };

  // Move one running job forward: spider -> (ajax) -> active scan -> done.
  async function advance(job) {
    SPLIT = splitFor(job);
    const { done, pct } = await phaseProgress(job);
    if (job.phase === "spider") {
      job.progress = Math.min(SPLIT.spiderMax - 1, Math.round((pct / 100) * SPLIT.spiderMax));
      if (!done) return save(job.id, job);
      if (job.mode === "spider") return finish(job, "done");
      if (job.ajax) {
        if (job.authenticated) await zap("ajaxSpider", "action", "scanAsUser", { contextName: job.ctxName, userName: job.authUser, url: job.target }).catch(() => null);
        else await zap("ajaxSpider", "action", "scan", { url: job.target, inScope: "false" }).catch(() => null);
        job.phase = "ajax";
        job.progress = SPLIT.spiderMax;
        return save(job.id, job);
      }
      await startActive(job);
      return save(job.id, job);
    }
    if (job.phase === "ajax") {
      job.progress = SPLIT.spiderMax + Math.round((SPLIT.ajaxMax - SPLIT.spiderMax) * 0.5);
      if (!done) return save(job.id, job);
      await startActive(job);
      return save(job.id, job);
    }
    // Active scan runs from activeStart to 100.
    job.progress = Math.min(99, SPLIT.activeStart + Math.round((pct / 100) * (100 - SPLIT.activeStart)));
    if (done) return finish(job, "done");
    save(job.id, job);
  }

  async function finish(job, phase) {
    job.phase = phase;
    job.progress = 100;
    job.endedAt = new Date().toISOString();
    save(job.id, job);
    try {
      const sum = await summarize(job.target);
      state.event({ type: "webscan.finished", scan: job.id, name: job.name, status: "succeeded", total: sum.total, counts: sum.counts });
      const counts = RISK.map((r) => `${r.label} ${sum.counts[r.key] || 0}`).join(" · ");
      const text = `🕸️ Sentrovyx — scan web « ${job.name} » terminé\n${sum.total} alerte(s) sur ${job.target}\n${counts}`;
      if (notify) await notify(text, sum).catch(() => null);
    } catch (err) {
      log.error(`Web scan summary failed: ${err.message}`);
    }
  }

  async function alerts(target) {
    const out = await zap("core", "view", "alerts", { baseurl: target, start: "0", count: "0" });
    return (out.alerts || []).map((a) => {
      const r = riskByCode(a.riskcode);
      return {
        id: a.id,
        pluginId: a.pluginId,
        name: a.name || a.alert,
        risk: r.zap,
        level: r.key,
        score: r.score,
        confidence: Number(a.confidence) || 0,
        url: a.url,
        method: a.method,
        param: a.param,
        attack: a.attack,
        evidence: a.evidence,
        description: a.description,
        solution: a.solution,
        reference: a.reference,
        cweid: a.cweid,
        wascid: a.wascid,
      };
    });
  }

  async function summarize(target) {
    const list = await alerts(target);
    const counts = { high: 0, medium: 0, low: 0, none: 0 };
    for (const a of list) counts[a.level] = (counts[a.level] || 0) + 1;
    return { counts, total: list.length };
  }

  async function stop(id, by) {
    const job = jobs()[id];
    if (!job) throw Object.assign(new Error("Scan web introuvable"), { status: 404 });
    try {
      if (job.phase === "ajax") await zap("ajaxSpider", "action", "stop");
      else if (job.phase === "spider" && job.spiderScan != null) await zap("spider", "action", "stop", { scanId: job.spiderScan });
      else if (job.ascanScan != null) await zap("ascan", "action", "stop", { scanId: job.ascanScan });
    } catch (err) {
      log.error(`ZAP stop failed: ${err.message}`);
    }
    job.phase = "stopped";
    job.endedAt = new Date().toISOString();
    save(id, job);
    state.audit(by, "webscan.stop", job.name);
    return { ok: true };
  }

  async function remove(id, by) {
    const job = jobs()[id];
    if (!job) throw Object.assign(new Error("Scan web introuvable"), { status: 404 });
    if (["spider", "ajax", "active"].includes(job.phase)) await stop(id, by).catch(() => null);
    // Best effort: clear the alerts of this target from the ZAP session.
    try {
      await zap("core", "action", "deleteAlerts", {});
    } catch {
      /* older ZAP or disabled: leave the session as is */
    }
    save(id, null);
    state.audit(by, "webscan.delete", job.name);
    return { ok: true };
  }

  const list = () =>
    Object.entries(jobs())
      .map(([id, j]) => ({ ...j, id }))
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

  async function status(id) {
    const job = jobs()[id];
    if (!job) throw Object.assign(new Error("Scan web introuvable"), { status: 404 });
    return job;
  }

  // Drive running jobs forward even with no browser open.
  let busy = false;
  const tick = async () => {
    if (!enabled || busy) return;
    busy = true;
    try {
      for (const job of list()) {
        if (!["spider", "ajax", "active"].includes(job.phase)) continue;
        try {
          await advance(job);
        } catch (err) {
          job.error = err.message;
          job.phase = "error";
          job.endedAt = new Date().toISOString();
          save(job.id, job);
          log.error(`Web scan "${job.name}" failed: ${err.message}`);
        }
      }
    } finally {
      busy = false;
    }
  };
  if (enabled) {
    setInterval(tick, 10_000).unref();
    setTimeout(tick, 4_000).unref();
  }

  return { enabled, version, start, stop, remove, list, status, alerts, summarize, RISK };
}
