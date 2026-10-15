// Team state shared by every analyst: scan names, finding triage, asset
// records, schedules and settings, kept in one JSON file, plus an
// append-only audit log. Writes go through a temp file + rename so a crash
// never leaves a half-written state.

import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SLA = { critical: 7, high: 30, medium: 90, low: 180 };

const EMPTY = () => ({
  labels: {},
  triage: {},
  assets: {},
  webscans: {},
  schedules: [],
  events: [],
  settings: { webhook: "", sla: { ...DEFAULT_SLA } },
});

export function createState(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "state.json");
  const auditFile = path.join(dir, "audit.log");
  let state = EMPTY();
  try {
    state = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    /* first run */
  }

  let timer = null;
  const flush = () => {
    timer = null;
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  };
  const save = () => {
    if (!timer) timer = setTimeout(flush, 200);
  };
  process.on("exit", () => timer && flush());

  return {
    get: () => state,
    save,
    // Set or delete (value === null) one entry of a map namespace.
    put(ns, key, value) {
      if (value === null) delete state[ns][key];
      else state[ns][key] = value;
      save();
    },
    audit(user, action, target, detail) {
      const line = JSON.stringify({ at: new Date().toISOString(), user, action, target, detail });
      fs.appendFile(auditFile, `${line}\n`, () => {});
    },
    readAudit(limit = 300) {
      try {
        const lines = fs.readFileSync(auditFile, "utf8").trim().split("\n");
        return lines.slice(-limit).reverse().map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },
    event(ev) {
      state.events.unshift({ at: new Date().toISOString(), ...ev });
      state.events.length = Math.min(state.events.length, 200);
      save();
    },
  };
}
