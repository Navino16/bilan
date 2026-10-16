[English](README.md) · **Français**

# Bilan

Une application de finances personnelles multi-utilisateur, à héberger soi-même. Importez vos
relevés bancaires, catégorisez-les automatiquement, suivez vos budgets et partagez des comptes
avec votre foyer, sur votre propre serveur. Disponible en français et en anglais.

![Tableau de bord de Bilan](docs/images/fr/dashboard.png)

## Fonctionnalités

- **Comptes et transactions** : comptes courants, épargne et autres, saisie manuelle,
  recherche, filtres, notes, actions groupées.
- **Import** : relevés CSV (correspondance des colonnes, séparateur décimal, ordre des dates,
  détection des doublons) et PDF, avec un aperçu avant tout enregistrement et une annulation en
  un clic.
- **Catégorisation** : catégories personnalisées, règles apprises de vos corrections,
  suggestions.
- **Liens entre transactions** : virements internes et remboursements appariés pour ne pas
  être comptés deux fois.
- **Budgets** : ponctuels ou récurrents, lignes par catégorie, personnels ou de foyer.
- **Foyers** : invitations par e-mail, lien ou code, partage de comptes en lecture seule ou en
  écriture.
- **Analyses** : tableau de bord et comparaison entre périodes.
- **Sécurité** : chiffrement au repos (base de données et application), double
  authentification, passkeys, SSO (OIDC, Google), journal d'audit, export et suppression des
  données par utilisateur.
- **Installable** sur mobile comme application web (PWA), thèmes clair et sombre.

## Documentation

| Guide                                            | Pour qui                                                      |
| ------------------------------------------------ | ------------------------------------------------------------- |
| [Guide d'utilisation](docs/user-guide.fr.md)     | L'usage courant : import, catégorisation, budgets, foyers     |
| [Guide d'administration](docs/admin-guide.fr.md) | Utilisateurs, rôles, inscription, SSO, SMTP, journal d'audit  |
| [Auto-hébergement](docs/self-hosting.fr.md)      | Installation Docker, reverse proxy, sauvegardes, exploitation |

## Démarrage rapide (auto-hébergement)

Bilan tourne à partir d'images Docker publiées, avec MariaDB, derrière un reverse proxy HTTPS.
Le [guide d'auto-hébergement](docs/self-hosting.fr.md) détaille les fichiers à créer et les
commandes à lancer. Une installation neuve s'ouvre sur un assistant qui crée le premier compte
administrateur.

Sauvegardez `app.env` avec la base : `DATA_ENCRYPTION_KEY` chiffre les libellés, notes, IBAN et
secrets enregistrés, `AUTH_SECRET` chiffre les secrets de double authentification et les codes
de secours, et `SEARCH_TOKEN_KEY` construit l'index de recherche. Sans eux, une base restaurée
est illisible. Voir [Sauvegarde et restauration](docs/self-hosting.fr.md#sauvegarde-et-restauration).

## Développement

Prérequis : Node 24, Docker.

```bash
npm ci
npm run setup        # génère .env et le keyring MariaDB, démarre MariaDB, migre et seede
npm run dev          # http://localhost:3000 (ou : docker compose up -d app)
npm run db:seed-dev  # utilisateur de démo, facultatif
```

Le jeu de démo, les scripts npm et l'exécution des tests e2e sont décrits dans la
[version anglaise](README.md#development) de ce fichier.

## Licence

[GNU Affero General Public License v3.0](LICENSE). Si vous faites tourner une version modifiée
comme service en ligne, vous devez en proposer le code source à ses utilisateurs.

## Sécurité

Signalez les vulnérabilités en privé, voir [SECURITY.md](SECURITY.md).
