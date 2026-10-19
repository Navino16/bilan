**English** · [Français](self-hosting.fr.md)

# Self-hosting Bilan

Bilan runs from published Docker images: you don't need a checkout of the repository. This
guide covers installing it with Docker Compose, putting it behind an HTTPS reverse proxy, and
running it day to day: upgrades, scheduled jobs, backups and restores.

Run every `docker compose` command below from the directory that holds
`docker-compose.prod.yml`.

## Requirements

- A Linux host with Docker Engine and the Compose v2 plugin (`docker compose`). Images are
  published for `linux/amd64` and `linux/arm64`.
- A domain name and a TLS reverse proxy (Caddy, Traefik, nginx…). Bilan does not work over
  plain HTTP.
- `openssl` on the host, to generate the secrets.
- Optional: an SMTP server for password resets, invitations and alerts. It is configured in the
  app, not in a file.

## Install

### 1. Get the files

Put four files in one directory:

```text
bilan/
├── docker-compose.prod.yml   # from the release you run
├── app.env                   # app and cron settings (from app.env.example)
├── db.env                    # MariaDB passwords (from db.env.example)
└── keyring/keyfile           # MariaDB encryption key
```

Take `docker-compose.prod.yml`, `app.env.example` and `db.env.example` from the source of the
release you run, for example:

<!-- unverified -->

```bash
mkdir bilan && cd bilan
TAG=<release tag>
for f in docker-compose.prod.yml app.env.example db.env.example; do
  curl -fsSLO "https://raw.githubusercontent.com/Navino16/bilan/$TAG/$f"
done
cp app.env.example app.env
cp db.env.example db.env
chmod 600 app.env db.env
```

The compose file runs three services:

