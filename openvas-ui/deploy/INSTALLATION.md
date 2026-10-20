# Installation d'OpenVAS Console sur une VM Ubuntu — guide pas à pas

Ce guide installe sur une machine Ubuntu :

- **openvasd**, le scanner de vulnérabilités OpenVAS, avec son flux d'environ
  190 000 tests ;
- **l'interface web OpenVAS Console** : tableau de bord, scans, sites web,
  rapports, remédiation, conformité.

Tout tourne dans Docker, dans un projet isolé nommé `openvas-console`.

Durée totale : environ 45 minutes, dont la plus grande partie en
téléchargements et en chargement du flux.

> **Exécutez les commandes une par une, dans l'ordre**, et vérifiez le
> « Résultat attendu » avant de passer à la suite. En cas d'erreur, arrêtez-vous
> et notez le message.

---

## Étape 0 — Ce qu'il faut avant de commencer

| Élément | Minimum | Recommandé |
|---|---|---|
| Système | Ubuntu 22.04 ou 24.04 (64 bits) | Ubuntu 24.04 |
| RAM | 4 Go | **8 Go ou plus** |
| CPU | 2 vCPU | 4 vCPU ou plus |
| Disque libre | 30 Go | 50 Go |
| Réseau | HTTPS sortant vers `ghcr.io` et `registry.community.greenbone.net` | — |

> ⚠️ Avec moins de 4 Go de RAM, le scanner plante. N'installez pas sur une VM de 1 ou 2 Go.

Il vous faut aussi :

- le fichier **`openvas-ui.tar.gz`** (fourni avec ce guide) ;
- un compte sur la VM avec les droits `sudo` ;
- l'**adresse IP** de la VM (vous la trouverez à l'étape 1).

Dans ce guide, `IP_DE_LA_VM` est à remplacer par cette adresse et `utilisateur` par votre nom de compte.

---

## Étape 1 — Vérifier la VM

Connectez-vous à la VM en SSH, puis :

```bash
lsb_release -ds        # version d'Ubuntu
nproc                  # nombre de CPU
free -h                # mémoire (ligne « Mem: », colonne « total »)
df -h /                # disque libre (colonne « Avail »)
hostname -I            # adresse(s) IP de la VM : notez la première
```

**Résultat attendu :** Ubuntu 22.04 ou 24.04, au moins 4 Go de RAM (« total ») et au moins 30 Go disponibles.

