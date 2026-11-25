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
| **Baleines 🐋** | Suivi on-chain des meilleurs traders de Hyperliquid : consensus par crypto (LONG / SHORT), prix d'entrée moyen, take profit et stop loss, **« Que faire ? »** pour chaque crypto, derniers mouvements, fiche de chaque trader, liste de traders suivis et **alertes** (son + notification) quand une baleine ouvre, ferme ou retourne une position |
| **Actualités 📰** | ~120 articles (Google Actualités, CoinDesk, Cointelegraph, Decrypt, Investing…) avec analyse automatique du ton (positif / négatif) et détection des actifs cités |
| **Mon plan 🎓** | Budget, fonds d'urgence, répartition mensuelle conseillée (ETF éligibles PEA + petite part crypto), simulateur « et si j'avais investi X €/mois » sur les vrais prix historiques, projection des intérêts composés, règles d'or |
| **Où investir ?** | Score 0-100 pour chaque actif, signal (Achat fort → Éviter), raisons expliquées, répartition conseillée de ton montant selon ton profil (Prudent / Équilibré / Dynamique) |

Clique sur n'importe quel actif pour voir son graphique (1M → 5A) et son analyse détaillée.

## Les API utilisées (gratuites, sans clé)

| API | Usage |
|---|---|
| CoinGecko `api.coingecko.com/api/v3` | Prix crypto, capitalisation, données globales, historique |
| Yahoo Finance `query1.finance.yahoo.com/v8/finance/chart` | Actions, ETF, indices, matières premières, historique crypto pour l'analyse |
| Alternative.me `api.alternative.me/fng` | Indice Crypto Fear & Greed |
| DefiLlama `stablecoins.llama.fi` | Liquidité du marché crypto (offre de stablecoins) |
| BCE `data-api.ecb.europa.eu` | Taux directeur et inflation de la zone euro |
| Frankfurter `api.frankfurter.app` | Taux de change |
| Flux RSS (Google Actualités, CoinDesk, Cointelegraph, Decrypt, Investing.com) | Actualités |
| Hyperliquid `api.hyperliquid.xyz/info` + `stats-data.hyperliquid.xyz` | Classement des traders, positions, ordres TP/SL, historique des trades, cours des cryptos absentes de Yahoo |

## Suivi des baleines : comment les traders sont choisis

Le classement complet (~46 000 traders) est téléchargé toutes les 30 minutes. On garde les comptes
de plus de 100 000 $, gagnants sur la semaine, le mois et depuis le début, avec un ROI mensuel ≥ 3 %,
et on écarte les robots de market-making (volume démesuré). Les 45 meilleurs sont analysés et les 25
qui ont des positions ouvertes sont suivis en direct (toutes les 30 secondes).
Le score « Où investir ? » intègre aussi le financement des marchés à levier (surchauffe) et le ton des actualités.
Le consensus des baleines est aussi intégré au score de chaque crypto dans « Où investir ? » (±10 points).

## Performances

- Toutes les données sont **préchargées au démarrage**.
- Cache « stale-while-revalidate » : l'interface reçoit toujours une réponse immédiate pendant que
  les données sont rafraîchies en arrière-plan.
- Réponses compressées (gzip), requêtes en parallèle, respect des limites de débit des API.

Le serveur local (`server.py`) expose ses propres routes : `/api/crypto`, `/api/stocks`,
`/api/indices`, `/api/global`, `/api/analysis`, `/api/history?symbol=…&range=1y`,
`/api/news`, `/api/market`, `/api/whales` (baleines + consensus + mouvements), `/api/whale?address=0x…` (un trader).
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