| Service   | Image                                     | Role                                                                  |
| --------- | ----------------------------------------- | --------------------------------------------------------------------- |
| `mariadb` | `mariadb:11`                              | Database `bilan`, user `bilan`, encrypted at rest, port not published |
| `app`     | `ghcr.io/navino16/bilan:${BILAN_VERSION}` | The web app, on port 3000                                             |
| `cron`    | same image as `app`                       | Calls the scheduled jobs (see [Scheduled jobs](#scheduled-jobs))      |

The database lives in the named volume `bilan_mariadb_data`.

### 2. Fill in the env files

Every variable of `app.env` and `db.env` is mandatory, except `TRUSTED_IP_HEADER`:

| File      | Variable                                                                | Value                                                                         |
| --------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `app.env` | `APP_URL`                                                               | Public `https://` URL of the reverse proxy in front of the app                |
| `app.env` | `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_TOKEN_KEY`, `CRON_SECRET` | `openssl rand -base64 32`, one value each                                     |
| `app.env` | `DATABASE_URL`                                                          | `mysql://bilan:<MARIADB_PASSWORD>@mariadb:3306/bilan`                         |
| `app.env` | `TRUSTED_IP_HEADER` (optional)                                          | See [Client IP behind the reverse proxy](#client-ip-behind-the-reverse-proxy) |
| `db.env`  | `MARIADB_ROOT_PASSWORD`, `MARIADB_PASSWORD`                             | `openssl rand -hex 24` each (hex, because it goes into `DATABASE_URL`)        |

`DATA_ENCRYPTION_KEY` and `SEARCH_TOKEN_KEY` must decode to 32 bytes: the app refuses to start
otherwise. The app starts without `CRON_SECRET`, but its cron routes then answer `404` and the
`cron` service exits, so the [scheduled jobs](#scheduled-jobs) never run. The two env files keep the MariaDB root password out of the app and cron containers.

Optional, from the shell or a `.env` file next to the compose file:

| Variable        | Default  | Effect                                                               |
| --------------- | -------- | -------------------------------------------------------------------- |
| `BILAN_VERSION` | `latest` | Image tag. Use `develop` until the first release is tagged           |
| `BILAN_PORT`    | `3000`   | Published port of the app. `127.0.0.1:3000` keeps it off the network |

Images are tagged `latest` (last release), `<major>.<minor>.<patch>`, `<major>.<minor>`,
`develop` and `sha-<commit>`.

### 3. Generate the keyring

MariaDB encrypts its tables and logs at rest with the key in `keyring/keyfile`.

```bash
mkdir -p keyring
# Never overwrite an existing keyfile: the database could no longer be read.
[ -f keyring/keyfile ] || echo "1;$(openssl rand -hex 32)" > keyring/keyfile
chmod 644 keyring/keyfile
```

### 4. Start

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

On every start the `app` container:

1. applies pending migrations (`prisma migrate deploy`);
2. seeds roles, permissions and default settings (settings changed in the admin UI are kept);
3. serves on port 3000 (`BILAN_PORT` on the host).

The `cron` service waits for the app to be healthy. Logs: `docker compose -f
docker-compose.prod.yml logs app` (or `cron`, `mariadb`).

## Reverse proxy (HTTPS)

Serve Bilan over HTTPS only: put a TLS reverse proxy in front of the app port and set `APP_URL`
to its public `https://` URL. The app sends HSTS and `upgrade-insecure-requests`, and auth only
trusts `APP_URL`, so plain `http://host:3000` does not work. SSO sign-in and identity linking
also refuse any other address ("Open the app from its configured address").

The app trusts the client-IP header the proxy sends (see below), so only the proxy may reach
the app port: set `BILAN_PORT=127.0.0.1:3000`, use a Docker network shared with the proxy, or
firewall it.

### Caddy

Caddy gets and renews the certificate itself.

<!-- unverified -->

```caddyfile
bilan.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

### nginx

PDF imports can reach 10 MB, above nginx's 1 MB default body size.

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

### Client IP behind the reverse proxy

Rate limits, the sessions list and new-login alerts use the client IP that the reverse proxy
puts in a request header. `TRUSTED_IP_HEADER` in `app.env` names that header:

- `x-forwarded-for` (default): Bilan reads the **last** entry, the peer your proxy saw. Earlier
  entries come from the client and can be forged. Traefik and Caddy replace a value from an
  untrusted client with their own; nginx (`$proxy_add_x_forwarded_for`) appends the peer to it.
  Either way the last entry is the client.
- A single-value header your proxy overwrites, e.g. `x-real-ip` (Traefik sets it). Bilan reads
  it as is. Use this when several proxies are chained, because the last `x-forwarded-for` entry
  is then the previous proxy, not the client.
- `cf-connecting-ip` behind Cloudflare: only safe if your proxy accepts connections from
  Cloudflare's addresses alone, otherwise anyone reaching the proxy directly can forge it.

The app trusts the header blindly, hence the rule above: nothing but the proxy may reach the
app port.

## First start: the setup wizard

Open `APP_URL`. A fresh install (no user yet) redirects every page to the setup wizard:

1. **Admin account**: creates the first account, with the super admin role.
2. **Email (SMTP)**: optional, can be configured later in Administration. Encryption defaults to
   STARTTLS (port 587), which refuses to send if the server does not support it; _Implicit TLS_
   (port 465) and _None_ (local relay only) are the alternatives. Leave the username and password
   empty for a relay that does not require authentication.
3. **External login**: optional OIDC provider (Google is added later, from Administration). The
   wizard shows the redirect URL to register with your identity provider.
4. **Registration mode**: _Invite only_ (default, recommended), _Open_ or _Disabled_ (only an
   admin creates accounts).

The wizard answers 404 as soon as one user exists. Everything else (SMTP, SSO providers,
registration mode, admin 2FA) is configured in the Administration pages, not in env files.

## Operations

### Upgrade

1. [Back up](#backup-and-restore) first.
2. Set the new `BILAN_VERSION`, and take that release's `docker-compose.prod.yml` if it changed.
3. Pull and restart:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Migrations run when the app starts.

### Repair a failed migration

If a migration fails, the `app` container stops before serving (see
`docker compose -f docker-compose.prod.yml logs app`) and restarts in a loop. Overriding its
command skips the migration and gives a shell to repair it:

```bash
docker compose -f docker-compose.prod.yml run --rm app sh
# inside the container
cd /opt/migrate
node_modules/.bin/prisma migrate status
node_modules/.bin/prisma migrate resolve --rolled-back <migration>
```

Then start the stack again with `up -d`.

### Rebuild the search index

Run `npm run db:reindex-search` once after an upgrade that changes the search tokenization
(e.g. #192, word-prefix search): it decrypts every transaction label and
rewrites its search tokens (batches of 500, `-- --batch=N` to change). It is safe to re-run.

- It first checks each stored `labelHash` against `SEARCH_TOKEN_KEY` and stops on a mismatch
  (wrong key).
- After a change to the text normalization, add `-- --rehash` to rewrite
  `labelHash`/`rawLabelHash` too.
- It runs from a source checkout (`npm ci`) whose `.env` points at the target database with the
  same `DATA_ENCRYPTION_KEY`/`SEARCH_TOKEN_KEY`: the Docker runtime image ships neither the
  scripts nor `tsx`. The prod compose does not publish the database port, so the checkout
  needs network access to the `mariadb` container.

### Database pool

The database pool holds 10 connections and a request waits up to 10 s for one. Under heavy
concurrent use (pool timeouts in the logs), raise them with MariaDB driver options appended to
`DATABASE_URL`, e.g.:

```text
DATABASE_URL=mysql://bilan:<MARIADB_PASSWORD>@mariadb:3306/bilan?connectionLimit=20&acquireTimeout=15000
```

MariaDB allows 151 connections by default.

### Rate limits

Rate-limit counters live in the app's memory: they are lost when the `app` container restarts.

### Scheduled jobs

Three token-guarded routes do the periodic work (times in UTC):

| Route                          | Schedule (UTC) | Effect                                                                    |
| ------------------------------ | -------------- | ------------------------------------------------------------------------- |
| `POST /api/cron/roll-budgets`  | 00:05 daily    | Creates the next period of every ended recurring budget                   |
| `POST /api/cron/purge-audit`   | 03:00 daily    | Deletes audit-log entries older than 12 months                            |
| `POST /api/cron/purge-imports` | hourly         | Deletes abandoned import batches older than 24 h (and their partial rows) |

#### The `cron` service

The `cron` service of the compose (same image as the app) calls these routes on that schedule.
It reads only `CRON_SECRET` from `app.env`.

- It calls `purge-imports` once at start and exits if that fails, so a wrong or missing
  `CRON_SECRET` shows up as a restart loop in `docker compose ps`.
- Each call logs one line, `OK <route> <body>` or `ERROR <route> <error>`:
  `docker compose -f docker-compose.prod.yml logs cron`.
- After a host reboot Docker restarts every container at once: the `cron` service may log a few
  `ERROR purge-imports … Connection refused` and restart until the app is up, then settles by
  itself.

#### Host crontab instead

If you run the image without this compose file, call the routes from the host crontab. Cron
jobs don't inherit your shell environment, hence the variable line:

<!-- unverified -->

```cron
CRON_SECRET=<the value from app.env>
5 0 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://bilan.example.com/api/cron/roll-budgets
0 3 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://bilan.example.com/api/cron/purge-audit
0 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://bilan.example.com/api/cron/purge-imports
```

#### Check the secret

```bash
curl -i -X POST -H "Authorization: Bearer <secret>" <APP_URL>/api/cron/purge-imports
```

- `200 {"purged":…}`: the secret is right.
- `401`: wrong secret.
- `404`: `CRON_SECRET` is unset in the app.

## Backup and restore

### What to back up

A database dump alone is not enough: part of the data is encrypted by the app with keys that
only exist in `app.env`.

| Item                              | Why                                                                                                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database dump (`bilan` database)  | All the data.                                                                                                                                                                                                                                         |
| `app.env`                         | `DATA_ENCRYPTION_KEY` encrypts transaction labels and notes, IBANs, merchant aliases, signup and invitation links and the stored SMTP and SSO secrets; `SEARCH_TOKEN_KEY` builds the search index and the link lookups; `AUTH_SECRET` encrypts 2FA secrets. Without them a restored dump is unreadable. |
| `db.env`                          | The database passwords, which `DATABASE_URL` in `app.env` must match.                                                                                                                                                                                 |
| `keyring/keyfile`                 | MariaDB at-rest encryption key: without it the data volume itself can't be read. A dump is plain SQL, so restoring one does not need it.                                                                                                              |
| `docker-compose.prod.yml`, `.env` | The stack definition and the `BILAN_VERSION` you run.                                                                                                                                                                                                 |

Store the env files and the keyring apart from the dumps (e.g. in a password manager): they
change rarely, and anyone who holds both the dumps and the keys can read everything.

The dump holds personal financial data. Labels stay encrypted by the app, but amounts, dates,
account and bank names, user names, e-mail addresses and the IP addresses of the audit log and
sessions are in clear: always encrypt the dump.

### Back up the database

The script below dumps the database from inside the `mariadb` container, compresses it and
encrypts it with a passphrase. The password is read from `MARIADB_PASSWORD` inside the
container (it comes from `db.env`), so it never appears on the host command line.
`--single-transaction` takes a consistent snapshot without locking the app out.

Create the passphrase once, as root, and keep a copy offline: without it the backups are
useless.

```bash
(umask 077; openssl rand -base64 32 > /root/.bilan-backup-pass)
```

Save this as `bilan/backup.sh` and make it executable (`chmod 700 backup.sh`):

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

It exits non-zero and leaves no file if the dump fails (e.g. `mariadb` not running). The last
line keeps 30 days of backups; adjust it to your retention.

To use [age](https://age-encryption.org) instead, the host only needs the public key and the
private key stays offline. Replace the `openssl` line with:

<!-- unverified -->

```bash
  | age -r age1<your public key> \
```

and name the files `*.sql.gz.age` (in the `find` line too).

Check a backup without restoring it: the last line of the dump is `-- Dump completed on …`.

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/root/.bilan-backup-pass \
  -in backups/bilan-<timestamp>.sql.gz.enc | gunzip | tail -n 1
```

### Schedule it

Run the script daily from root's cron (it needs access to Docker), e.g. in
`/etc/cron.d/bilan-backup`:

<!-- unverified -->

```cron
30 2 * * * root /opt/bilan/backup.sh >> /var/log/bilan-backup.log 2>&1
```

Backups on the same disk as the database don't survive a lost host: copy `backups/` elsewhere
(another machine, object storage) with the tool of your choice.

### Restore on a new host

1. Install Docker and recreate the `bilan/` directory with the backed-up
   `docker-compose.prod.yml`, `.env`, `app.env`, `db.env` and `keyring/keyfile`, plus the
   backup passphrase and the dump. Keep the same `app.env`: other keys make the restored data
   unreadable. Use the `BILAN_VERSION` the backup was taken with, or a newer one.
2. Start the database only, on an empty volume:

   ```bash
   docker compose -f docker-compose.prod.yml up -d --wait mariadb
   ```

3. Load the dump:

   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/root/.bilan-backup-pass \
     -in backups/bilan-<timestamp>.sql.gz.enc \
     | gunzip \
     | docker compose -f docker-compose.prod.yml exec -T mariadb \
         sh -c 'exec mariadb -ubilan -p"$MARIADB_PASSWORD" bilan'
   ```

4. Start the rest of the stack. The app applies any migration newer than the dump on start:

   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

To restore over an existing install instead (e.g. to roll back), stop the stack and drop the
database volume first, then follow steps 2 to 4. This deletes the current data:

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm bilan_mariadb_data
```

### Test your restore

A backup you never restored is a guess. From time to time, restore the latest dump on a spare
machine or a copy of the stack, then:

- `docker compose -f docker-compose.prod.yml ps`: `app` is healthy (migrations passed);
- sign in and open the transactions: labels are readable (`DATA_ENCRYPTION_KEY` is right);
- search for a known label (`SEARCH_TOKEN_KEY` is right);
- sign in with an account that has 2FA (`AUTH_SECRET` is right).

<!-- unverified -->

To test on the same host, copy the `bilan/` directory, and in the copy set
`COMPOSE_PROJECT_NAME=bilan-restore-test` and `BILAN_PORT=127.0.0.1:3100` in `.env`, and
`APP_URL=http://localhost:3100` in `app.env`. Reach it through an SSH tunnel
(`ssh -L 3100:127.0.0.1:3100 <host>`). The copy keeps the restored SMTP settings, so it may send
e-mails (e.g. new-login alerts). Remove it afterwards with
`docker compose -f docker-compose.prod.yml down -v`, from the copy only.