### Si Docker est déjà installé et que d'autres conteneurs tournent

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}' | tee ~/docker-avant.txt
docker compose ls -a          # « openvas-console » ne doit PAS apparaître
sudo ss -ltnp | grep ':8090 ' # doit être vide ; sinon choisissez un autre port à l'étape 5
```

> ⚠️ Sur un serveur partagé, n'utilisez **jamais** `docker system prune`,
> `docker volume prune`, `docker image prune -a` ni `systemctl restart docker`.
> Ces commandes touchent **tous** les conteneurs du serveur.

---

## Étape 2 — Installer Docker et les outils

Passez cette étape si `docker compose version` affiche déjà une version (v2 ou plus).

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl tmux openssl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

**Déconnectez-vous de la VM, puis reconnectez-vous** pour que le droit d'utiliser Docker soit pris en compte. Ensuite :

```bash
docker --version
docker compose version
```

**Résultat attendu :** les deux versions s'affichent, sans message d'erreur.

Si Docker était déjà installé, installez seulement les outils :

```bash
sudo apt-get install -y tmux openssl
```

---

## Étape 3 — Ouvrir une session tmux (protection contre les coupures)

Les téléchargements sont longs. Avec tmux, ils continuent même si la connexion SSH coupe.

```bash
tmux new -s openvas
```

Une barre verte apparaît en bas de l'écran.

| Besoin | Commande |
|---|---|
| Se reconnecter après une coupure | `tmux attach -t openvas` |
| Quitter tmux sans rien arrêter | `Ctrl+B`, relâcher, puis `D` |

---

## Étape 4 — Copier et extraire le logiciel

**Depuis votre PC Windows**, dans PowerShell, dans le dossier contenant le fichier :

```powershell
scp .\openvas-ui.tar.gz utilisateur@IP_DE_LA_VM:~/
```

Depuis Linux ou macOS, la commande est la même dans un terminal : `scp openvas-ui.tar.gz utilisateur@IP_DE_LA_VM:~/`

**Sur la VM :**

```bash
sudo mkdir -p /opt/openvas-console
sudo chown "$USER": /opt/openvas-console
tar xzf ~/openvas-ui.tar.gz -C /opt/openvas-console
cd /opt/openvas-console/openvas-ui/deploy
ls -a
```

**Résultat attendu :** `.env.example  compose.yaml  INSTALLATION.md`

---

## Étape 5 — Configurer

Toujours dans `/opt/openvas-console/openvas-ui/deploy`.

### 5.1 Créer le fichier de configuration avec une clé secrète

```bash
cp .env.example .env
sed -i "s/^OPENVASD_API_KEY=.*/OPENVASD_API_KEY=$(openssl rand -hex 32)/" .env
chmod 600 .env
```

### 5.2 Choisir l'accès à l'interface

**Cas habituel : accessible depuis le réseau interne.** Remplacez `IP_DE_LA_VM` par l'adresse notée à l'étape 1.

```bash
sed -i "s/^UI_BIND_ADDRESS=.*/UI_BIND_ADDRESS=IP_DE_LA_VM:8090/" .env
```

Pour qu'elle soit accessible seulement depuis la VM (par tunnel SSH), laissez la valeur par défaut `127.0.0.1:8090`.

### 5.3 Définir les mots de passe de l'interface

Choisissez des mots de passe de 12 caractères ou plus, **sans le caractère `$`**. Rien ne s'affiche pendant la saisie, c'est normal.

```bash
read -rsp "Mot de passe du compte admin : " P1; echo
read -rsp "Mot de passe du compte lecteur (lecture seule) : " P2; echo
sed -i '/^UI_ADMIN_PASSWORD=/d; /^UI_VIEWER_PASSWORD=/d' .env
printf 'UI_ADMIN_PASSWORD=%s\nUI_VIEWER_PASSWORD=%s\n' "$P1" "$P2" >> .env
unset P1 P2
```

> Les mots de passe ne doivent contenir ni `$` ni espace.

- `admin` : accès complet.
- `lecteur` : consulte tout, mais ne peut ni lancer ni supprimer de scan.

Ces deux comptes « système » ne se modifient que dans `.env`. Les autres comptes
se créent ensuite dans l'interface, menu **Système → Utilisateurs** :

| Rôle | Droits |
|---|---|
| Administrateur | tout : scans, planifications, utilisateurs, journal d'activité |
| Développeur | voit et pilote (démarrer, pause, arrêter, reprendre) uniquement les scans qui lui sont attribués, et suit leurs vulnérabilités |
| Visiteur | lecture seule de tous les scans et rapports |

Ces comptes sont stockés (mot de passe haché) dans le volume `ui_data_vol` et
survivent aux mises à jour. Chaque action est tracée dans **Système → Journal d'activité**.

### 5.4 Régler les ressources selon la taille de la VM

| RAM de la VM | `OPENVASD_MEMORY_LIMIT` | `OPENVASD_CPUS` | `REDIS_MEMORY_LIMIT` | `OPENVASD_MAX_RUNNING_SCANS` |
|---|---|---|---|---|
| 4 Go | `2500m` | `2` | `512m` | `1` |
| 8 Go | `5g` | moitié de `nproc` | `1g` | `2` |
| 16 Go | `10g` | moitié de `nproc` | `2g` | `4` |
| 32 Go et plus | `16g` | moitié de `nproc` | `2g` | `6` |

Exemple pour une VM de 8 Go avec 4 CPU :

```bash
sed -i 's/^OPENVASD_MEMORY_LIMIT=.*/OPENVASD_MEMORY_LIMIT=5g/; s/^OPENVASD_CPUS=.*/OPENVASD_CPUS=2/; s/^REDIS_MEMORY_LIMIT=.*/REDIS_MEMORY_LIMIT=1g/; s/^OPENVASD_MAX_RUNNING_SCANS=.*/OPENVASD_MAX_RUNNING_SCANS=2/' .env
```

### 5.5 Vérifier

```bash
grep -v '^#' .env | grep -v '^$' | sed 's/\(KEY=\|PASSWORD=\).*/\1********/'
docker compose config -q && echo OK
```

**Résultat attendu :** la liste des réglages (secrets masqués), puis `OK`.

---

## Étape 6 — Télécharger et démarrer

```bash
cd /opt/openvas-console/openvas-ui/deploy
docker compose pull
```

Comptez 5 à 15 minutes : plusieurs Go sont téléchargés. L'avertissement suivant est **normal** :

```
! Image openvas-console-ui ... pull access denied
```

Cette image est construite localement à l'étape suivante.

```bash
docker compose build
docker compose up -d
```

---

## Étape 7 — Suivre le premier démarrage (15 à 30 minutes)

```bash
docker compose ps -a
```

**Résultat attendu, une fois le démarrage terminé :**

| Conteneur | État |
|---|---|
| `openvasd`, `redis-server`, `openvas-ui` | **Up** |
| `vulnerability-tests`, `notus-data`, `gpg-data`, `configure-openvas`, `configure-openvas-log` | **Exited (0)** : normal, ils ont seulement copié des données |

Vérifiez ensuite les journaux de l'interface :

```bash
docker compose logs --tail=20 openvas-ui
```

**Résultat attendu :** la ligne `Authentification activée : admin (admin), lecteur (viewer)`.

> ⚠️ Si cette ligne n'apparaît pas, l'interface est ouverte **sans mot de passe** :
> revenez à l'étape 5.3.

Le chargement des tests se voit ensuite dans l'interface, menu **Administration** : le « Flux de VTs » passe de *Chargement…* à **Chargées** en 5 à 30 minutes la première fois.

Si d'autres conteneurs tournaient déjà sur la machine, vérifiez qu'ils n'ont pas bougé :

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}' > ~/docker-apres.txt
diff ~/docker-avant.txt ~/docker-apres.txt   # seules des lignes openvas-console-* doivent apparaître
```

