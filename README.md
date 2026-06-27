# MO-Mint 🌊

A Canadian-focused personal finance app. Manual entry by design. Your data lives in your own Firebase — not ours.

Built with vanilla JavaScript, Firebase Firestore, and Google Auth. Hosted on GitHub Pages. No server required.

---

## Why MO-Mint?

Most personal finance apps assume a US banking model: chequing account, credit cards, done. Canadian finances are different — lines of credit used as operating accounts, LOCs for revolving debt, GICs, registered accounts with their own rules. MO-Mint is built around how Canadians actually bank.

The other thing: **your data never touches our infrastructure.** You run your own Firebase project. We have no access to your accounts, balances, or transactions — by design, not just by policy.

---

## Features

- **Accounts** — assets and liabilities grouped by type (liquid, LOC, credit card, registered, other); drag to reorder; pin your operating account
- **Transactions** — manual entry with categories, transfers between accounts, CSV import with duplicate detection; filter by account with running balance
- **Budgets** — monthly category budgets with progress bars; refunds and reimbursements correctly net against spending
- **Forecast** — projects net worth and debt over 6 or 12 months using your recurring entries and real compound interest; debt payoff table with projected payoff dates
- **Net worth** — assets vs. liabilities breakdown with snapshot export to a formatted HTML report
- **Recurring entries** — income, expenses, and transfers at any frequency (weekly through annual)
- **Bills due** — upcoming payment dates with business-day countdown, colour-coded by urgency
- **Dark / light theme**

---

## Privacy model

When you set up MO-Mint, you create your own free Firebase project. Your financial data is stored there — in your Google account, under your control. The person who shared this repo with you cannot see it. Nobody can, except you.

See [SETUP.md](SETUP.md) for full instructions.

---

## Tech stack

- Vanilla JavaScript (no framework)
- Firebase Firestore (database)
- Firebase Authentication (Google Sign-In)
- Chart.js (spending ring, forecast chart, monthly bar chart)
- SortableJS (drag-to-reorder accounts)
- Tabler Icons
- GitHub Pages (hosting)

---

## Getting started

→ [SETUP.md](SETUP.md)

---

## License

MIT — free to use, fork, and modify. See [LICENSE](LICENSE).
