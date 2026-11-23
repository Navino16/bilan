<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
    <img src="docs/images/logo.svg" alt="Bilan" width="300">
  </picture>
</p>

<p align="center">
  A self-hosted, multi-user personal-finance app.<br/>
  Import your bank statements, categorize them automatically, follow your budgets<br/>
  and share accounts with your household, on your own server.
</p>

<p align="center">
  <a href="https://github.com/Navino16/bilan/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Navino16/bilan/ci.yml?label=CI&style=flat-square" alt="CI"></a>
  <a href="https://github.com/Navino16/bilan/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/Navino16/bilan/build.yml?label=Build&style=flat-square&logo=docker" alt="Build"></a>
</p>

<p align="center">
  <a href="https://github.com/Navino16/bilan/pkgs/container/bilan"><img src="https://img.shields.io/badge/ghcr.io-bilan-blue?style=flat-square&logo=docker" alt="Docker"></a>
  <a href="https://github.com/Navino16/bilan"><img src="https://img.shields.io/github/stars/Navino16/bilan?style=flat-square" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Navino16/bilan?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="docs/user-guide.md">User guide</a> &bull;
  <a href="docs/admin-guide.md">Administrator guide</a> &bull;
  <a href="docs/self-hosting.md">Self-hosting</a> &bull;
  <a href="docs/development.md">Development</a>
</p>

<p align="center">
  <strong>English</strong> &bull; <a href="README.fr.md">Français</a>
</p>

---

_Bilan_ is French for "balance sheet" / "financial overview". Available in English and French.

Built with Next.js 16, React 19, Prisma 7 and MariaDB 11.

## Screenshots

![Dashboard](docs/images/en/dashboard.png)

<table>
  <tr>
    <th width="50%">Transactions</th>
    <th width="50%">Import</th>
  </tr>
  <tr>
    <td><img src="docs/images/en/transactions.png" alt="Transactions"></td>
    <td><img src="docs/images/en/import-preview.png" alt="Import"></td>
  </tr>
  <tr>
    <th>Transaction details</th>
    <th>Budget</th>
  </tr>
  <tr>
    <td><img src="docs/images/en/transaction-detail.png" alt="Transaction details"></td>
    <td><img src="docs/images/en/budget-detail.png" alt="Budget"></td>
  </tr>
</table>

## Features

### Accounts and transactions

- Checking, savings and other accounts, with an encrypted IBAN shown only after a recent sign-in
- Search, filters and sorting, notes, manual entry and bulk actions
- **Transaction links** — internal transfers and refunds paired so they don't count twice,
  with suggestions

### Import

- **CSV** statements — column mapping, decimal mark, date order
- **PDF** statements
- Duplicate detection, a preview before anything is saved, one-click undo

### Categorization

- Custom categories and sub-categories, merchants
- **Rules** with priorities and hit counts, learned from your corrections

### Budgets

- One-off or recurring, renewed each period
- Per-category lines, include or exclude single transactions
- Personal or household budgets

### Households

- Invite people by e-mail, link or code
- Share accounts read-only or with write access

### Dashboard and insights

- Income, expenses and balance for any period, compared with the previous one
- Spending by category, day by day, and what changed the most

### Security and privacy

- **Encryption at rest** — encrypted database (MariaDB keyring) and application-level
  encryption of labels, notes, IBANs and secrets
- **Two-factor authentication** (TOTP, backup codes, trusted devices) and **passkeys**
- **SSO** — OpenID Connect and Google
- Sign-in alerts by e-mail, signed-in devices, sign-in rate limits
- Per-user data export (CSV, full JSON) and account deletion

### Administration

- Setup wizard for the first administrator account
- Roles — User, Administrator, Super administrator
- Registration modes — open, invite only (invitation tokens) or disabled
- SMTP, e-mail verification, mandatory two-factor authentication for administrators
- **Audit log** with filters, kept 12 months

### UI

- English and French, light and dark themes
- Responsive, installable on mobile as a web app (PWA)

## Quick start

Bilan runs from published Docker images with MariaDB, behind an HTTPS reverse proxy. See the
[self-hosting guide](docs/self-hosting.md) for the files to create and the commands to run.
A fresh install opens on a setup wizard that creates the first administrator account.

Back up `app.env` along with the database: `DATA_ENCRYPTION_KEY` encrypts labels, notes,
IBANs and stored secrets, `AUTH_SECRET` encrypts two-factor secrets and backup codes, and
`SEARCH_TOKEN_KEY` builds the search index. Without them a restored database is unreadable. See
[Backup and restore](docs/self-hosting.md#backup-and-restore).

## Development

See [docs/development.md](docs/development.md) for the development setup, the demo data and the
scripts.

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a
network service, you must offer its source code to its users.

## Security

Please report vulnerabilities privately, see [SECURITY.md](SECURITY.md).
