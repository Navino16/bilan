<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
    <img src="docs/images/logo.svg" alt="Bilan" width="300">
  </picture>
</p>

<p align="center">
  Une application de finances personnelles multi-utilisateur, à héberger soi-même.<br/>
  Importez vos relevés bancaires, catégorisez-les automatiquement, suivez vos budgets<br/>
  et partagez des comptes avec votre foyer, sur votre propre serveur.
</p>

<p align="center">
  <a href="https://github.com/Navino16/bilan/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Navino16/bilan/ci.yml?label=CI&style=flat-square" alt="CI"></a>
  <a href="https://github.com/Navino16/bilan/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/Navino16/bilan/build.yml?label=Build&style=flat-square&logo=docker" alt="Build"></a>
</p>

<p align="center">
  <a href="https://github.com/Navino16/bilan/pkgs/container/bilan"><img src="https://img.shields.io/badge/ghcr.io-bilan-blue?style=flat-square&logo=docker" alt="Docker"></a>
  <a href="https://github.com/Navino16/bilan"><img src="https://img.shields.io/github/stars/Navino16/bilan?style=flat-square" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Navino16/bilan?style=flat-square" alt="Licence"></a>
</p>

<p align="center">
  <a href="docs/user-guide.fr.md">Guide d'utilisation</a> &bull;
  <a href="docs/admin-guide.fr.md">Guide d'administration</a> &bull;
  <a href="docs/self-hosting.fr.md">Auto-hébergement</a> &bull;
  <a href="docs/development.md">Développement</a>
</p>

<p align="center">
  <a href="README.md">English</a> &bull; <strong>Français</strong>
</p>

---

Disponible en français et en anglais.

Construit avec Next.js 16, React 19, Prisma 7 et MariaDB 11.

## Captures d'écran

![Tableau de bord](docs/images/fr/dashboard.png)

<table>
  <tr>
    <th width="50%">Transactions</th>
    <th width="50%">Import</th>
  </tr>
  <tr>
    <td><img src="docs/images/fr/transactions.png" alt="Transactions"></td>
    <td><img src="docs/images/fr/import-preview.png" alt="Import"></td>
  </tr>
  <tr>
    <th>Détail d'une transaction</th>
    <th>Budget</th>
  </tr>
  <tr>
    <td><img src="docs/images/fr/transaction-detail.png" alt="Détail d'une transaction"></td>
    <td><img src="docs/images/fr/budget-detail.png" alt="Budget"></td>
  </tr>
</table>

## Fonctionnalités

### Comptes et transactions

- Comptes courants, épargne et autres, avec un IBAN chiffré affiché seulement après une
  connexion récente
- Recherche, filtres et tri, notes, saisie manuelle et actions groupées
- **Liens entre transactions** : virements internes et remboursements appariés pour ne pas être
  comptés deux fois, avec des suggestions

### Import

- Relevés **CSV** : correspondance des colonnes, séparateur décimal, ordre des dates
- Relevés **PDF**
- Détection des doublons, aperçu avant tout enregistrement, annulation en un clic

### Catégorisation

- Catégories et sous-catégories personnalisées, marchands
- **Règles** avec priorités et compteur d'utilisations, apprises de vos corrections

### Budgets

- Ponctuels ou récurrents, renouvelés à chaque période
- Lignes par catégorie, inclusion ou exclusion de transactions précises
- Budgets personnels ou de foyer

### Foyers

- Invitations par e-mail, lien ou code
- Partage de comptes en lecture seule ou en écriture

### Tableau de bord et analyses

- Revenus, dépenses et solde sur n'importe quelle période, comparés à la précédente
- Dépenses par catégorie, jour par jour, et ce qui a le plus changé

### Sécurité et confidentialité

- **Chiffrement au repos** : base chiffrée (keyring MariaDB) et chiffrement applicatif des
  libellés, notes, IBAN et secrets
- **Double authentification** (TOTP, codes de secours, appareils de confiance) et **passkeys**
- **SSO** : OpenID Connect et Google
- Alertes de connexion par e-mail, appareils connectés, limitation des tentatives de connexion
- Export des données par utilisateur (CSV, JSON complet) et suppression du compte

### Administration

- Assistant de première installation qui crée le compte administrateur
- Rôles : Utilisateur, Administrateur, Super-administrateur
- Modes d'inscription : ouvert, sur invitation (jetons d'invitation) ou désactivé
- SMTP, vérification des adresses e-mail, double authentification obligatoire pour les
  administrateurs
- **Journal d'audit** avec filtres, conservé 12 mois

### Interface

- Français et anglais, thèmes clair et sombre
- Responsive, installable sur mobile comme application web (PWA)

## Démarrage rapide

Bilan tourne à partir d'images Docker publiées, avec MariaDB, derrière un reverse proxy HTTPS.
Le [guide d'auto-hébergement](docs/self-hosting.fr.md) détaille les fichiers à créer et les
commandes à lancer. Une installation neuve s'ouvre sur un assistant qui crée le premier compte
administrateur.

Sauvegardez `app.env` avec la base : `DATA_ENCRYPTION_KEY` chiffre les libellés, notes, IBAN et
secrets enregistrés, `AUTH_SECRET` chiffre les secrets de double authentification et les codes
de secours, et `SEARCH_TOKEN_KEY` construit l'index de recherche. Sans eux, une base restaurée
est illisible. Voir [Sauvegarde et restauration](docs/self-hosting.fr.md#sauvegarde-et-restauration).

## Développement

L'installation de développement, le jeu de démo et les scripts sont décrits dans
[docs/development.md](docs/development.md) (en anglais).

## Licence

[GNU Affero General Public License v3.0](LICENSE). Si vous faites tourner une version modifiée
comme service en ligne, vous devez en proposer le code source à ses utilisateurs.

## Sécurité

Signalez les vulnérabilités en privé, voir [SECURITY.md](SECURITY.md).
