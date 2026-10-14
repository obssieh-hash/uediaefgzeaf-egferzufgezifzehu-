// Two-factor authentication enrolment: QR code to scan with an
// authenticator app, confirmation code, then one-time recovery codes.

import { call } from "../team.js";
import { download, esc, icon } from "../util.js";

function qrSvg(text) {
  if (!window.qrcode) return "";
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
}

const groups = (secret) => secret.match(/.{1,4}/g).join(" ");

// Renders the enrolment flow into `el`; `onDone()` runs after the recovery
// codes have been acknowledged.
export async function mfaEnrol(el, { username, onDone }) {
  el.innerHTML = `<p class="muted">Préparation…</p>`;
  let setup;
  try {
    setup = await call("POST", "/console/me/mfa/setup");
  } catch (err) {
    el.innerHTML = `<div class="banner warn">${icon("alert")}<span>${esc(err.message)}</span></div>`;
    return;
  }
  el.innerHTML = `
    <ol class="mfa-steps">
      <li><b>Installez une application d'authentification</b> sur votre téléphone : Google Authenticator, Microsoft Authenticator, FreeOTP, Authy…</li>
      <li><b>Scannez ce QR code</b> avec l'application (ou saisissez la clé à la main).
        <div class="mfa-qr">${qrSvg(setup.uri)}</div>
        <div class="mfa-secret"><span class="faint">Clé :</span> <code>${esc(groups(setup.secret))}</code> <span class="faint">· compte ${esc(username)}</span></div></li>
      <li><b>Saisissez le code à 6 chiffres</b> affiché par l'application pour confirmer.
        <form class="row" data-mfa-confirm style="margin-top:10px">
          <input class="input mono otp" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123 456" required style="max-width:160px;letter-spacing:.2em;font-size:18px" />
          <button class="btn btn-primary">${icon("check")}Activer</button>
        </form>
        <div class="login-error hidden" data-mfa-error></div></li>
    </ol>`;
  el.querySelector("input").focus();
  el.querySelector("[data-mfa-confirm]").onsubmit = async (e) => {
    e.preventDefault();
    const box = el.querySelector("[data-mfa-error]");
    try {
      const { recovery } = await call("POST", "/console/me/mfa/enable", { code: e.target.code.value });
      el.innerHTML = `
        <div class="banner" style="margin:0 0 14px">${icon("check")}<div class="grow"><b>Double authentification activée.</b> Votre prochaine connexion demandera un code.</div></div>
        <h4>Codes de secours</h4>
        <p class="muted" style="margin:0 0 10px">Chaque code ne sert qu'une fois, si vous perdez votre téléphone. Conservez-les en lieu sûr : ils ne seront plus affichés.</p>
        <div class="recovery">${recovery.map((c) => `<code>${esc(c)}</code>`).join("")}</div>
        <div class="row" style="margin-top:14px"><button class="btn" data-dl>${icon("download")}Télécharger</button><button class="btn btn-primary" data-ok>${icon("check")}C'est noté</button></div>`;
      el.querySelector("[data-dl]").onclick = () =>
        download(`sentrovyx-codes-secours-${username}.txt`, `Sentrovyx — codes de secours de ${username}\nChaque code ne sert qu'une fois.\n\n${recovery.join("\n")}\n`, "text/plain");
      el.querySelector("[data-ok]").onclick = () => onDone?.();
    } catch (err) {
      box.textContent = err.message;
      box.classList.remove("hidden");
    }
  };
}
