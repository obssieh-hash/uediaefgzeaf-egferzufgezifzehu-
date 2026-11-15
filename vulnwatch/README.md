# CERT-ANSIE : veille des vulnérabilités de l'équipe SSI (ANSIE, Djibouti)

CERT-ANSIE est une application web auto-hébergée (nom technique : `vulnwatch`). Elle récupère en continu les nouvelles vulnérabilités, les
**rapproche de votre périmètre** (PHP, OpenSSH, Fortinet…), les **priorise** (CVSS + EPSS + exploitation
active) et vous **alerte** (Telegram, Discord, Slack, Teams, e-mail). L'équipe consulte et qualifie les
vulnérabilités depuis n'importe quel poste du réseau, dans un navigateur.

## Sources intégrées

| Source | Apport | Clé API |
|---|---|---|
| **NVD (NIST)** : API CVE 2.0 | Toutes les CVE : CVSS, CWE, produits (CPE), références | Optionnelle, **recommandée** (gratuite) |
| **CISA KEV** | Vulnérabilités **exploitées activement**, échéances, usage par des rançongiciels | Non |
| **FIRST EPSS** | Probabilité d'exploitation dans les 30 jours | Non |
| **GitHub Advisory Database** | Avis sur les paquets (Composer/PHP, npm, PyPI, Maven, Go…) | Optionnelle |
| **CERT-FR (ANSSI)** | Alertes, avis et actualités, avec la liste complète des CVE de chaque bulletin | Non |
| **Ubuntu USN, CISA Advisories, ZDI** | Bulletins éditeurs et chercheurs | Non |
| Flux RSS personnalisés | `VW_EXTRA_FEEDS` | — |

Raccourcis d'analyse depuis chaque fiche : NVD, CVE.org, CIRCL, Exploit-DB, recherche de PoC sur GitHub, CWE.

## Priorisation

| Priorité | Règle | Délai conseillé |
|---|---|---|
| **P1** | Exploitée (KEV) **ou** CVSS ≥ 9 et EPSS ≥ 10 % | Immédiat |
| **P2** | CVSS ≥ 9 **ou** (CVSS ≥ 7 et EPSS ≥ 10 %) | 7 jours |
| **P3** | CVSS ≥ 7 | 30 jours |
| **P4** | Reste | Cycle normal |

Une alerte part quand une vulnérabilité du périmètre atteint `VW_NOTIFY_MIN_PRIORITY`. Une nouvelle alerte
part aussi quand sa priorité **s'aggrave**, par exemple lors d'un ajout au catalogue KEV.

## Installation sur Ubuntu (22.04 / 24.04)

Copiez le dossier `vulnwatch/` sur la VM (git clone, scp…), puis :

```bash
cd vulnwatch
```

```bash
sudo bash install.sh
```

Le script installe tout : Python, service systemd durci, Nginx en HTTPS avec un certificat auto-signé,
ouverture du pare-feu UFW. À la fin, il affiche **l'URL d'accès et le mot de passe admin**.

- Accès depuis le réseau : `https://IP_DE_LA_VM`. Le navigateur affiche un avertissement à cause du
  certificat auto-signé. Pour le supprimer, remplacez `/etc/vulnwatch/tls/vulnwatch.crt` et `.key` par un
  certificat de votre PKI.
- Sans Nginx (HTTP direct sur le port 8000) : `sudo NO_NGINX=1 bash install.sh`
- **Mise à jour** : relancez `sudo bash install.sh`. La configuration et les données sont conservées.

### Configuration

Tout se règle dans `/etc/vulnwatch/vulnwatch.env` (clés API, notifications, mot de passe, proxy). Après
chaque modification :

```bash
sudo systemctl restart vulnwatch
```

### Clés API recommandées

1. **NVD_API_KEY** : demande sur https://nvd.nist.gov/developers/request-an-api-key (e-mail, réponse
   immédiate). La synchronisation devient environ 10 fois plus rapide.
2. **GITHUB_TOKEN** (facultatif) : https://github.com/settings/tokens, token **sans aucune permission**.

### Exploitation

```bash
sudo systemctl status vulnwatch
```

```bash
sudo journalctl -u vulnwatch -f
```

Sauvegarde : un seul fichier, `/var/lib/vulnwatch/vulnwatch.db` (SQLite).

```bash
sudo sqlite3 /var/lib/vulnwatch/vulnwatch.db ".backup /root/vulnwatch-$(date +%F).db"
```

La documentation de l'API REST est sur `https://IP_DE_LA_VM/api/docs`.

## Fonctionnalités

- **Tableau de bord** : P1 à traiter, éléments à qualifier, nouveautés du périmètre, derniers ajouts KEV,
  chronologie des CVE par sévérité, derniers bulletins.
- **Vulnérabilités** : recherche plein texte, filtres (périmètre, période, priorité, KEV, sévérité, statut,
  source), tri, **export CSV** compatible Excel.
- **Fiche détaillée** : CVSS et vecteur, EPSS, informations KEV, produits, CWE, références, bulletins
  CERT-FR liés.
- **Qualification CERT** : statut (Nouveau, En analyse, Action requise, Traité, Non applicable) et note
  d'analyse, avec l'auteur et la date.
- **Périmètre surveillé** : 22 modèles prêts à l'emploi (PHP, OpenSSH, Apache, Nginx, Fortinet, Ivanti,
  PAN-OS, Citrix, VMware, Exchange…). La correspondance se fait par CPE et/ou par mot-clé, avec un seuil
  CVSS optionnel. À l'ajout d'un produit, CERT-ANSIE récupère aussi son historique NVD (365 jours).
- **Bulletins** : CERT-FR, Ubuntu, CISA, ZDI, avec un indicateur « touche mon périmètre ».
- **Rapport de veille** (7, 14 ou 30 jours) : synthèse chiffrée, faits marquants rédigés automatiquement,
  actions recommandées, vulnérabilités P1/P2, répartition par produit, suivi du traitement, ajouts KEV et
  bulletins CERT-FR. Bouton **Imprimer / PDF** (mise en page A4) pour la diffusion à la direction.
- **Marquage TLP** (`VW_CLASSIFICATION`, par défaut `TLP:AMBER`) affiché sur toutes les pages et sur les rapports.
- **Sécurité** : authentification, protection contre le bourrage d'identifiants, cookies HttpOnly et
  SameSite, CSP stricte, service systemd non privilégié, aucune dépendance JavaScript externe (fonctionne
  sans accès aux CDN).
- Charte ANSIE (bleu et vert), écran de connexion à l'image de l'équipe SSI, thème sombre ou clair,
  interface en français.

## Développement local

```bash
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
```

```bash
VW_ADMIN_PASSWORD=test ./venv/bin/uvicorn app.main:app --reload --port 8000
```
