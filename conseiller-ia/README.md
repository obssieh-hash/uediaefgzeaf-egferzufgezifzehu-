# Conseiller IA — Crypto, Actions US, Bourse de Tunis

Site web qui te dit, pour un actif donné : **ACHETER**, **CONSERVER** ou **VENDRE**.

Comment il décide :
1. **Indicateurs techniques** calculés sur 1 an de prix journaliers : moyennes mobiles 20/50/200 jours,
   RSI, MACD, volatilité, variation 7/30/90 jours → score de -100 à +100.
2. **Claude (IA d'Anthropic)** lit ces indicateurs, fait une recherche web sur l'actualité récente
   (résultats, régulation, piratages, macro…) puis donne un verdict expliqué en français avec ses sources.
3. Pour la **BVMT**, il n'existe pas d'API publique gratuite : l'IA cherche le dernier cours et les
   nouvelles sur le web (ilboursa, markets.tn…).

> ⚠️ Ce n'est pas un conseil financier garanti. Aucune IA ne prédit le marché de façon fiable.
> Utilise-le comme un deuxième avis, jamais comme seule raison d'acheter.

## Les API utilisées (et pourquoi)

| Besoin | API | Prix | Pourquoi |
|---|---|---|---|
| Cryptos | [CoinGecko](https://www.coingecko.com/en/api) | Gratuit (plan Demo, ~100 req/min, 10 000/mois) | Le plus complet, des milliers de cryptos, historique gratuit |
| Actions US | [Twelve Data](https://twelvedata.com) | Gratuit (800 req/jour) | Le plan gratuit le plus généreux pour l'historique journalier |
| Analyse + actualité | [Claude API](https://console.anthropic.com) | Payant à l'usage (quelques centimes par analyse) | Lit l'actualité sur le web et explique son raisonnement |
| BVMT | Pas d'API publique gratuite | — | Données sous licence (ICE, Finansya…). L'IA passe par la recherche web |

Alternatives : Finnhub (60 req/min, mais l'historique de bougies est payant), Alpha Vantage (seulement 25 req/jour en gratuit).

## Lancer sur ton ordinateur

Il faut [Node.js](https://nodejs.org) version 20 ou plus.

```bash
cd conseiller-ia
npm install
cp .env.example .env     # puis ouvre .env et colle tes clés
npm start
```

Ouvre ensuite http://localhost:3000

- Sans aucune clé : les cryptos marchent (score technique seulement).
- Avec `TWELVEDATA_API_KEY` : les actions US marchent.
- Avec `ANTHROPIC_API_KEY` : l'analyse complète par l'IA + la BVMT.

## Mettre le site en ligne (hébergement)

**Render.com (le plus simple, gratuit pour commencer)**
1. Crée un compte sur https://render.com et connecte ton GitHub.
2. « New » → « Blueprint » → choisis ce dépôt (le fichier `render.yaml` à la racine configure tout).
3. Renseigne les clés demandées (`ANTHROPIC_API_KEY`, `TWELVEDATA_API_KEY`, `APP_PASSWORD`…).
4. Render te donne une adresse du type `https://conseiller-ia.onrender.com`.

Autres options : Railway, Fly.io, ou un VPS (`npm install && npm start` derrière Nginx).

**Important :** mets un `APP_PASSWORD` si le site est public, sinon n'importe qui peut utiliser ta clé Claude.
Le serveur limite aussi à 30 analyses IA par heure et par visiteur.

## Structure

```
conseiller-ia/
  server.js          serveur web + routes /api/analyze, /api/top-crypto
  lib/data.js        récupération des prix (CoinGecko, Twelve Data)
  lib/indicators.js  RSI, MACD, moyennes mobiles, score technique
  lib/ai.js          analyse par Claude avec recherche web
  public/            le site (HTML, CSS, JS)
```
