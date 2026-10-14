// Banner explaining why some findings have no name or CVSS score yet.

import { api } from "../api.js";
import { catalogState } from "../store.js";
import { esc, icon, num } from "../util.js";

export function catalogNotice(unscored) {
  if (!unscored || api().mode === "demo") return "";
  const st = catalogState();
  if (st?.state === "building") {
    return `<div class="banner">${icon("refresh", "spin")}<div class="grow"><b>Préparation du catalogue des tests</b> sur le serveur de la console${st.progress ? ` (${num(st.progress)} tests lus)` : ""}.
      Les noms, scores CVSS et solutions de ${num(unscored)} résultat${unscored > 1 ? "s" : ""} s'afficheront automatiquement d'ici quelques minutes.</div></div>`;
  }
  if (st?.state === "unavailable") {
    return `<div class="banner warn">${icon("alert")}<div class="grow"><b>${num(unscored)} résultat${unscored > 1 ? "s" : ""} sans score CVSS</b> : le catalogue des tests est indisponible (${esc(st.error || "")}).
      Lancez la console avec <span class="mono">server.mjs</span> pour qu'elle le prépare.</div></div>`;
  }
  if (st?.state === "ready") {
    return `<div class="banner">${icon("info")}<div class="grow">${num(unscored)} résultat${unscored > 1 ? "s" : ""} sans score CVSS : ces tests n'ont pas de vecteur de sévérité dans le feed.</div></div>`;
  }
  return "";
}
