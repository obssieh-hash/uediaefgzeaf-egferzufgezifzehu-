import { api } from "../api.js";
import { esc, icon, num } from "../util.js";
import { empty, fail, skeletonRows } from "../ui.js";

const SAMPLE = `openssl-3.0.11-1~deb12u1
libc6-2.36-9+deb12u3
openssh-server-1:9.2p1-2+deb12u1
curl-7.88.1-10+deb12u4
nginx-1.22.1-9
sudo-1.9.13p3-1+deb12u1`;

const fixedText = (f = {}) =>
  f.version ? `${f.specifier || ">="} ${f.version}` : f.start || f.end ? `${f.start || "…"} – ${f.end || "…"}` : "—";

export default async function notus(root) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Analyse de paquets</h1><p>Notus compare une liste de paquets installés aux avis de sécurité du système d'exploitation, sans scan réseau.</p></div>
    </div>
    <div class="grid g-main" style="grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)">
      <section class="card">
        <div class="card-head"><span class="step-num">${icon("package")}</span><div><h2>Inventaire</h2><div class="sub">Produit et paquets installés</div></div></div>
        <div class="card-body stack" id="form">${skeletonRows(3)}</div>
      </section>
      <section class="card" id="out">${empty("package", "Aucune analyse", "Choisissez un système, collez la liste des paquets (ex. sortie de dpkg-query ou rpm -qa) puis lancez l'analyse.")}</section>
    </div>`;

  let products = [];
  try {
    products = await api().notusProducts();
  } catch (err) {
    fail("Produits Notus indisponibles")(err);
  }
  root.querySelector("#form").innerHTML = `
    <label class="field"><span>Système d'exploitation</span>
      <input class="input" id="os" list="os-list" placeholder="debian_12" value="${esc(products.includes("debian_12") ? "debian_12" : products[0] || "")}" />
      <datalist id="os-list">${products.map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
      <small>${num(products.length)} produits pris en charge par le scanner.</small></label>
    <label class="field"><span>Paquets</span><textarea class="textarea" id="pkgs" rows="10" placeholder="nom-version, un par ligne">${esc(SAMPLE)}</textarea></label>
    <div class="row"><button class="btn btn-primary" id="run">${icon("search")}Analyser</button><span class="faint" id="pcount"></span></div>`;

  const pkgs = root.querySelector("#pkgs");
  const count = () => (root.querySelector("#pcount").textContent = `${pkgs.value.split("\n").filter((l) => l.trim()).length} paquets`);
  count();
  pkgs.oninput = count;

  root.querySelector("#run").onclick = async (e) => {
    const btn = e.currentTarget;
    const os = root.querySelector("#os").value.trim();
    const list = pkgs.value.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!os || !list.length) return fail("Analyse impossible")(new Error("Choisissez un produit et au moins un paquet."));
    btn.disabled = true;
    btn.innerHTML = `${icon("refresh", "spin")}Analyse…`;
    const out = root.querySelector("#out");
    out.innerHTML = skeletonRows(5, 20);
    try {
      const res = await api().notusRun(os, list);
      const entries = Object.entries(res);
      const affected = new Set(entries.flatMap(([, p]) => p.map((x) => x.name)));
      out.innerHTML = entries.length
        ? `<div class="card-head"><h2>${num(affected.size)} paquet${affected.size > 1 ? "s" : ""} vulnérable${affected.size > 1 ? "s" : ""}</h2>
            <span class="sub">${num(entries.length)} avis · ${num(list.length)} analysés</span>
            <div class="end"><span class="chip chip-danger">${Math.round((affected.size / list.length) * 100)} % exposés</span></div></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Paquet</th><th>Installé</th><th>Corrigé</th><th class="hide-sm">Avis (OID)</th></tr></thead><tbody>
          ${entries.flatMap(([oid, items]) => items.map((p) => `<tr>
            <td class="cell-title">${esc(p.name)}</td>
            <td><span class="tag mono" style="color:var(--danger)">${esc(p.installed_version)}</span></td>
            <td><span class="tag mono" style="color:var(--ok)">${esc(fixedText(p.fixed_version))}</span></td>
            <td class="hide-sm mono faint" style="font-size:12px">${esc(oid)}</td></tr>`)).join("")}
          </tbody></table></div>`
        : empty("check", "Aucune vulnérabilité connue", `Aucun des ${list.length} paquets n'est concerné par un avis de sécurité pour ${os}.`);
    } catch (err) {
      fail("Analyse impossible")(err);
      out.innerHTML = empty("alert", "Échec de l'analyse", err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon("search")}Analyser`;
    }
  };
}
