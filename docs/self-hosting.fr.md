[English](self-hosting.md) · **Français**

# Héberger Bilan soi-même

Bilan tourne à partir d'images Docker publiées : aucun clone du dépôt n'est nécessaire. Ce guide
explique comment l'installer avec Docker Compose, le placer derrière un reverse proxy HTTPS et
l'exploiter au quotidien : mises à jour, tâches planifiées, sauvegardes et restaurations.

Lancez toutes les commandes `docker compose` ci-dessous depuis le dossier qui contient
`docker-compose.prod.yml`.

## Prérequis

- Un hôte Linux avec Docker Engine et le plugin Compose v2 (`docker compose`). Les images sont
  publiées pour `linux/amd64` et `linux/arm64`.
- Un nom de domaine et un reverse proxy TLS (Caddy, Traefik, nginx…). Bilan ne fonctionne pas en
  HTTP simple.
- `openssl` sur l'hôte, pour générer les secrets.
- Facultatif : un serveur SMTP pour les réinitialisations de mot de passe, les invitations et les
  alertes. Il se configure dans l'application, pas dans un fichier.

## Installation

### 1. Récupérer les fichiers

Placez quatre fichiers dans un même dossier :

```text
bilan/
├── docker-compose.prod.yml   # celui de la version que vous déployez
├── app.env                   # réglages de l'app et du cron (à partir de app.env.example)
├── db.env                    # mots de passe MariaDB (à partir de db.env.example)
└── keyring/keyfile           # clé de chiffrement MariaDB
```

Prenez `docker-compose.prod.yml`, `app.env.example` et `db.env.example` dans les sources de la
version que vous déployez, par exemple :

<!-- unverified -->

```bash
mkdir bilan && cd bilan
TAG=<tag de la version>
for f in docker-compose.prod.yml app.env.example db.env.example; do
  curl -fsSLO "https://raw.githubusercontent.com/Navino16/bilan/$TAG/$f"
done
cp app.env.example app.env
cp db.env.example db.env
chmod 600 app.env db.env
```

Le fichier compose lance trois services :

