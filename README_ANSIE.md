# JumpServer — thème ANSIE

Ce dépôt contient les trois interfaces de JumpServer, redessinées aux couleurs de l'ANSIE (bleu `#0b4ea2` / `#033d80`, vert `#0a9a25`).

| Dossier | Projet d'origine | Ce qu'il affiche |
|---|---|---|
| `jumpserver/` | [jumpserver/jumpserver](https://github.com/jumpserver/jumpserver) | Page de connexion, MFA, mot de passe, messages, pages d'erreur |
| `lina/` | [jumpserver/lina](https://github.com/jumpserver/lina) | Console d'administration (tableaux de bord, utilisateurs, actifs, audits, paramètres) |
| `luna/` | [jumpserver/luna](https://github.com/jumpserver/luna) | Terminal web (thèmes « ANSIE » clair et « ANSIE Night » sombre par défaut) |

## Fonctions ajoutées pour l'ANSIE

Le thème modifie l'apparence. Quatre fonctions ont aussi été ajoutées à la version libre :

| Fonction | Où la trouver | Ce qu'elle fait |
|---|---|---|
| Personnalisation | Paramètres → Personnalisation | Logo, nom court, titre, nom de l'organisation, message de connexion et couleurs, avec aperçu en direct. S'applique à la page de connexion et à la console. |
| Restrictions de connexion | Paramètres → Restrictions de connexion | Règles « autoriser / bloquer » selon l'utilisateur, l'adresse IP (IP, réseau ou plage), les jours et les heures. La première règle qui correspond décide ; les super-administrateurs peuvent être exemptés. S'applique à toutes les méthodes de connexion. |
| Rapports d'activité | Audits → Rapports d'activité | Connexions, sessions et commandes dangereuses sur une période, export CSV (compatible Excel) et impression / PDF. |
| Sécurité des comptes | Console → Sécurité des comptes | Score de sécurité, comptes sans double authentification, mots de passe expirés, comptes inactifs, expirés ou bloqués, avec liste et export CSV. |

Le filigrane (nom de l'utilisateur affiché sur les pages) existe déjà dans JumpServer et reste actif.

Côté serveur, les réglages sont enregistrés comme les autres paramètres de JumpServer (catégories `ansie_interface` et `ansie_login_rules` de `/api/v1/settings/setting/`). Les règles de connexion sont testées dans `jumpserver/apps/authentication/tests/test_ansie_rules.py`.

Les textes des nouvelles pages de la console sont écrits en français.

## Construire

```bash
# Console d'administration (Node 24, Yarn 4)
cd lina && corepack enable && yarn install && yarn build:prod   # résultat : lina/lina/

# Terminal web (Node >= 22.19, pnpm 11)
cd luna && corepack enable && pnpm install && pnpm web:generate   # résultat : luna/.output/public/
```

Le serveur (`jumpserver/`) se construit avec son `Dockerfile` habituel.

## Déployer

Dans une installation JumpServer existante, remplacer les fichiers servis par les conteneurs `core`, `lina` et `luna` par ceux construits ici (ou construire de nouvelles images à partir de ces dossiers), puis redémarrer les services.

Si un thème a été choisi dans **Paramètres → Interface** (édition Entreprise), il remplace les couleurs ANSIE de la console : revenir au thème par défaut pour les retrouver.
