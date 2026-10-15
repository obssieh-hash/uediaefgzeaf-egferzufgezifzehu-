// In-browser simulation of openvasd, used by the demo mode. It follows the
// payloads documented in rust/api/components/examples so the UI renders the
// same data shapes it receives from a real scanner.

function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];
const now = () => Math.floor(Date.now() / 1000);
const uuid = () =>
  crypto.randomUUID?.() ||
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16),
  );

// [name, family, severity vector, cve]
const CATALOG = [
  ["OpenSSH < 9.8p1 Signal Handler Race Condition (regreSSHion)", "General", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H", "CVE-2024-6387"],
  ["Apache HTTP Server < 2.4.60 Multiple Vulnerabilities", "Web Servers", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", "CVE-2024-38476"],
  ["SSL/TLS: Report Weak Cipher Suites", "SSL and TLS", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N", ""],
  ["SSL/TLS: Deprecated TLSv1.0 and TLSv1.1 Protocol Detection", "SSL and TLS", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:N", "CVE-2011-3389"],
  ["SSL/TLS: Certificate Expired", "SSL and TLS", "AV:N/AC:L/Au:N/C:P/I:N/A:N", ""],
  ["Microsoft Windows SMBv1 Multiple Vulnerabilities (EternalBlue)", "Windows : Microsoft Bulletins", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H", "CVE-2017-0144"],
  ["Microsoft Remote Desktop Services RCE (BlueKeep)", "Windows : Microsoft Bulletins", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", "CVE-2019-0708"],
  ["PHP < 8.1.29 Multiple Vulnerabilities", "Web application abuses", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", "CVE-2024-4577"],
  ["jQuery < 3.5.0 Cross-Site Scripting (XSS)", "Web application abuses", "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N", "CVE-2020-11022"],
  ["HTTP Debugging Methods (TRACE/TRACK) Enabled", "Web application abuses", "AV:N/AC:M/Au:N/C:P/I:N/A:N", "CVE-2003-1567"],
  ["Cleartext Transmission of Sensitive Information via HTTP", "Web application abuses", "CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N", ""],
  ["FTP Unencrypted Cleartext Login", "FTP", "CVSS:3.1/AV:A/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N", ""],
  ["Anonymous FTP Login Reporting", "FTP", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N", "CVE-1999-0497"],
  ["MySQL / MariaDB Default Credentials", "Default Accounts", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", ""],
  ["SSH Brute Force Logins With Default Credentials", "Brute force attacks", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", ""],
  ["SNMP Agent Default Community Name (public)", "SNMP", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N", "CVE-1999-0517"],
  ["DCE/RPC and MSRPC Services Enumeration Reporting", "Windows", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N", ""],
  ["TCP Timestamps Information Disclosure", "General", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N", ""],
  ["ICMP Timestamp Reply Information Disclosure", "General", "CVSS:3.1/AV:L/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N", "CVE-1999-0524"],
  ["Debian: Security Advisory (DSA-5712-1) — ffmpeg", "Debian Local Security Checks", "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H", "CVE-2024-31578"],
  ["Debian: Security Advisory (DSA-5678-1) — glibc", "Debian Local Security Checks", "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", "CVE-2024-2961"],
  ["Debian: Security Advisory (DSA-5662-1) — xz-utils backdoor", "Debian Local Security Checks", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", "CVE-2024-3094"],
  ["Ubuntu: Security Advisory (USN-6880-1) — linux kernel", "Ubuntu Local Security Checks", "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", "CVE-2024-1086"],
  ["Nginx < 1.25.4 HTTP/3 QUIC Denial of Service", "Denial of Service", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H", "CVE-2024-24989"],
  ["Redis Server No Password", "Databases", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", ""],
  ["PostgreSQL < 16.3 SQL Injection Vulnerability", "Databases", "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", "CVE-2024-4317"],
  ["OS Detection Consolidation and Reporting", "Product detection", "", ""],
  ["Services (Banner Grabbing)", "Service detection", "", ""],
  ["OpenSSH Detection Consolidation", "Product detection", "", ""],
  ["Apache HTTP Server Detection Consolidation", "Product detection", "", ""],
  ["Traceroute", "General", "", ""],
  ["Host Summary", "General", "", ""],
  ["CPE Inventory", "Service detection", "", ""],
  ["SSL/TLS: Collect and Report Certificate Details", "SSL and TLS", "", ""],
  ["HTTP Server Banner Enumeration", "Web application abuses", "", ""],
  ["Determine OS and list of installed packages via SSH login", "Product detection", "", ""],
];

const SOLUTIONS = {
  VendorFix: "Mettre à jour le produit vers la dernière version corrigée fournie par l'éditeur.",
  Mitigation: "Désactiver le service ou restreindre son exposition réseau au strict nécessaire.",
  Workaround: "Appliquer la configuration de durcissement recommandée par l'éditeur.",
};

const VTS = CATALOG.map(([name, family, vector, cve], i) => {
  const oid = `1.3.6.1.4.1.25623.1.0.${(i * 7919 + 100003) % 900000}`;
  const solutionType = vector ? pick(rng(name), Object.keys(SOLUTIONS)) : undefined;
  return {
    oid,
    name,
    filename: `${family.toLowerCase().replace(/[^a-z]+/g, "_")}/${oid.split(".").pop()}.nasl`,
    family,
    category: vector ? "attack" : "gather_info",
    dependencies: [],
    references: cve ? [{ class: "cve", id: cve }] : [],
    preferences: [],
    tag: {
      ...(vector ? { severity_vector: vector } : {}),
      summary: vector
        ? `Le système cible est affecté par : ${name}.`
        : `Collecte d'informations : ${name}.`,
      ...(vector
        ? {
            insight: "La version détectée du produit contient une ou plusieurs failles publiquement documentées.",
            impact: "Un attaquant distant pourrait compromettre la confidentialité, l'intégrité ou la disponibilité du système.",
            solution: SOLUTIONS[solutionType],
            solution_type: solutionType,
          }
        : {}),
      qod_type: vector ? "remote_banner" : "remote_active",
      creation_date: 1600000000 + i * 1300000,
      last_modification: 1700000000 + i * 400000,
    },
  };
});

const VULNS = VTS.filter((v) => v.tag.severity_vector);
const INFOS = VTS.filter((v) => !v.tag.severity_vector);

const OSES = ["Debian GNU/Linux 12", "Ubuntu 22.04 LTS", "Windows Server 2019", "Rocky Linux 9.3", "Windows 11 Pro", "FreeBSD 14.0"];
const PORTS = [21, 22, 25, 53, 80, 110, 135, 139, 143, 161, 443, 445, 3306, 3389, 5432, 6379, 8080];

const PREFERENCES = [
  ["auto_enable_dependencies", "Automatic Enable Dependencies", "true", "Active automatiquement les VTs dont dépendent les VTs sélectionnés."],
  ["cgi_path", "CGI Path", "/cgi-bin:/scripts", "Chemins où rechercher les CGI par défaut (syntaxe identique à $PATH)."],
  ["checks_read_timeout", "Checks Read Timeout", "5", "Nombre de secondes d'attente lors d'un recv()."],
  ["non_simult_ports", "Non simultaneous ports", "139, 445, 3389, Services/irc", "Ports qui ne doivent pas être testés simultanément."],
  ["open_sock_max_attempts", "Maximum Attempts to open Sockets", "5", "Nombre d'échecs d'ouverture de socket avant de marquer l'hôte comme injoignable."],
  ["timeout_retry", "Socket timeout retry", "5", "Nombre de nouvelles tentatives après un délai d'attente de socket."],
  ["optimize_test", "Optimize Test", "true", "N'exécute un VT que si les services qu'il vise ont été détectés."],
  ["plugins_timeout", "Plugins Timeout", "320", "Durée maximale (s) d'exécution d'un VT."],
  ["report_host_details", "Report Host Details", "true", "Remonte les détails d'hôte (OS, CPE…) dans les résultats."],
  ["safe_checks", "Safe Checks", "true", "Désactive les tests susceptibles de perturber la cible."],
  ["scanner_plugins_timeout", "Scanner Plugin Timeout", "36000", "Durée maximale (s) des VTs de type scanner de ports."],
  ["time_between_request", "Time between request", "0", "Délai (ms) entre deux requêtes vers un même hôte."],
  ["unscanned_closed", "Close unscanned TCP Ports", "true", "Considère les ports TCP non scannés comme fermés."],
  ["unscanned_closed_udp", "Close unscanned UDP Ports", "true", "Considère les ports UDP non scannés comme fermés."],
  ["expand_vhosts", "Expand VHosts", "true", "Ajoute les hôtes virtuels découverts à la cible."],
  ["test_empty_vhost", "Test empty VHost", "false", "Teste aussi la cible sans nom d'hôte virtuel."],
  ["test_alive_hosts_only", "Test Alive Hosts Only", "true", "Ne scanne que les hôtes détectés comme actifs."],
  ["table_driven_lsc", "Table Driven LSC", "true", "Active les contrôles de sécurité locaux pilotés par tables (Notus)."],
  ["dry_run", "Dry Run", "false", "Simule le scan sans envoyer de paquets."],
  ["results_per_host", "Results per Host", "10", "Nombre de résultats factices par hôte en mode dry run."],
  ["max_mem_kb", "Maximum Memory (KB)", "0", "Limite mémoire du processus de scan (0 = illimité)."],
].map(([id, name, def, description]) => ({ id, name, default: def, description }));

const NOTUS_PRODUCTS = ["debian_10", "debian_11", "debian_12", "ubuntu_20.04", "ubuntu_22.04", "ubuntu_24.04", "rhel_8", "rhel_9", "rocky_9", "alpine_3.19", "suse_linux_enterprise_server_15-sp5"];

// ---- Target helpers ---------------------------------------------------------

function expandHosts(target, r) {
  const out = [];
  for (const entry of target.hosts || []) {
    const cidr = entry.match(/^(\d+\.\d+\.\d+)\.(\d+)\/(\d+)$/);
    const range = entry.match(/^(\d+\.\d+\.\d+)\.(\d+)-(\d+)$/);
    if (cidr) {
      const size = Math.min(2 ** (32 - Number(cidr[3])), 24);
      for (let i = 1; i <= size; i++) out.push(`${cidr[1]}.${i}`);
    } else if (range) {
      for (let i = Number(range[2]); i <= Math.min(Number(range[3]), Number(range[2]) + 23); i++) out.push(`${range[1]}.${i}`);
    } else out.push(entry);
  }
  const excluded = new Set(target.excluded_hosts || []);
  const hosts = out.filter((h) => !excluded.has(h));
  return { hosts, excluded: out.length - hosts.length, dead: hosts.filter((h) => rng(`${h}:dead`)() < 0.22) };
}

// Findings are seeded per host so two scans of the same target overlap; a
// later scan "drifts": some findings are fixed and a few new ones appear.
function buildResults(scan) {
  const drift = rng(`${scan.scan_id}:drift`);
  const { hosts, dead } = scan._plan;
  const deadSet = new Set(dead);
  const items = [];
  const push = (o) => items.push({ id: items.length, ...o });
  for (const ip of hosts.filter((h) => !deadSet.has(h))) {
    const r = rng(ip);
    const hostname = /^\d/.test(ip) ? `${pick(r, ["srv", "web", "db", "pc", "app", "mail"])}-${ip.split(".").pop()}.corp.local` : ip;
    push({ type: "host_start", ip_address: ip, hostname, message: new Date().toUTCString() });
    const os = pick(r, OSES);
    push({
      type: "host_detail", ip_address: ip, hostname, oid: INFOS[0].oid,
      detail: { name: "OS", value: os, source: { type: "nvt", name: INFOS[0].oid, description: INFOS[0].name } },
    });
    const n = 2 + Math.floor(r() * 7) + (drift() < scan._drift ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const vuln = r() < 0.6;
      const vt = pick(r, vuln ? VULNS : INFOS);
      const port = pick(r, PORTS);
      const protocol = r() < 0.9 ? "tcp" : "udp";
      const version = `${1 + Math.floor(r() * 9)}.${Math.floor(r() * 20)}.${Math.floor(r() * 9)}`;
      if (vuln && drift() < scan._drift) continue;
      push({
        type: vuln ? "alarm" : "log", ip_address: ip, hostname, oid: vt.oid, port, protocol,
        message: vuln
          ? `Version installée : ${version}\nVersion corrigée : voir l'avis de sécurité\nChemin / port : ${port}/${protocol}`
          : vt.tag.summary,
      });
    }
    if (r() < 0.15) push({ type: "error", ip_address: ip, hostname, protocol: "tcp", message: "NVT timed out after 320 seconds." });
    push({ type: "host_stop", ip_address: ip, hostname, message: new Date().toUTCString() });
  }
  return items;
}

// Vulnerable packages found in container images (demo): the same image
// always gives the same packages; older tags give more.
const PACKAGES = [
  ["openssl", "3.0.2-0ubuntu1.10", "3.0.2-0ubuntu1.15", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"],
  ["libc6", "2.35-0ubuntu3.1", "2.35-0ubuntu3.7", "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H"],
  ["zlib1g", "1:1.2.11.dfsg-2ubuntu9", "1:1.2.11.dfsg-2ubuntu9.2", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"],
  ["curl", "7.81.0-1ubuntu1.4", "7.81.0-1ubuntu1.16", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N"],
  ["libxml2", "2.9.13+dfsg-1build1", "2.9.13+dfsg-1ubuntu0.4", "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:N/A:H"],
  ["nginx", "1.21.6-1", "1.25.4-1", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"],
  ["perl-base", "5.34.0-3ubuntu1", "5.34.0-3ubuntu1.3", "CVSS:3.1/AV:L/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H"],
  ["libssh-4", "0.9.6-2build1", "0.9.6-2ubuntu0.22.04.3", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N"],
  ["tar", "1.34+dfsg-1build3", "1.34+dfsg-1ubuntu0.1.22.04.2", "CVSS:3.1/AV:L/AC:L/PR:N/UI:R/S:U/C:N/I:N/A:H"],
  ["git", "1:2.34.1-1ubuntu1.4", "1:2.34.1-1ubuntu1.11", "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H"],
];
const NOTUS_VTS = PACKAGES.map(([name, , , vector], i) => ({
  oid: `1.3.6.1.4.1.25623.1.1.12.2024.${6400 + i * 37}.1`,
  name: `Ubuntu: Security Advisory (USN-${6400 + i * 37}-1) — ${name}`,
  family: "Ubuntu Local Security Checks",
  category: "gather_info",
  references: [{ class: "cve", id: `CVE-2024-${21000 + i * 113}` }],
  tag: { severity_vector: vector, summary: `Le paquet ${name} de l'image est vulnérable.`, solution: `Reconstruire l'image avec une version corrigée de ${name}.`, solution_type: "VendorFix" },
}));
const containerScans = new Map();

// ---- Web application alerts (OWASP ZAP demo) --------------------------------
// [name, risk level, cweid, path, param, solution]
const WEB_ALERTS = [
  ["SQL Injection", "high", 89, "/registers.php", "id", "Utilisez des requêtes paramétrées (requêtes préparées) et validez les entrées côté serveur."],
  ["Cross Site Scripting (Reflected)", "high", 79, "/search.php", "q", "Échappez toute donnée renvoyée dans le HTML et appliquez une politique de sécurité du contenu (CSP)."],
  ["Path Traversal", "high", 22, "/download.php", "file", "Rejetez les séquences « ../ » et servez les fichiers depuis une liste blanche."],
  ["Cross Site Scripting (Persistent)", "high", 79, "/comments.php", "message", "Nettoyez et échappez les contenus stockés avant de les réafficher."],
  ["Absence of Anti-CSRF Tokens", "medium", 352, "/login.php", "", "Ajoutez un jeton anti-CSRF unique à chaque formulaire."],
  ["Content Security Policy (CSP) Header Not Set", "medium", 693, "/", "", "Définissez un en-tête Content-Security-Policy restrictif."],
  ["Missing Anti-clickjacking Header", "medium", 1021, "/", "", "Ajoutez l'en-tête Content-Security-Policy frame-ancestors (ou X-Frame-Options)."],
  ["Session ID in URL Rewrite", "medium", 200, "/account.php", "PHPSESSID", "Transmettez l'identifiant de session uniquement par un cookie Secure et HttpOnly."],
  ["Cookie Without Secure Flag", "low", 614, "/", "", "Ajoutez l'attribut Secure à tous les cookies de session."],
  ["Cookie Without HttpOnly Flag", "low", 1004, "/", "", "Ajoutez l'attribut HttpOnly aux cookies de session."],
  ["Server Leaks Version Information via Server HTTP Header", "low", 200, "/", "", "Masquez la bannière du serveur (directive ServerTokens)."],
  ["X-Content-Type-Options Header Missing", "low", 693, "/", "", "Ajoutez l'en-tête X-Content-Type-Options: nosniff."],
  ["Strict-Transport-Security Header Not Set", "low", 319, "/", "", "Ajoutez l'en-tête HSTS pour forcer HTTPS."],
  ["Information Disclosure - Suspicious Comments", "none", 200, "/js/app.js", "", "Retirez les commentaires sensibles du code livré en production."],
  ["Modern Web Application", "none", null, "/", "", "Information : l'application utilise beaucoup de JavaScript ; envisagez le spider AJAX."],
];
const webScans = new Map();

function webAlerts(target, severityBias = 1) {
  const r = rng(`${target}:web`);
  const origin = target.replace(/\/$/, "");
  const out = [];
  WEB_ALERTS.forEach(([name, level, cweid, path, param, solution], i) => {
    const keep = level === "high" ? 0.7 * severityBias : level === "medium" ? 0.8 : 0.9;
    if (r() > keep) return;
    out.push({
      id: String(i),
      pluginId: String(40000 + i),
      name,
      risk: { high: "High", medium: "Medium", low: "Low", none: "Informational" }[level],
      level,
      score: { high: 8, medium: 5, low: 3, none: null }[level],
      confidence: 2 + Math.floor(r() * 2),
      url: origin + path,
      method: param && level === "high" ? "GET" : "GET",
      param,
      attack: level === "high" && param ? `${param}=1' OR '1'='1` : "",
      evidence: level === "high" ? "Syntax error near ..." : "",
      description: `${name} détecté sur ${origin + path}${param ? ` (paramètre « ${param} »)` : ""}.`,
      solution,
      reference: "https://owasp.org/www-project-top-ten/",
      cweid: cweid == null ? "" : String(cweid),
      wascid: "",
    });
  });
  return out;
}

function containerResults(images) {
  const out = [];
  for (const image of images) {
    const r = rng(image);
    const digest = `sha256:${Array.from({ length: 64 }, () => Math.floor(r() * 16).toString(16)).join("")}`;
    const old = /:(1\.1|1\.2|20\.|18\.|latest)/.test(image) ? 0.75 : 0.35;
    PACKAGES.forEach(([name, installed, fixed], i) => {
      if (r() > old) return;
      out.push({
        id: out.length, type: "alarm", ip_address: digest, hostname: image, oid: NOTUS_VTS[i].oid,
        message: `Vulnerable package: ${name}\nInstalled version:  ${name}-${installed}\nFixed version:      >=${name}-${fixed}`,
      });
    });
  }
  return out;
}

// ---- Simulator --------------------------------------------------------------

export function createMock(labels) {
  const scans = new Map();
  const delay = (v, ms = 120 + Math.random() * 180) => new Promise((res) => setTimeout(() => res(v), ms));
  const fail = (status, message) => Promise.reject(Object.assign(new Error(message), { status }));

  function add(name, target, opts = {}) {
    const scan_id = opts.id || uuid();
    const scan = {
      scan_id,
      target: { ports: [{ range: [{ start: 1, end: 1024 }] }], alive_test_methods: ["icmp", "tcp_syn"], ...target },
      scan_preferences: opts.preferences || [],
      vts: opts.vts || VTS.slice(0, 8).map((v) => ({ oid: v.oid })),
      _status: opts.status || "stored",
      _start: opts.start,
      _end: opts.end,
      _duration: opts.duration || 75,
      _drift: opts.drift || 0,
    };
    scan._plan = expandHosts(scan.target, rng(scan_id));
    scan._results = buildResults(scan);
    scans.set(scan_id, scan);
    if (name) labels.set(scan_id, { name, created: opts.created || now(), demo: true });
    return scan;
  }

  // Seed a believable history.
  const t = now();
  add("Réseau interne — DMZ", { hosts: ["10.0.5.0/28"], excluded_hosts: ["10.0.5.14"] }, { id: "6c591f83-8f7b-452a-8c78-ba35779e682f", drift: 0.35, status: "succeeded", start: t - 86400 * 2, end: t - 86400 * 2 + 5420, created: t - 86400 * 2 - 60 });
  add("Réseau interne — DMZ", { hosts: ["10.0.5.0/28"], excluded_hosts: ["10.0.5.14"] }, { id: "1e2d3c4b-5a69-4788-9a1b-2c3d4e5f6a7b", status: "succeeded", start: t - 86400 * 12, end: t - 86400 * 12 + 5810, created: t - 86400 * 12 - 60 });
  add("Infra base de données", { hosts: ["10.30.1.1-6"] }, { id: "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d", status: "succeeded", start: t - 86400 * 20, end: t - 86400 * 20 + 2950, created: t - 86400 * 20 - 30 });
  add("Serveurs web production", { hosts: ["192.168.10.20-31"] }, { id: "b2c7a9e1-3f44-4c1d-9a0e-5d8e2f61c7a4", status: "running", start: t - 25, duration: 150, created: t - 30 });
  add("Postes Windows — Siège", { hosts: ["172.16.4.0/27"] }, { id: "0f3d1e72-8a5b-4e09-b1c4-7d2a6f90e3b8", created: t - 3600 });
  add("Audit SSH Debian", { hosts: ["10.20.0.10-15"], credentials: [{ service: "ssh", port: 22, up: { username: "audit", password: "•••" } }] }, { id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", status: "failed", start: t - 86400 * 5, end: t - 86400 * 5 + 840, created: t - 86400 * 5 - 30 });
  add("Infra base de données", { hosts: ["10.30.1.1-6"] }, { id: "d4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70", drift: 0.3, status: "succeeded", start: t - 86400 * 9, end: t - 86400 * 9 + 2710, created: t - 86400 * 9 - 30 });

  // A finished container image scan, so the Docker page is not empty.
  const demoImages = "5f1c2a90-7d3e-4b8a-9c61-2e0d4f8a1b37";
  containerScans.set(demoImages, { images: ["oci://docker.io/library/nginx:1.21", "oci://docker.io/library/ubuntu:20.04", "oci://registry.corp.local/app/api:2.4.1"], started: Date.now() - 3600_000 });
  labels.set(demoImages, { name: "Images de production", kind: "container", images: 3, imagesList: containerScans.get(demoImages).images, created: t - 3700, demo: true });

  // A finished web application scan, so the web scan page is not empty.
  webScans.set("3b9d7e42-1a6c-4f80-9b25-7c0e1d2a4f68", {
    id: "3b9d7e42-1a6c-4f80-9b25-7c0e1d2a4f68", name: "Portail client", target: "https://www.exemple-client.fr/",
    mode: "active", ajax: false, recurse: true, phase: "done", progress: 100, spiderScan: "0", ascanScan: "0",
    createdBy: "amina", startedAt: new Date(Date.now() - 5400_000).toISOString(), endedAt: new Date(Date.now() - 4800_000).toISOString(), error: null, _started: 0,
  });

  function state(scan) {
    const { hosts, dead, excluded } = scan._plan;
    const all = hosts.length + excluded;
    const alive = hosts.length - dead.length;
    if (scan._status === "stored") return { status: "stored" };
    let frac = 1;
    if (scan._status === "running") {
      frac = Math.min(1, (now() - scan._start) / scan._duration);
      if (frac >= 1) {
        scan._status = "succeeded";
        scan._end = scan._start + scan._duration;
      }
    } else if (scan._status !== "succeeded") frac = scan._frac ?? 0.6;
    const finished = Math.floor(alive * frac);
    const scanning = {};
    if (scan._status === "running") {
      const live = hosts.filter((h) => !dead.includes(h)).slice(finished, finished + 3);
      live.forEach((h, i) => (scanning[h] = Math.max(5, Math.round(((alive * frac - finished) * 100) / (i + 1)) % 100)));
    }
    return {
      status: scan._status,
      start_time: scan._start,
      ...(scan._end ? { end_time: scan._end } : {}),
      host_info: {
        all, excluded, dead: Math.round(dead.length * Math.min(1, frac * 1.6)), alive,
        queued: scan._status === "running" ? Math.max(0, alive - finished - Object.keys(scanning).length) : 0,
        finished, ...(Object.keys(scanning).length ? { scanning } : {}),
      },
      _frac: frac,
    };
  }

  function visibleResults(scan) {
    const s = state(scan);
    if (s.status === "stored") return [];
    return scan._results.slice(0, Math.floor(scan._results.length * (s._frac ?? 1)));
  }

  const strip = ({ _status, _start, _end, _duration, _plan, _results, _frac, ...pub }) => pub;
  const get = (id) => scans.get(id) || null;

  return {
    mode: "demo",
    info: () => delay({ apiVersion: "1", feedVersion: "202610140612", auth: "api-key, certificate", alive: true, ready: true }),
    listScans: () => delay([...scans.keys()]),
    getScan: (id) => (get(id) ? delay(strip(get(id))) : fail(404, "Scan introuvable")),
    getStatus(id) {
      const s = get(id);
      if (!s) return fail(404, "Scan introuvable");
      const { _frac, ...st } = state(s);
      return delay(st, 60);
    },
    getResults(id, from = 0) {
      const s = get(id);
      return s ? delay(visibleResults(s).slice(from), 80) : fail(404, "Scan introuvable");
    },
    createScan(body) {
      if (!body?.target?.hosts?.length) return fail(400, "Requête invalide : aucun hôte cible");
      const scan = add(null, body.target, { vts: body.vts, preferences: body.scan_preferences, duration: 60 + Math.random() * 60, drift: 0.25 });
      return delay(scan.scan_id, 300);
    },
    action(id, action) {
      const s = get(id);
      if (!s) return fail(404, "Scan introuvable");
      if (action === "start") {
        if (s._status !== "stored") return fail(409, "Seul un scan enregistré peut être démarré");
        Object.assign(s, { _status: "running", _start: now() });
      } else if (action === "stop") {
        const st = state(s);
        if (st.status !== "running") return fail(409, "Seul un scan en cours peut être arrêté");
        Object.assign(s, { _status: "stopped", _end: now(), _frac: st._frac });
      } else return fail(400, "Action inconnue");
      return delay(null, 250);
    },
    deleteScan(id) {
      const s = get(id);
      if (!s) return fail(404, "Scan introuvable");
      if (state(s).status === "running") return fail(409, "Un scan en cours ne peut pas être supprimé");
      scans.delete(id);
      return delay(null);
    },
    preferences: () => delay(PREFERENCES),
    vts: () => delay([...VTS, ...NOTUS_VTS], 400),
    oids: () => delay(VTS.map((v) => v.oid), 200),
    containers: {
      create(body) {
        const id = uuid();
        containerScans.set(id, { images: body.target.hosts, started: 0 });
        return delay(id, 300);
      },
      action(id, action) {
        const c = containerScans.get(id);
        if (!c) return fail(404, "Scan introuvable");
        if (action === "start") c.started = Date.now();
        if (action === "stop") c.stopped = true;
        return delay(null);
      },
      status(id) {
        const c = containerScans.get(id);
        if (!c) return fail(404, "Scan introuvable");
        const t = (Date.now() - c.started) / 1000;
        const done = c.started && t > 8;
        const n = c.images.length;
        return delay({
          status: c.stopped ? "stopped" : !c.started ? "stored" : done ? "succeeded" : "running",
          start_time: c.started ? Math.floor(c.started / 1000) : undefined,
          end_time: done ? Math.floor(c.started / 1000) + 8 : undefined,
          host_info: { all: n, alive: n, finished: done ? n : Math.min(n, Math.floor((t / 8) * n)), dead: 0, excluded: 0, queued: 0 },
        }, 60);
      },
      results(id) {
        const c = containerScans.get(id);
        if (!c) return fail(404, "Scan introuvable");
        if (!c.started || (Date.now() - c.started) / 1000 <= 8) return delay([]);
        return delay(containerResults(c.images), 120);
      },
      remove: (id) => (containerScans.delete(id), delay(null)),
    },
    // Web application scanning (OWASP ZAP), simulated: a scan spiders then
    // actively tests; progress and phase advance with time.
    webscan: (() => {
      // Advance a live demo job's phase/progress from its start time.
      function tickJob(j) {
        if (!["spider", "active"].includes(j.phase)) return j;
        const elapsed = (Date.now() - j._started) / 1000;
        const spiderSecs = 6;
        const activeSecs = 14;
        if (elapsed < spiderSecs) {
          j.phase = "spider";
          j.progress = Math.min(49, Math.round((elapsed / spiderSecs) * 49));
        } else if (j.mode === "spider") {
          j.phase = "done";
          j.progress = 100;
          j.endedAt ||= new Date().toISOString();
        } else if (elapsed < spiderSecs + activeSecs) {
          j.phase = "active";
          j.ascanScan = "0";
          j.progress = Math.min(99, 50 + Math.round(((elapsed - spiderSecs) / activeSecs) * 49));
        } else {
          j.phase = "done";
          j.progress = 100;
          j.endedAt ||= new Date().toISOString();
        }
        return j;
      }
      const pub = ({ _started, ...j }) => j;
      return {
        status: () => delay({ enabled: true, version: "2.15.0 (démo)" }),
        list: () => delay([...webScans.values()].map(tickJob).map(pub).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))),
        get: (id) => (webScans.has(id) ? delay(pub(tickJob(webScans.get(id)))) : fail(404, "Scan web introuvable")),
        alerts(id) {
          const j = webScans.get(id);
          if (!j) return fail(404, "Scan web introuvable");
          tickJob(j);
          if (j.phase !== "done") return delay([]);
          return delay(webAlerts(j.target), 120);
        },
        create(body) {
          const id = uuid();
          let target = String(body.target || "").trim();
          if (!/^https?:\/\//i.test(target)) target = `http://${target}`;
          webScans.set(id, {
            id, name: (body.name || target).slice(0, 120), target, mode: body.mode === "spider" ? "spider" : "active",
            ajax: !!body.ajax, recurse: body.recurse !== false, phase: "spider", progress: 0, spiderScan: "0", ascanScan: null,
            createdBy: "démo", startedAt: new Date().toISOString(), endedAt: null, error: null, _started: Date.now(),
          });
          return delay({ id }, 300);
        },
        stop(id) {
          const j = webScans.get(id);
          if (!j) return fail(404, "Scan web introuvable");
          j.phase = "stopped";
          j.endedAt = new Date().toISOString();
          return delay({ ok: true });
        },
        remove: (id) => (webScans.delete(id) ? delay({ ok: true }) : fail(404, "Scan web introuvable")),
      };
    })(),
    vtLookup: (oids) => delay([...VTS, ...NOTUS_VTS].filter((v) => oids.includes(v.oid)), 80),
    // A few well-known CVEs of the demo catalogue are flagged as exploited
    // in the wild (CISA KEV) with an EPSS probability, like the live feeds.
    intel(cves) {
      const KEV = {
        "CVE-2024-6387": ["OpenSSH regreSSHion", "2024-07-01", false, 0.67],
        "CVE-2017-0144": ["Microsoft SMBv1 EternalBlue", "2022-02-10", true, 0.97],
        "CVE-2019-0708": ["Microsoft RDS BlueKeep", "2021-11-03", false, 0.96],
        "CVE-2024-3094": ["XZ Utils backdoor", "2024-03-29", false, 0.85],
        "CVE-2024-4577": ["PHP-CGI argument injection", "2024-06-12", true, 0.95],
        "CVE-2024-1086": ["Linux kernel use-after-free", "2024-05-30", true, 0.21],
      };
      const out = {};
      for (const c of cves) {
        const k = KEV[c];
        const r = rng(c)();
        out[c] = {
          kev: k ? { name: k[0], added: k[1], ransomware: k[2], due: k[1], action: "Appliquer les mises à jour selon les instructions de l'éditeur." } : null,
          epss: k ? k[3] : Math.round(r * r * 0.4 * 1000) / 1000,
          percentile: k ? 0.99 : Math.round(r * 1000) / 1000,
        };
      }
      return delay(out, 120);
    },
    catalogStatus: () => delay({ state: "ready", count: VTS.length, progress: VTS.length }),
    notusProducts: () => delay(NOTUS_PRODUCTS),
    notusRun(os, packages) {
      const r = rng(os + packages.join());
      const out = {};
      for (const pkg of packages) {
        if (r() < 0.45) continue;
        const m = pkg.match(/^(.+?)-(\d[\w.:~+]*)/);
        const name = m ? m[1] : pkg;
        const installed = m ? m[2] : "1.0.0";
        const fixed = installed.replace(/(\d+)(?!.*\d)/, (d) => String(Number(d) + 1 + Math.floor(r() * 3)));
        const oid = `1.3.6.1.4.1.25623.1.1.${2 + Math.floor(r() * 3)}.2024.${1000 + Math.floor(r() * 8999)}`;
        (out[oid] ||= []).push({ name, installed_version: installed, fixed_version: { version: fixed, specifier: ">=" } });
      }
      return delay(out, 500);
    },
  };
}