| Service   | Image                                     | Rôle                                                                           |
| --------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| `mariadb` | `mariadb:11`                              | Base `bilan`, utilisateur `bilan`, chiffrée au repos, port non publié          |
| `app`     | `ghcr.io/navino16/bilan:${BILAN_VERSION}` | L'application web, sur le port 3000                                            |
| `cron`    | même image que `app`                      | Déclenche les tâches planifiées (voir [Tâches planifiées](#tâches-planifiées)) |

La base de données est stockée dans le volume nommé `bilan_mariadb_data`.

### 2. Remplir les fichiers d'environnement

Toutes les variables de `app.env` et `db.env` sont obligatoires, sauf `TRUSTED_IP_HEADER` :

| Fichier   | Variable                                                                | Valeur                                                                                 |
| --------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `app.env` | `APP_URL`                                                               | URL publique en `https://` du reverse proxy placé devant l'app                         |
| `app.env` | `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_TOKEN_KEY`, `CRON_SECRET` | `openssl rand -base64 32`, une valeur différente pour chacune                          |
| `app.env` | `DATABASE_URL`                                                          | `mysql://bilan:<MARIADB_PASSWORD>@mariadb:3306/bilan`                                  |
| `app.env` | `TRUSTED_IP_HEADER` (facultatif)                                        | Voir [IP du client derrière le reverse proxy](#ip-du-client-derrière-le-reverse-proxy) |
| `db.env`  | `MARIADB_ROOT_PASSWORD`, `MARIADB_PASSWORD`                             | `openssl rand -hex 24` pour chacun (en hexadécimal, car il entre dans `DATABASE_URL`)  |

`DATA_ENCRYPTION_KEY` et `SEARCH_TOKEN_KEY` doivent faire 32 octets une fois décodées, sinon
l'app refuse de démarrer. L'app démarre sans `CRON_SECRET`, mais ses routes cron répondent alors
`404` et le service `cron` s'arrête : les [tâches planifiées](#tâches-planifiées) ne tournent
jamais. Avec deux fichiers séparés, le mot de passe root de MariaDB n'atteint
jamais les conteneurs `app` et `cron`.

Facultatif, depuis le shell ou un fichier `.env` placé à côté du fichier compose :

| Variable        | Défaut   | Effet                                                                        |
| --------------- | -------- | ---------------------------------------------------------------------------- |
| `BILAN_VERSION` | `latest` | Tag de l'image. Utilisez `develop` tant qu'aucune version n'a été publiée    |
| `BILAN_PORT`    | `3000`   | Port publié de l'app. `127.0.0.1:3000` le rend inaccessible depuis le réseau |

Les images sont taguées `latest` (dernière version), `<majeure>.<mineure>.<correctif>`,
`<majeure>.<mineure>`, `develop` et `sha-<commit>`.

### 3. Générer le trousseau

MariaDB chiffre ses tables et ses journaux au repos avec la clé de `keyring/keyfile`.

```bash
mkdir -p keyring
# Never overwrite an existing keyfile: the database could no longer be read.
[ -f keyring/keyfile ] || echo "1;$(openssl rand -hex 32)" > keyring/keyfile
chmod 644 keyring/keyfile
```

N'écrasez jamais un `keyfile` existant : la base deviendrait illisible.

### 4. Démarrer

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

À chaque démarrage, le conteneur `app` :

1. applique les migrations en attente (`prisma migrate deploy`) ;
2. crée les rôles, permissions et réglages par défaut (les réglages modifiés dans
   l'administration sont conservés) ;
3. sert l'application sur le port 3000 (`BILAN_PORT` côté hôte).

Le service `cron` attend que l'app soit opérationnelle. Journaux :
`docker compose -f docker-compose.prod.yml logs app` (ou `cron`, `mariadb`).

## Reverse proxy (HTTPS)

Servez Bilan uniquement en HTTPS : placez un reverse proxy TLS devant le port de l'app et
renseignez son URL publique en `https://` dans `APP_URL`. L'app envoie HSTS et
`upgrade-insecure-requests`, et l'authentification ne fait confiance qu'à `APP_URL` : un simple
`http://hote:3000` ne fonctionne donc pas. La connexion SSO et la liaison d'identités refusent
elles aussi toute autre adresse (« Ouvrez l'application depuis son adresse configurée »).

L'app fait confiance à l'en-tête d'IP client envoyé par le proxy (voir plus bas) : seul le proxy
doit pouvoir joindre le port de l'app. Mettez `BILAN_PORT=127.0.0.1:3000`, partagez un réseau
Docker avec le proxy, ou filtrez le port au pare-feu.

### Caddy

Caddy obtient et renouvelle le certificat tout seul.

<!-- unverified -->

```caddyfile
bilan.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

### nginx

Un import PDF peut atteindre 10 Mo, au-delà de la limite par défaut de nginx (1 Mo).

<!-- unverified -->

```nginx
server {
    listen 443 ssl;
    server_name bilan.example.com;

    ssl_certificate     /etc/letsencrypt/live/bilan.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bilan.example.com/privkey.pem;

    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### IP du client derrière le reverse proxy

Les limites de débit, la liste des sessions et les alertes de nouvelle connexion utilisent l'IP
du client que le reverse proxy place dans un en-tête de requête. `TRUSTED_IP_HEADER`, dans
`app.env`, désigne cet en-tête :

- `x-forwarded-for` (par défaut) : Bilan lit la **dernière** entrée, c'est-à-dire le pair vu par
  votre proxy. Les entrées précédentes viennent du client et peuvent être falsifiées. Traefik et
  Caddy remplacent la valeur reçue d'un client non fiable par la leur ; nginx
  (`$proxy_add_x_forwarded_for`) y ajoute le pair à la fin. Dans les deux cas, la dernière
  entrée est le client.
- Un en-tête à valeur unique que votre proxy écrase, par exemple `x-real-ip` (Traefik le
  renseigne). Bilan le lit tel quel. Choisissez cette option quand plusieurs proxys sont
  enchaînés : la dernière entrée de `x-forwarded-for` est alors le proxy précédent, pas le
  client.
- `cf-connecting-ip` derrière Cloudflare : sûr uniquement si votre proxy n'accepte que les
  connexions venant des adresses de Cloudflare. Sinon, quiconque joint directement le proxy peut
  le falsifier.

L'app fait confiance à cet en-tête sans le vérifier, d'où la règle ci-dessus : seul le proxy
doit pouvoir joindre le port de l'app.

## Premier démarrage : l'assistant de configuration

Ouvrez `APP_URL`. Sur une installation neuve (aucun utilisateur), toutes les pages redirigent
vers l'assistant :

1. **Compte administrateur** : crée le premier compte, avec le rôle de super administrateur.
2. **E-mail (SMTP)** : facultatif, configurable plus tard dans l'administration.
3. **Connexion externe** : fournisseur OIDC facultatif (Google s'ajoute ensuite, depuis
   l'administration). L'assistant affiche l'URL de redirection à déclarer chez votre
   fournisseur d'identité.
4. **Mode d'inscription** : _Sur invitation_ (par défaut, recommandé), _Ouvert_ ou _Désactivé_
   (seul un administrateur crée les comptes).

L'assistant répond 404 dès qu'un utilisateur existe. Tout le reste (SMTP, fournisseurs SSO, mode
d'inscription, 2FA obligatoire pour les administrateurs) se règle dans les pages
d'administration, pas dans les fichiers d'environnement.

## Exploitation

### Mettre à jour

1. [Faites une sauvegarde](#sauvegarde-et-restauration) avant tout.
2. Indiquez la nouvelle `BILAN_VERSION` et reprenez le `docker-compose.prod.yml` de cette
   version s'il a changé.
3. Téléchargez les images et redémarrez :

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Les migrations s'appliquent au démarrage de l'app.

### Réparer une migration en échec

Si une migration échoue, le conteneur `app` s'arrête avant de servir quoi que ce soit (voir
`docker compose -f docker-compose.prod.yml logs app`) et redémarre en boucle. Remplacer sa
commande saute la migration et donne un shell pour la réparer :

```bash
docker compose -f docker-compose.prod.yml run --rm app sh
# inside the container
cd /opt/migrate
node_modules/.bin/prisma migrate status
node_modules/.bin/prisma migrate resolve --rolled-back <migration>
```

Relancez ensuite la pile avec `up -d`.

### Reconstruire l'index de recherche

Lancez `npm run db:reindex-search` une fois après une mise à jour qui modifie le découpage de la
recherche (par exemple #192, recherche par début de mot) : le script déchiffre chaque libellé de
transaction et réécrit ses jetons de recherche (par lots de 500, `-- --batch=N` pour changer). On
peut le relancer sans risque.

- Il vérifie d'abord chaque `labelHash` stocké avec `SEARCH_TOKEN_KEY` et s'arrête à la première
  incohérence (mauvaise clé).
- Après un changement de la normalisation du texte, ajoutez `-- --rehash` pour réécrire aussi
  `labelHash`/`rawLabelHash`.
- Il s'exécute depuis un clone des sources (`npm ci`) dont le `.env` pointe vers la base cible,
  avec les mêmes `DATA_ENCRYPTION_KEY`/`SEARCH_TOKEN_KEY` : l'image Docker d'exécution ne
  contient ni les scripts ni `tsx`. Le compose de production ne publie pas le port de la base :
  le clone doit donc pouvoir joindre le conteneur `mariadb` par le réseau.

### Pool de connexions

Le pool compte 10 connexions et une requête attend jusqu'à 10 s pour en obtenir une. En cas de
forte charge simultanée (timeouts du pool dans les journaux), augmentez ces valeurs avec des
options du pilote MariaDB ajoutées à `DATABASE_URL`, par exemple :

```text
DATABASE_URL=mysql://bilan:<MARIADB_PASSWORD>@mariadb:3306/bilan?connectionLimit=20&acquireTimeout=15000
```

MariaDB accepte 151 connexions par défaut.

### Limites de débit

Les compteurs des limites de débit sont gardés en mémoire par l'app : ils repartent de zéro quand
le conteneur `app` redémarre.

### Tâches planifiées

Trois routes protégées par un jeton font le travail périodique (heures UTC) :

| Route                          | Planification (UTC)   | Effet                                                                                  |
| ------------------------------ | --------------------- | -------------------------------------------------------------------------------------- |
| `POST /api/cron/roll-budgets`  | tous les jours à 0h05 | Crée la période suivante de chaque budget récurrent arrivé à échéance                  |
| `POST /api/cron/purge-audit`   | tous les jours à 3h00 | Supprime les entrées du journal d'audit de plus de 12 mois                             |
| `POST /api/cron/purge-imports` | toutes les heures     | Supprime les lots d'import abandonnés depuis plus de 24 h (et leurs lignes partielles) |

#### Le service `cron`

Le service `cron` du compose (même image que l'app) appelle ces routes selon ce calendrier. Il ne
lit que `CRON_SECRET` dans `app.env`.

- Il appelle `purge-imports` une fois au démarrage et s'arrête si l'appel échoue : un
  `CRON_SECRET` erroné ou absent se voit donc comme une boucle de redémarrage dans
  `docker compose ps`.
- Chaque appel écrit une ligne, `OK <route> <réponse>` ou `ERROR <route> <erreur>` :
  `docker compose -f docker-compose.prod.yml logs cron`.
- Après un redémarrage de l'hôte, Docker relance tous les conteneurs en même temps : le service
  `cron` peut journaliser quelques `ERROR purge-imports … Connection refused` et redémarrer
  jusqu'à ce que l'app soit prête, puis se stabilise tout seul.

#### Avec la crontab de l'hôte

Si vous lancez l'image sans ce fichier compose, appelez les routes depuis la crontab de l'hôte.
Les tâches cron n'héritent pas de l'environnement de votre shell, d'où la ligne de variable :

<!-- unverified -->

```cron
CRON_SECRET=<la valeur de app.env>
5 0 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://bilan.example.com/api/cron/roll-budgets
0 3 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://bilan.example.com/api/cron/purge-audit
0 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://bilan.example.com/api/cron/purge-imports
```

#### Vérifier le secret

```bash
curl -i -X POST -H "Authorization: Bearer <secret>" <APP_URL>/api/cron/purge-imports
```

- `200 {"purged":…}` : le secret est bon.
- `401` : mauvais secret.
- `404` : `CRON_SECRET` n'est pas défini côté app.

## Sauvegarde et restauration

### Quoi sauvegarder

Un dump de la base ne suffit pas : une partie des données est chiffrée par l'app avec des clés
qui n'existent que dans `app.env`.

| Élément                           | Pourquoi                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dump de la base `bilan`           | Toutes les données.                                                                                                                                                                                                                                                                      |
| `app.env`                         | `DATA_ENCRYPTION_KEY` chiffre les libellés et notes des transactions, les IBAN, les alias de marchands et les secrets SMTP et SSO enregistrés ; `SEARCH_TOKEN_KEY` construit l'index de recherche ; `AUTH_SECRET` chiffre les secrets 2FA. Sans eux, un dump restauré est inexploitable. |
| `db.env`                          | Les mots de passe de la base, auxquels `DATABASE_URL` (dans `app.env`) doit correspondre.                                                                                                                                                                                                |
| `keyring/keyfile`                 | Clé de chiffrement au repos de MariaDB : sans elle, le volume de données lui-même est illisible. Un dump est du SQL en clair : sa restauration n'en a pas besoin.                                                                                                                        |
| `docker-compose.prod.yml`, `.env` | La définition de la pile et la `BILAN_VERSION` déployée.                                                                                                                                                                                                                                 |

Rangez les fichiers d'environnement et le trousseau à l'écart des dumps (par exemple dans un
gestionnaire de mots de passe) : ils changent rarement, et qui détient à la fois les dumps et les
clés peut tout lire.

Le dump contient des données financières personnelles. Les libellés restent chiffrés par l'app,
mais les montants, les dates, les noms de comptes et de banques, les noms d'utilisateurs, les
adresses e-mail et les adresses IP du journal d'audit et des sessions y sont en clair : chiffrez
toujours le dump.

### Sauvegarder la base

Le script ci-dessous exporte la base depuis l'intérieur du conteneur `mariadb`, la compresse puis
la chiffre avec une phrase secrète. Le mot de passe est lu dans `MARIADB_PASSWORD` à l'intérieur
du conteneur (il vient de `db.env`) : il n'apparaît jamais dans la ligne de commande de l'hôte.
`--single-transaction` prend un instantané cohérent sans bloquer l'app.

Créez la phrase secrète une fois, en root, et gardez-en une copie hors de l'hôte : sans elle, les
sauvegardes ne servent à rien.

```bash
(umask 077; openssl rand -base64 32 > /root/.bilan-backup-pass)
```

Enregistrez ceci dans `bilan/backup.sh` et rendez-le exécutable (`chmod 700 backup.sh`) :

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
umask 077
mkdir -p backups
out="backups/bilan-$(date -u +%Y%m%dT%H%M%SZ).sql.gz.enc"
trap 'rm -f "$out.tmp"' EXIT

docker compose -f docker-compose.prod.yml exec -T mariadb \
  sh -c 'exec mariadb-dump --single-transaction -ubilan -p"$MARIADB_PASSWORD" bilan' \
  | gzip \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass file:/root/.bilan-backup-pass \
  > "$out.tmp"
mv "$out.tmp" "$out"

find backups -name 'bilan-*.sql.gz.enc' -mtime +30 -delete
```

Si le dump échoue (par exemple `mariadb` arrêté), le script sort en erreur sans laisser de
fichier. La dernière ligne conserve 30 jours de sauvegardes : adaptez-la à votre politique de
rétention.

Pour utiliser [age](https://age-encryption.org) à la place, l'hôte n'a besoin que de la clé
publique, et la clé privée reste hors ligne. Remplacez la ligne `openssl` par :

<!-- unverified -->

```bash
  | age -r age1<votre clé publique> \
```

et nommez les fichiers `*.sql.gz.age` (dans la ligne `find` aussi).

Pour contrôler une sauvegarde sans la restaurer : la dernière ligne du dump est
`-- Dump completed on …`.

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/root/.bilan-backup-pass \
  -in backups/bilan-<horodatage>.sql.gz.enc | gunzip | tail -n 1
```

### Planifier

Lancez le script chaque jour depuis le cron de root (il doit accéder à Docker), par exemple dans
`/etc/cron.d/bilan-backup` :

<!-- unverified -->

```cron
30 2 * * * root /opt/bilan/backup.sh >> /var/log/bilan-backup.log 2>&1
```

Des sauvegardes sur le même disque que la base ne survivent pas à la perte de l'hôte : copiez
`backups/` ailleurs (autre machine, stockage objet) avec l'outil de votre choix.

### Restaurer sur un nouvel hôte

1. Installez Docker et recréez le dossier `bilan/` avec les fichiers sauvegardés
   `docker-compose.prod.yml`, `.env`, `app.env`, `db.env` et `keyring/keyfile`, ainsi que la
   phrase secrète et le dump. Gardez le même `app.env` : avec d'autres clés, les données
   restaurées sont illisibles. Utilisez la `BILAN_VERSION` de la sauvegarde, ou une plus
   récente.
2. Démarrez uniquement la base, sur un volume vide :

   ```bash
   docker compose -f docker-compose.prod.yml up -d --wait mariadb
   ```

3. Chargez le dump :

   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/root/.bilan-backup-pass \
     -in backups/bilan-<horodatage>.sql.gz.enc \
     | gunzip \
     | docker compose -f docker-compose.prod.yml exec -T mariadb \
         sh -c 'exec mariadb -ubilan -p"$MARIADB_PASSWORD" bilan'
   ```

4. Démarrez le reste de la pile. Au démarrage, l'app applique les migrations plus récentes que
   le dump :

   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

Pour restaurer par-dessus une installation existante (par exemple pour revenir en arrière),
arrêtez la pile et supprimez d'abord le volume de la base, puis suivez les étapes 2 à 4. Les
données actuelles sont perdues :

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm bilan_mariadb_data
```

### Tester la restauration

Une sauvegarde jamais restaurée n'est qu'un pari. Restaurez régulièrement le dernier dump sur une
machine de secours ou une copie de la pile, puis vérifiez :

- `docker compose -f docker-compose.prod.yml ps` : `app` est opérationnelle (les migrations sont
  passées) ;
- connectez-vous et ouvrez les transactions : les libellés sont lisibles (`DATA_ENCRYPTION_KEY`
  est la bonne) ;
- cherchez un libellé connu (`SEARCH_TOKEN_KEY` est la bonne) ;
- connectez-vous avec un compte protégé par la 2FA (`AUTH_SECRET` est le bon).

<!-- unverified -->

Pour tester sur le même hôte, copiez le dossier `bilan/`, puis dans la copie mettez
`COMPOSE_PROJECT_NAME=bilan-restore-test` et `BILAN_PORT=127.0.0.1:3100` dans `.env`, et
`APP_URL=http://localhost:3100` dans `app.env`. Accédez-y par un tunnel SSH
(`ssh -L 3100:127.0.0.1:3100 <hôte>`). La copie reprend les réglages SMTP restaurés et peut donc
envoyer des e-mails (alertes de nouvelle connexion, par exemple). Supprimez-la ensuite avec
`docker compose -f docker-compose.prod.yml down -v`, depuis la copie uniquement.
