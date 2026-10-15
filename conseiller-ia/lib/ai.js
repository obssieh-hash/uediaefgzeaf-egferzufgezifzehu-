// Analyse par Claude : combine les indicateurs techniques avec une recherche web d'actualités.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM = `Tu es un analyste financier prudent qui conseille un particulier francophone.
Tu analyses des cryptomonnaies, des actions américaines et des actions de la Bourse de Tunis (BVMT).

Méthode :
1. Lis les indicateurs techniques fournis (s'il y en a) : tendance, RSI, MACD, volatilité.
2. Utilise la recherche web pour trouver l'actualité récente (30 derniers jours) : résultats, régulation, hacks, partenariats, macro-économie. Pour la BVMT, cherche aussi le dernier cours et la tendance récente (sites comme ilboursa.com, markets.tn, african-markets.com).
3. Pèse les arguments pour et contre, puis donne un verdict clair.

Règles :
- Écris en français simple, phrases courtes, sans jargon inutile.
- Sois honnête : si les données sont insuffisantes ou contradictoires, dis-le et baisse la confiance.
- Ne promets jamais de gain. Mentionne le principal risque.
- Format de la réponse (Markdown) :
  ## Résumé
  ## Ce qui est positif
  ## Ce qui est négatif
  ## Ce que je ferais
  (précise un horizon : court terme / long terme, et une idée de taille de position raisonnable)
- Termine OBLIGATOIREMENT par ces deux lignes exactes, sans rien après :
VERDICT: ACHETER | CONSERVER | VENDRE  (choisis un seul mot)
CONFIANCE: faible | moyenne | élevée  (choisis un seul mot)`;

function fmt(n, d = 2) {
  return n == null || Number.isNaN(n) ? "n/d" : Number(n).toFixed(d);
}

function describeIndicators(ind, tech) {
  if (!ind) return "Aucun indicateur technique disponible : base-toi sur la recherche web.";
  return [
    `Prix actuel : ${fmt(ind.price, 4)}`,
    `MM20 : ${fmt(ind.sma20, 4)} | MM50 : ${fmt(ind.sma50, 4)} | MM200 : ${fmt(ind.sma200, 4)}`,
    `RSI(14) : ${fmt(ind.rsi14, 1)}`,
    `MACD : ${fmt(ind.macd?.macd, 4)} / signal ${fmt(ind.macd?.signal, 4)}`,
    `Variation 7j : ${fmt(ind.change7d, 1)} % | 30j : ${fmt(ind.change30d, 1)} % | 90j : ${fmt(ind.change90d, 1)} %`,
    `Volatilité annualisée 30j : ${fmt(ind.volatility30d, 0)} %`,
    `Écart avec le plus haut de la période : ${fmt(ind.drawdownFromHigh, 1)} %`,
    `Score technique automatique : ${tech.score}/100 → ${tech.verdict}`,
  ].join("\n");
}

function parseVerdict(text) {
  const v = text.match(/VERDICT:\s*(ACHETER|CONSERVER|VENDRE)/i);
  const c = text.match(/CONFIANCE:\s*(faible|moyenne|élevée|elevee)/i);
  const body = text.replace(/\n?VERDICT:.*$/im, "").replace(/\n?CONFIANCE:.*$/im, "").trim();
  return {
    verdict: v ? v[1].toUpperCase() : null,
    confidence: c ? c[1].toLowerCase().replace("elevee", "élevée") : null,
    analysis: body,
  };
}

export async function analyzeWithClaude({ market, name, symbol, indicators, tech, question }) {
  const marketLabel = { crypto: "Cryptomonnaie", us: "Action américaine", bvmt: "Action de la Bourse de Tunis (BVMT)" }[market];
  const userText = `Actif : ${name} (${symbol}) — ${marketLabel}
Date du jour : ${new Date().toISOString().slice(0, 10)}

Indicateurs techniques (données journalières) :
${describeIndicators(indicators, tech)}

${question ? `Question de l'utilisateur : ${question}\n\n` : ""}Dois-je acheter, conserver ou vendre ?`;

  const messages = [{ role: "user", content: userText }];
  const sources = new Map();
  let response;

  // La recherche web peut mettre le tour en pause (pause_turn) : on relance jusqu'à 3 fois.
  for (let i = 0; i < 4; i++) {
    response = await getClient()
      .beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: SYSTEM,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
        messages,
      })
      .finalMessage();

    for (const block of response.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) if (r.url) sources.set(r.url, r.title || r.url);
      }
    }
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  if (response.stop_reason === "refusal") {
    throw new Error("L'IA a refusé de traiter cette demande. Reformulez la question.");
  }

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    ...parseVerdict(text),
    model: response.model,
    sources: [...sources].slice(0, 8).map(([url, title]) => ({ url, title })),
  };
}
