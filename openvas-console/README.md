# OpenVAS Console

Interface web moderne pour [openvas-scanner](https://github.com/greenbone/openvas-scanner).

`openvas-scanner` n'a pas d'interface graphique : c'est le moteur de scan, piloté par l'API REST
**openvasd** (`rust/api/openapi.yml`). Cette console se branche directement sur cette API :
elle ne modifie pas le scanner, elle en devient l'interface.

![Tableau de bord](docs/dashboard.png)

## Fonctionnalités

| Page | Endpoints openvasd |
| --- | --- |
| **Tableau de bord** : KPI, scans actifs en direct, répartition par sévérité CVSS, hôtes les plus exposés, familles de VT | `HEAD /health`, `GET /health/*`, `GET /scans`, `/scans/{id}/status`, `/scans/{id}/results` |
| **Scans** : recherche, filtres par statut, progression en temps réel, démarrage, arrêt, suppression | `GET /scans`, `POST /scans/{id}`, `DELETE /scans/{id}` |
| **Détail d'un scan** : progression par hôte, vulnérabilités triées par CVSS, détail et solution, vue par hôte, export CSV/JSON | `GET /scans/{id}`, `/status`, `/results?range=n` (incrémental) |
| **Nouveau scan** : cibles, ports, détection d'hôtes, identifiants SSH/SMB/ESXi/SNMP, familles de VT, préférences du scanner, aperçu JSON de la requête | `GET /scans/preferences`, `POST /scans` |
| **Actifs** : inventaire des hôtes (système, ports, indice de risque 0–100), tri, filtres, fiche hôte avec historique, export CSV | résultats agrégés |
| **Rapports** : synthèse rédigée, jauge de risque, répartition par sévérité, distribution CVSS, évolution dans le temps, matrice de risque hôtes × sévérité, priorités de correction ; impression / PDF | résultats agrégés |
| **Comparer** : deux scans côte à côte, vulnérabilités nouvelles, corrigées et persistantes | résultats agrégés |
| **Tests de vulnérabilité** : catalogue du feed, filtres famille/sévérité, fiche détaillée (CVE, vecteur, solution) | `GET /vts?information=1` |
| **Analyse de paquets** (Notus) : vulnérabilités d'une liste de paquets installés | `GET /notus`, `POST /notus/{os}` |
| **Paramètres** : connexion, clé API, intervalle d'actualisation, thème | — |

Sur chaque vulnérabilité, un **suivi** (à traiter, confirmée, en correction, risque accepté, faux positif) est conservé dans le navigateur ; les faux positifs sont exclus des graphiques. Un scan peut être **dupliqué** pour relancer la même configuration, et la console peut envoyer une **notification** à la fin d'un scan.

Le reste de l'interface : thème sombre et clair, palette de commandes (<kbd>Ctrl</kbd>+<kbd>K</kbd>), affichage adapté au mobile, et un **mode démo** qui simule un scanner pour essayer la console sans openvasd.

## Démarrage

Requiert Node.js ≥ 18, aucune dépendance à installer.

```sh
cd openvas-console
OPENVASD_URL=http://127.0.0.1:3000 OPENVASD_API_KEY=changeme node server.mjs
# → http://127.0.0.1:8080
```

`server.mjs` sert l'interface et relaie `/api/*` vers openvasd. Ce proxy est nécessaire parce
qu'openvasd n'envoie pas d'en-têtes CORS. Il permet aussi de garder la clé API et le certificat
client côté serveur.

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `PORT` / `HOST` | Adresse d'écoute de la console | `8080` / `127.0.0.1` |
| `OPENVASD_URL` | URL d'openvasd | `http://127.0.0.1:3000` |
| `OPENVASD_API_KEY` | Clé ajoutée à chaque requête (`X-API-KEY`) | — |
| `OPENVASD_CERT` / `OPENVASD_KEY` / `OPENVASD_CA` | Certificats PEM pour le mTLS | — |

Au premier lancement, la console passe en mode réel si openvasd répond, sinon en mode démo.
Vous pouvez changer de mode dans **Paramètres**.

### Remarques

- Pour lister tous les scans, lancez openvasd avec `--enable-get-scans`. Sans cette option, la console n'affiche que les scans créés depuis ce navigateur.
- Le nom d'un scan n'existe pas dans l'API : il est enregistré localement, dans le navigateur.
- Sur un feed réel, le catalogue de VTs dépasse 100 000 entrées. La console ne le télécharge qu'à la demande, ou toujours si l'option « Enrichir les résultats » est activée. C'est ce catalogue qui donne aux résultats leur nom, leur score CVSS et leur solution.

## Structure

```
openvas-console/
├── server.mjs            serveur statique + proxy openvasd
└── public/
    ├── index.html
    ├── css/app.css       design system (tokens, thèmes, composants)
    └── js/
        ├── api.js        client openvasd + réglages
        ├── mock.js       scanner simulé (mode démo)
        ├── store.js      cache, résultats incrémentaux, catalogue VT
        ├── util.js       CVSS v2/v3, formats, icônes
        ├── ui.js         toasts, dialogues, tiroir, palette
        ├── charts.js     graphiques SVG (barres, histogramme, anneau, jauge, matrice)
        ├── analytics.js  agrégation, indice de risque, comparaison, suivi
        ├── actions.js    démarrer / arrêter / supprimer
        ├── app.js        shell, routeur, thème
        └── views/        une page par fichier
```
