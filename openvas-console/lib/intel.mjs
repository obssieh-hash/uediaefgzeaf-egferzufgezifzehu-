// Threat intelligence used to prioritise findings beyond their CVSS score:
//  - CISA KEV: CVEs known to be exploited in the wild (refreshed daily);
//  - FIRST EPSS: probability that a CVE is exploited in the next 30 days.
// Both are public feeds; when the VM has no Internet access the console
// simply shows no badge.

import fs from "node:fs";
import path from "node:path";

const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const EPSS_URL = "https://api.first.org/data/v1/epss";
const DAY = 86_400_000;

export function createIntel(dir) {
  const kevFile = path.join(dir, "kev.json");
  const epssFile = path.join(dir, "epss.json");
  let kev = null;
  let kevAt = 0;
  let kevLoading = null;
  let lastError = null;
  let epss = {};
  try {
    epss = JSON.parse(fs.readFileSync(epssFile, "utf8"));
  } catch {
    /* empty cache */
  }

  async function loadKev() {
    if (kev && Date.now() - kevAt < DAY) return kev;
    if (!kev) {
      try {
        const st = fs.statSync(kevFile);
        kev = JSON.parse(fs.readFileSync(kevFile, "utf8"));
        kevAt = st.mtimeMs;
        if (Date.now() - kevAt < DAY) return kev;
      } catch {
        /* no cache yet */
      }
    }
    kevLoading ||= (async () => {
      try {
        const res = await fetch(KEV_URL, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`CISA KEV HTTP ${res.status}`);
        const body = await res.json();
        const map = {};
        for (const v of body.vulnerabilities || []) {
          map[v.cveID] = {
            name: v.vulnerabilityName,
            product: `${v.vendorProject} ${v.product}`,
            added: v.dateAdded,
            due: v.dueDate,
            action: v.requiredAction,
            ransomware: v.knownRansomwareCampaignUse === "Known",
          };
        }
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(kevFile, JSON.stringify(map));
        kev = map;
        kevAt = Date.now();
        lastError = null;
      } catch (err) {
        lastError = `KEV : ${err.message}`;
        kevAt = Date.now() - DAY + 3600_000; // retry in an hour
      } finally {
        kevLoading = null;
      }
    })();
    await kevLoading;
    return kev || {};
  }

  async function loadEpss(cves) {
    const missing = cves.filter((c) => !epss[c] || Date.now() - epss[c].at > DAY);
    for (let i = 0; i < missing.length; i += 80) {
      const batch = missing.slice(i, i + 80);
      try {
        const res = await fetch(`${EPSS_URL}?cve=${batch.join(",")}`, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`EPSS HTTP ${res.status}`);
        const body = await res.json();
        const got = new Map((body.data || []).map((d) => [d.cve, d]));
        for (const c of batch) {
          const d = got.get(c);
          epss[c] = { at: Date.now(), score: d ? Number(d.epss) : null, percentile: d ? Number(d.percentile) : null };
        }
      } catch (err) {
        lastError = `EPSS : ${err.message}`;
        break;
      }
    }
    if (missing.length) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFile(epssFile, JSON.stringify(epss), () => {});
    }
  }

  return {
    async lookup(cves) {
      const list = [...new Set(cves.filter((c) => /^CVE-\d{4}-\d+$/.test(c)))].slice(0, 2000);
      const [k] = await Promise.all([loadKev(), loadEpss(list)]);
      const out = {};
      for (const c of list) {
        const e = epss[c];
        if (k[c] || e?.score != null) out[c] = { kev: k[c] || null, epss: e?.score ?? null, percentile: e?.percentile ?? null };
      }
      return out;
    },
    status: () => ({ kev: kev ? Object.keys(kev).length : 0, updated: kevAt ? new Date(kevAt).toISOString() : null, error: lastError }),
    warm: () => loadKev().catch(() => null),
  };
}
