# Installation en production (Ubuntu + Docker déjà utilisé)

Ce guide installe **openvasd + l'interface web** dans un projet Docker Compose
isolé nommé `openvas-console`. Rien n'est partagé avec les autres conteneurs du
serveur : conteneurs, réseau et volumes sont tous préfixés `openvas-console`.

> ⚠️ Règles à respecter sur un serveur qui fait tourner d'autres conteneurs
>
> - Lancez les commandes `docker compose` **uniquement depuis le dossier
>   `/opt/openvas-console/openvas-ui/deploy`**.
> - N'utilisez **jamais** `docker system prune`, `docker volume prune`,
>   `docker image prune -a`, ni `docker rm -f $(docker ps -aq)`. Ces commandes
>   touchent **tous** les projets du serveur.
> - Ne redémarrez pas le service Docker (`systemctl restart docker`). Cela
>   arrête tous les autres conteneurs.

---

## Étape 0 — Vérifier le serveur (lecture seule, rien n'est modifié)

```bash
# Versions (Docker Engine 24+ et le plugin compose v2 sont requis)
docker --version
docker compose version

# Ressources : prévoir au minimum 4 Go de RAM libre et 25 Go de disque
free -h
df -h /var/lib/docker

# Photographie de l'existant, à garder pour comparer à la fin
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' | tee ~/docker-avant.txt
docker compose ls

# Aucun projet / volume portant déjà ce nom ne doit exister (sortie vide attendue)
docker compose ls -a | grep openvas-console
docker volume ls | grep openvas-console

# Le port 8090 de l'hôte doit être libre (sortie vide attendue)
sudo ss -ltnp | grep ':8090 '
```

Si le port 8090 est déjà occupé, choisissez-en un autre (ex. `8091`) : vous le
mettrez à l'étape 2 dans `UI_BIND_ADDRESS`.

Le serveur doit pouvoir télécharger les images depuis `ghcr.io` et
`registry.community.greenbone.net` (HTTPS sortant).

## Étape 1 — Récupérer le code

```bash
sudo mkdir -p /opt/openvas-console
sudo chown "$USER": /opt/openvas-console
cd /opt/openvas-console

git clone -b claude/youthful-heisenberg-7eviu2 \
  https://github.com/obssieh-hash/uediaefgzeaf-egferzufgezifzehu-.git .
```

Le dépôt est privé : GitHub demande votre nom d'utilisateur et un **jeton
d'accès personnel** (Settings → Developer settings → Personal access tokens) à
la place du mot de passe.

Si Git n'est pas souhaité sur le serveur, copiez simplement le dossier depuis
votre PC :

```bash
scp -r openvas-ui utilisateur@serveur:/opt/openvas-console/
```

## Étape 2 — Configurer

```bash
cd /opt/openvas-console/openvas-ui/deploy
cp .env.example .env
sed -i "s/^OPENVASD_API_KEY=.*/OPENVASD_API_KEY=$(openssl rand -hex 32)/" .env
chmod 600 .env
nano .env
```

Dans `.env`, ajustez :

| Variable | Conseil |
|---|---|
| `UI_BIND_ADDRESS` | Laissez `127.0.0.1:8090` : l'interface n'est **pas** exposée sur Internet. |
| `OPENVASD_MEMORY_LIMIT`, `OPENVASD_CPUS`, `REDIS_MEMORY_LIMIT` | Plafonnent le scanner pour qu'il ne prive pas vos autres conteneurs. Exemple pour 16 Go de RAM : `4g` / `2` / `1g`. |

> Docker contourne UFW : un port publié sur `0.0.0.0` est accessible depuis
> Internet **même si UFW le bloque**. Gardez `127.0.0.1`.

Vérifiez le fichier (aucune erreur attendue) :

```bash
docker compose config -q && echo OK
```

## Étape 3 — Télécharger et démarrer

```bash
cd /opt/openvas-console/openvas-ui/deploy
docker compose pull        # télécharge les images (plusieurs Go, quelques minutes)
docker compose build       # construit l'image de l'interface
docker compose up -d
```

Le premier démarrage copie le flux de vulnérabilités dans les volumes. Comptez
5 à 15 minutes.

```bash
docker compose ps                         # état des services
docker compose logs -f openvasd openvas-ui   # Ctrl+C pour quitter
```

Résultat attendu dans `docker compose ps` :

- `openvasd`, `redis-server`, `openvas-ui` → **running** ;
- `vulnerability-tests`, `notus-data`, `gpg-data` et `configure-*` →
  **exited (0)**. C'est normal : ils ont seulement copié les données.