---

## Étape 8 — Ouvrir l'interface

### Accès réseau (si `UI_BIND_ADDRESS=IP_DE_LA_VM:8090`)

Depuis la VM :

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://IP_DE_LA_VM:8090/login.html
```

**Résultat attendu :** `200`.

Puis, depuis un PC du réseau : **http://IP_DE_LA_VM:8090**. Connectez-vous avec `admin` et le mot de passe choisi.

Si le PC n'y arrive pas (« délai dépassé ») alors que la VM répond `200`, testez dans PowerShell sur le PC :

```powershell
Test-NetConnection IP_DE_LA_VM -Port 8090
```

`TcpTestSucceeded : False` signifie qu'un pare-feu entre le PC et la VM bloque le port 8090. Il faut l'autoriser sur ce pare-feu (par exemple le FortiGate). Côté VM, vérifiez aussi `sudo ufw status`.

### Accès par tunnel SSH (si `UI_BIND_ADDRESS=127.0.0.1:8090`)

Depuis le PC :

```powershell
ssh -L 8090:127.0.0.1:8090 utilisateur@IP_DE_LA_VM
```

Laissez la fenêtre ouverte et allez sur **http://localhost:8090**.

### Contrôles

1. En bas à gauche, l'encadré affiche **openvasd · Prêt**.
2. Dans **Administration**, le Flux de VTs indique **Chargées**, avec environ 190 000 VTs.
3. Faites un premier **Nouveau scan** sur **une machine que vous êtes autorisé à scanner**.

---

## Utilisation : bon à savoir

- **Scans réseau :** menu *Nouveau scan*. Une plage (`10.0.0.0/24`) compte comme un seul scan, qui analyse 15 machines à la fois.
- **Sites web :** menu *Sites web*. Collez l'adresse (`https://site.exemple`) et cochez la case d'autorisation.
  - Un site hébergé derrière le même pare-feu que la VM peut être injoignable par son IP publique. Le symptôme : le résultat « Host does not have any TCP port open ». Scannez alors l'**IP interne** du serveur web, ou faites autoriser l'accès sur le pare-feu.
