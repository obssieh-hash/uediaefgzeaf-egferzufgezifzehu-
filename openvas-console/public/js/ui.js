// Toasts, dialogs, drawers and small render helpers shared by the views.

import { esc, icon, $ } from "./util.js";

export function toast(title, detail = "", kind = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === "ok" ? "check" : kind === "error" ? "alert" : "info")}
    <div class="grow"><b>${esc(title)}</b>${detail ? `<small>${esc(detail)}</small>` : ""}</div>`;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), kind === "error" ? 6500 : 3800);
}

export const fail = (title) => (err) => toast(title, err?.message || String(err), "error");

function overlay(html, onClose) {
  const host = $("#overlay");
  host.innerHTML = html;
  const close = () => {
    host.innerHTML = "";
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", onKey);
  return { host, close };
}

export function confirmDialog({ title, body, confirm = "Confirmer", danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const { host, close } = overlay(
      `<div class="modal-back" data-close>
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-body"><h3>${esc(title)}</h3><p>${esc(body)}</p></div>
          <div class="modal-foot">
            <button class="btn" data-close>Annuler</button>
            <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(confirm)}</button>
          </div>
        </div>
      </div>`,
      () => !answered && resolve(false),
    );
    host.querySelector("[data-ok]").focus();
    host.onclick = (e) => {
      if (e.target.closest("[data-ok]")) {
        answered = true;
        close();
        resolve(true);
      } else if (e.target.matches("[data-close]")) close();
    };
  });
}

export function drawer(headHtml, bodyHtml) {
  const { host, close } = overlay(
    `<div class="drawer-back" data-close></div>
     <aside class="drawer" role="dialog" aria-modal="true">
       <div class="drawer-head"><div class="grow">${headHtml}</div>
         <button class="icon-btn sm" data-close aria-label="Fermer">${icon("x")}</button></div>
       <div class="drawer-body">${bodyHtml}</div>
     </aside>`,
  );
  host.onclick = (e) => {
    const c = e.target.closest("[data-copy]");
    if (c) copy(c.dataset.copy);
    else if (e.target.closest("[data-close]")) close();
  };
  return { host, close };
}

export function palette(items, onPick) {
  const { host, close } = overlay(
    `<div class="modal-back" data-close>
      <div class="modal palette" role="dialog" aria-modal="true">
        <label class="input-icon">${icon("search")}<input class="input" placeholder="Aller à…" autocomplete="off" /></label>
        <ul></ul>
      </div>
    </div>`,
  );
  const input = host.querySelector("input");
  const ul = host.querySelector("ul");
  let shown = [];
  let index = 0;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    shown = items.filter((i) => !q || `${i.label} ${i.hint || ""}`.toLowerCase().includes(q)).slice(0, 40);
    index = Math.min(index, Math.max(0, shown.length - 1));
    let group = null;
    ul.innerHTML = shown.length
      ? shown
          .map((it, i) => {
            const head = it.group !== group ? `<li class="group">${esc((group = it.group))}</li>` : "";
            return `${head}<li data-i="${i}" class="${i === index ? "on" : ""}">${icon(it.icon)}<span class="ellipsis">${esc(it.label)}</span>${it.hint ? `<small class="mono">${esc(it.hint)}</small>` : ""}</li>`;
          })
          .join("")
      : `<li class="group">Aucun résultat</li>`;
  };
  const choose = (i) => {
    if (!shown[i]) return;
    close();
    onPick(shown[i]);
  };
  input.oninput = () => ((index = 0), render());
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") index = Math.min(shown.length - 1, index + 1);
    else if (e.key === "ArrowUp") index = Math.max(0, index - 1);
    else if (e.key === "Enter") return choose(index);
    else return;
    e.preventDefault();
    render();
    ul.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  };
  host.onclick = (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) choose(Number(li.dataset.i));
    else if (e.target.matches("[data-close]")) close();
  };
  render();
  input.focus();
}

export function jsonHtml(value) {
  return esc(JSON.stringify(value, null, 2)).replace(
    /(&quot;(?:[^&]|&(?!quot;))*&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
    (m, str, colon, bool, n) => {
      if (str) return colon ? `<span class="json-key">${str}</span>${colon}` : `<span class="json-str">${str}</span>`;
      if (bool) return `<span class="json-bool">${bool}</span>`;
      return `<span class="json-num">${n}</span>`;
    },
  );
}

export function empty(iconName, title, text, action = "") {
  return `<div class="empty"><div class="badge-ico">${icon(iconName)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
}

export const skeletonRows = (n = 4, h = 18) =>
  `<div class="card-body stack">${Array.from({ length: n }, (_, i) => `<div class="skeleton" style="height:${h}px;width:${90 - i * 12}%"></div>`).join("")}</div>`;

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copié dans le presse-papiers", text.length > 60 ? "" : text);
  } catch {
    toast("Copie impossible", "Le presse-papiers n'est pas accessible", "error");
  }
}
