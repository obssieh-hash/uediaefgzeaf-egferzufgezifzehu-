# JumpServer — thème ANSIE

Ce dépôt contient les trois interfaces de JumpServer, redessinées aux couleurs de l'ANSIE (bleu `#0b4ea2` / `#033d80`, vert `#0a9a25`).

| Dossier | Projet d'origine | Ce qu'il affiche |
|---|---|---|
| `jumpserver/` | [jumpserver/jumpserver](https://github.com/jumpserver/jumpserver) | Page de connexion, MFA, mot de passe, messages, pages d'erreur |
| `lina/` | [jumpserver/lina](https://github.com/jumpserver/lina) | Console d'administration (tableaux de bord, utilisateurs, actifs, audits, paramètres) |
| `luna/` | [jumpserver/luna](https://github.com/jumpserver/luna) | Terminal web (thèmes « ANSIE » clair et « ANSIE Night » sombre par défaut) |

Seule l'apparence est modifiée : aucune logique, API ou permission n'a changé.

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
