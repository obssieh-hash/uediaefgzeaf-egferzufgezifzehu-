// Start / stop / delete flows shared by the scan list and the scan page.

import { api, labels } from "./api.js";
import { forgetScan } from "./store.js";
import { confirmDialog, fail, toast } from "./ui.js";

export async function startScan(id, name) {
  try {
    await api().action(id, "start");
    toast("Scan démarré", name);
    return true;
  } catch (err) {
    fail("Démarrage impossible")(err);
    return false;
  }
}

export async function stopScan(id, name) {
  const ok = await confirmDialog({
    title: "Arrêter le scan ?",
    body: `« ${name} » sera interrompu. Les résultats déjà collectés restent disponibles.`,
    confirm: "Arrêter",
    danger: true,
  });
  if (!ok) return false;
  try {
    await api().action(id, "stop");
    toast("Scan arrêté", name);
    return true;
  } catch (err) {
    fail("Arrêt impossible")(err);
    return false;
  }
}

export async function deleteScan(id, name) {
  const ok = await confirmDialog({
    title: "Supprimer le scan ?",
    body: `« ${name} », sa configuration et tous ses résultats seront définitivement supprimés du scanner.`,
    confirm: "Supprimer",
    danger: true,
  });
  if (!ok) return false;
  try {
    await api().deleteScan(id);
    labels.remove(id);
    forgetScan(id);
    toast("Scan supprimé", name);
    return true;
  } catch (err) {
    fail("Suppression impossible")(err);
    return false;
  }
}