Vérifiez que les autres conteneurs n'ont pas bougé :

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' > ~/docker-apres.txt
diff ~/docker-avant.txt ~/docker-apres.txt   # seules des lignes openvas-console-* doivent apparaître
```

## Étape 4 — Accéder à l'interface

L'interface n'a pas de connexion par mot de passe. Choisissez **une** des deux
méthodes suivantes.

### A. Tunnel SSH (le plus sûr, rien à configurer)

Depuis votre PC :

```bash
ssh -L 8090:127.0.0.1:8090 utilisateur@IP_DU_SERVEUR
```

Puis ouvrez <http://localhost:8090> dans votre navigateur.

### C. Accès direct depuis le réseau interne (connexion par mot de passe)

L'interface intègre une page de connexion avec deux comptes : un compte
**admin** (accès complet) et un compte **lecteur**, facultatif, qui consulte
tout mais ne peut ni lancer ni supprimer de scan. Dans `.env` :

```bash
UI_BIND_ADDRESS=0.0.0.0:8090
UI_ADMIN_PASSWORD=<mot de passe long>
UI_VIEWER_PASSWORD=<autre mot de passe>      # facultatif
```

puis `docker compose up -d openvas-ui`. Ne publiez jamais l'interface sur le
réseau sans `UI_ADMIN_PASSWORD` : quiconque y accède peut lancer des scans
depuis le serveur. Le trafic est en HTTP : réservez cet accès au réseau
interne, ou utilisez la méthode B (Nginx + HTTPS).

### B. Nginx avec mot de passe (si Nginx est déjà installé sur l'hôte)

On **ajoute** un nouveau site, sans modifier les sites existants.

```bash
sudo apt install apache2-utils           # fournit htpasswd
sudo htpasswd -c /etc/nginx/.openvas-console.htpasswd admin

sudo tee /etc/nginx/sites-available/openvas-console >/dev/null <<'NGINX'
server {
    listen 80;
    server_name openvas.votre-domaine.fr;

    auth_basic "OpenVAS";
    auth_basic_user_file /etc/nginx/.openvas-console.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }
}
NGINX

sudo ln -s /etc/nginx/sites-available/openvas-console /etc/nginx/sites-enabled/
sudo nginx -t                  # doit afficher « syntax is ok »
sudo systemctl reload nginx    # reload (et non restart) : aucune coupure
sudo certbot --nginx -d openvas.votre-domaine.fr   # HTTPS, si certbot est utilisé
```

Si `nginx -t` affiche une erreur, **ne rechargez pas**. Supprimez le lien
(`sudo rm /etc/nginx/sites-enabled/openvas-console`) et corrigez d'abord.

Si votre Nginx ou Traefik tourne lui-même dans Docker, ne modifiez pas sa
configuration au hasard. Utilisez plutôt la méthode A.

## Étape 5 — Premier contrôle

1. En bas à gauche de l'interface, l'encadré doit afficher **openvasd · Prêt**
   et une version de feed.
2. Ouvrez **Administration**. Le **Flux de VTs** passe de « Chargement… » à
   « Chargées ». La première fois, cela prend quelques minutes (environ
   190 000 VTs).
3. Lancez un scan de test sur **une machine que vous êtes autorisé à
   scanner**, avec le préréglage « Ports usuels ».

> Un scan consomme du CPU et du réseau. Planifiez les gros scans en dehors
> des heures de pointe (menu **Scans planifiés**).

## Mises à jour

```bash
cd /opt/openvas-console/openvas-ui/deploy
git pull                                              # nouvelle version de l'interface
docker compose pull                                   # nouvelles images + flux de VTs
docker compose up -d --build                          # ne recrée que les conteneurs de ce projet
```

Le flux de vulnérabilités est mis à jour par `docker compose pull`, puis
`docker compose up -d`. Faites-le par exemple une fois par jour, via cron :

```bash
crontab -e
# chaque nuit à 03h17
17 3 * * * cd /opt/openvas-console/openvas-ui/deploy && docker compose pull -q && docker compose up -d >> /var/log/openvas-console-update.log 2>&1
```

## Sauvegarde

Les noms des scans, le suivi de remédiation et les planifications sont dans le
volume `openvas-console_ui_data_vol` :

```bash
cd /opt/openvas-console
docker run --rm -v openvas-console_ui_data_vol:/data -v "$PWD":/backup alpine \
  tar czf /backup/openvas-ui-data-$(date +%F).tgz -C /data .
```

Les résultats des scans sont conservés par openvasd dans le volume
`openvas-console_openvasd_cache_vol`.

## Arrêt / désinstallation

Toujours depuis `/opt/openvas-console/openvas-ui/deploy` :

```bash
docker compose stop        # arrête, sans rien supprimer
docker compose down        # supprime les conteneurs de CE projet, garde les données
docker compose down -v     # supprime aussi les volumes de CE projet (données perdues)
```

`down -v` ne supprime que les volumes `openvas-console_*`, jamais ceux des
autres projets.

## Dépannage

| Symptôme | Vérification |
|---|---|
| Encadré « Hors ligne » | `docker compose logs openvasd` : le flux est peut-être encore en cours de copie. Vérifiez aussi que `OPENVASD_API_KEY` n'a pas changé depuis le démarrage. Sinon : `docker compose up -d`. |
| `openvasd` redémarre en boucle | Mémoire trop limitée. Augmentez `OPENVASD_MEMORY_LIMIT` (au moins `3g`) puis lancez `docker compose up -d`. |
| « port is already allocated » | Changez `UI_BIND_ADDRESS` (ex. `127.0.0.1:8091`) puis lancez `docker compose up -d`. |
| Tests de vulnérabilité vides | Chargement en cours : `docker compose logs -f openvas-ui`. |
| Scan à 0 % qui ne bouge pas | `docker compose logs -f openvasd`. Vérifiez que la cible répond depuis le serveur (`ping`, `nc -zv IP 22`). |