- **File d'attente :** au-delà de `OPENVASD_MAX_RUNNING_SCANS`, les scans attendent leur tour (statut « Demandé ») et démarrent automatiquement.
- **Scan coupé** (arrêt, redémarrage) : bouton **Reprendre**. Il relance le scan sans refaire les machines déjà terminées.
- **Avant de redémarrer openvasd** (modification du `.env`, mise à jour), vérifiez qu'aucun scan n'est « En cours » : un redémarrage met les scans en échec.
- **Ne scannez que des systèmes autorisés,** et prévenez l'équipe réseau. Les scans peuvent être pris pour des attaques par l'IPS ou le WAF. Une exception IPS pour l'IP de la VM évite des résultats incomplets.

---

## Maintenance

Toutes les commandes se lancent depuis `/opt/openvas-console/openvas-ui/deploy`.

### Mettre à jour l'interface (nouvelle archive)

Sans coupure des scans en cours : seule l'interface redémarre.

```bash
tar xzf ~/openvas-ui.tar.gz -C /opt/openvas-console
cd /opt/openvas-console/openvas-ui/deploy
docker compose up -d --build openvas-ui
```

Le fichier `.env` (mots de passe, clé, réglages) n'est pas dans l'archive : il est conservé.

### Mettre à jour le flux de vulnérabilités (chaque nuit, automatiquement)

```bash
crontab -e
```

Ajoutez cette ligne :

```
17 3 * * * cd /opt/openvas-console/openvas-ui/deploy && docker compose pull -q && docker compose up -d >> $HOME/openvas-console-update.log 2>&1
```

> Cette mise à jour redémarre openvasd quand une nouvelle version est disponible :
> évitez de planifier des scans à 3 h du matin.

### Modifier un réglage du `.env`

```bash
nano .env
docker compose up -d     # recrée uniquement ce qui a changé
```

### Sauvegarder les données de l'interface

Noms des scans, suivi de remédiation, planifications :

```bash
docker run --rm -v openvas-console_ui_data_vol:/data -v "$HOME":/backup alpine \
  tar czf /backup/openvas-ui-data-$(date +%F).tgz -C /data .
```

### Arrêter / désinstaller

```bash
docker compose stop        # arrête, sans rien supprimer
docker compose down        # supprime les conteneurs de ce projet, garde les données
docker compose down -v     # supprime aussi TOUTES les données de ce projet (irréversible)
```

---

## Dépannage

| Symptôme | Que faire |
|---|---|
| `permission denied ... docker.sock` | Vous n'êtes pas reconnecté après l'étape 2 : déconnectez-vous, puis reconnectez-vous. |
| `docker compose pull` coupé (perte SSH) | `tmux attach -t openvas`, ou relancez simplement `docker compose pull` : il reprend. |
| `port is already allocated` | Changez le port dans `UI_BIND_ADDRESS` (ex. `:8091`), puis `docker compose up -d`. |
| Encadré « Hors ligne » | `docker compose logs --tail=30 openvasd`. Le flux est peut-être encore en chargement : attendez 10 minutes. |
| `openvasd` redémarre en boucle | Mémoire insuffisante : augmentez `OPENVASD_MEMORY_LIMIT` ou la RAM de la VM. |
| Flux de VTs bloqué sur « Chargement… » plus de 30 min | `docker compose logs --tail=30 openvas-ui openvasd` |
| Scan en « Échec » après un redémarrage | Bouton **Reprendre** sur le scan. |
| Mot de passe oublié | `nano .env` (ligne `UI_ADMIN_PASSWORD=`), puis `docker compose up -d openvas-ui`. |
| « Trop de tentatives » à la connexion | Attendez 5 minutes. |

### Informations à transmettre en cas de problème

```bash
cd /opt/openvas-console/openvas-ui/deploy
docker compose ps -a
docker compose logs --tail=40 openvasd openvas-ui
free -h; df -h /
```
