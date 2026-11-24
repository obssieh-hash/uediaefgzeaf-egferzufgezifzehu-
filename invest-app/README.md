# InvestPilot 📈

Petit logiciel local pour suivre **la crypto et la bourse** en temps réel, avec un moteur
d'analyse qui te dit **où investir** selon ton profil de risque.

## Lancer

Il faut seulement **Python 3.9+** (aucune bibliothèque à installer).

- **Windows** : double-clic sur `lancer-windows.bat`
- **Mac / Linux** : `./lancer-mac-linux.sh` (ou `python3 server.py`)

Le navigateur s'ouvre tout seul sur <http://localhost:8765>.

## Fonctionnalités

| Onglet | Contenu |
|---|---|
| **Tableau de bord** | Bitcoin, Ethereum, capitalisation crypto, S&P 500, CAC 40, indice Peur & Avidité, indices mondiaux (Nasdaq, Dow Jones, DAX, Nikkei, or, pétrole, EUR/USD), plus fortes hausses/baisses, meilleures opportunités |
| **Crypto** | Top 60 crypto (prix en €, 1h / 24h / 7j / 30j, capitalisation, volume, mini-graphique 7 jours), recherche et tri |
| **Bourse** | ~40 actions et ETF (USA, France, Europe, ETF), performances 1j / 1m / 3m / 1an, RSI, filtres par marché |
| **Où investir ?** | Score 0-100 pour chaque actif, signal (Achat fort → Éviter), raisons expliquées, répartition conseillée de ton montant selon ton profil (Prudent / Équilibré / Dynamique) |

Clique sur n'importe quel actif pour voir son graphique (1M → 5A) et son analyse détaillée.

## Les API utilisées (gratuites, sans clé)

| API | Usage |
|---|---|
| CoinGecko `api.coingecko.com/api/v3` | Prix crypto, capitalisation, données globales, historique |
| Yahoo Finance `query1.finance.yahoo.com/v8/finance/chart` | Actions, ETF, indices, matières premières, historique crypto pour l'analyse |
| Alternative.me `api.alternative.me/fng` | Indice Crypto Fear & Greed |

Le serveur local (`server.py`) expose ses propres routes : `/api/crypto`, `/api/stocks`,
`/api/indices`, `/api/global`, `/api/analysis`, `/api/history?symbol=…&range=1y`.
Les réponses sont mises en cache 2 à 10 minutes pour respecter les limites des API.

## Comment le score est calculé

Départ à 50, puis :
- **Tendance** : prix au-dessus/au-dessous de la moyenne mobile 200 jours (±12), MM50 vs MM200 (±8), prix vs MM50 (±5)
- **Momentum** : performance 3 mois (jusqu'à ±12) et 1 mois (jusqu'à ±8)
- **RSI 14** : survendu (< 30) = bonus, suracheté (> 70) = malus
- **Risque** : pénalité selon la volatilité annualisée, plus forte pour un profil prudent

La répartition ne retient que les actifs avec un score ≥ 60, pondérés par score/volatilité,
plafonne la crypto (10 % prudent, 25 % équilibré, 50 % dynamique) et garde une poche de liquidités.

Pour ajouter des actions, modifie la liste `STOCKS` en haut de `server.py`
(symboles Yahoo Finance, ex. `"DG.PA"` pour Vinci).

> ⚠️ Outil d'aide à la décision basé sur des indicateurs techniques, **pas un conseil financier**.
> Les performances passées ne préjugent pas des performances futures.
