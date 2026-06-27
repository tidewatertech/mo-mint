# MO-Mint Setup Guide

This guide walks you through getting your own instance of MO-Mint running. You'll end up with a personal finance app hosted on GitHub Pages, backed by your own Firebase project that only you can access.

Estimated time: **20–30 minutes**, mostly waiting for Firebase to provision things.

---

## Prerequisites

- A Google account
- A GitHub account
- Basic comfort with copying and pasting code

No coding experience required beyond that.

---

## Step 1 — Fork the repository

1. Go to the MO-Mint repository on GitHub
2. Click **Fork** (top right)
3. Choose your account as the destination
4. Leave the repository name as-is or rename it — doesn't matter

You now have your own copy of the code.

---

## Step 2 — Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project**
3. Give it a name (e.g. `mo-mint-yourname`) — this is just for your reference
4. Disable Google Analytics when prompted (you don't need it)
5. Click **Create project** and wait for it to finish

---

## Step 3 — Enable Google Authentication

1. In your Firebase project, click **Authentication** in the left sidebar
2. Click **Get started**
3. Under **Sign-in providers**, click **Google**
4. Toggle it to **Enabled**
5. Add your email as a support email when prompted
6. Click **Save**

---

## Step 4 — Enable Firestore

1. Click **Firestore Database** in the left sidebar
2. Click **Create database**
3. Choose **Start in production mode** (not test mode — security rules come next)
4. Choose a region close to you (for Canada: `northamerica-northeast1` is Montreal, `us-central` also works fine)
5. Click **Enable** and wait

---

## Step 5 — Set security rules

This is the important step. These rules ensure only you can access your data — not even the person who built MO-Mint.

1. In Firestore, click the **Rules** tab
2. Replace everything in the editor with:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
    }
  }
}
```

3. Click **Publish**

What this does: each user's data is stored at `users/{their Google uid}/...`. The rule says you can only read or write your own path. Nobody else — including the repo owner — can access your data through the app or the Firebase SDK.

---

## Step 6 — Get your Firebase config

1. In your Firebase project, click the **gear icon** (Project settings) near the top of the left sidebar
2. Scroll down to **Your apps**
3. Click the **</>** (web) icon to add a web app
4. Give it a nickname (e.g. `mo-mint`) — don't enable Firebase Hosting
5. Click **Register app**
6. You'll see a code block containing a `firebaseConfig` object that looks like this:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

Copy the entire object — you'll need it in the next step.

---

## Step 7 — Add your config to the repo

1. In your forked GitHub repository, find the file `firebase-config.template.js`
2. Click the pencil icon to edit it
3. Replace the placeholder values with your actual config values from Step 6
4. Rename the file: change the filename at the top from `firebase-config.template.js` to `firebase-config.js`
5. Click **Commit changes**

> **Note:** `firebase-config.js` values are designed to be public — they're just identifiers, not passwords. The security rules you set in Step 5 are what actually protect your data.

---

## Step 8 — Enable GitHub Pages

1. In your forked repo, go to **Settings** → **Pages**
2. Under **Source**, select **Deploy from a branch**
3. Choose **main** branch, **/ (root)** folder
4. Click **Save**

GitHub will give you a URL like `https://yourusername.github.io/mo-mint/`. It may take a minute or two to go live.

---

## Step 9 — Sign in and set up

1. Open your GitHub Pages URL
2. Click **Sign in with Google**
3. Use the same Google account you used to create the Firebase project (or any Google account — the security rules allow any authenticated user to create their own data space)
4. You'll land on an empty dashboard

**Recommended first steps:**
1. Go to **Accounts** and add your accounts — start with your primary chequing or LOC, then add debts and savings
2. For each account, set the opening balance and the **As of** date (this is the anchor the app uses to compute live balances from your transactions)
3. Go to **Forecast → Recurring entries** and add your regular income and expenses
4. Import transactions via CSV if you have them, or start entering manually

---

## CSV import format

Transactions can be imported from a CSV file. The required columns are:

| Column | Required | Notes |
|--------|----------|-------|
| `date` | Yes | YYYY-MM-DD format |
| `payee` | Yes | Description / merchant name |
| `amount` | Yes | Positive number (direction set by `type`) |
| `type` | Yes | `in`, `out`, or `transfer` |
| `account` | Yes | Must exactly match an account name in the app |
| `toAccount` | For transfers | Must exactly match an account name |
| `category` | No | See category list below |
| `notes` | No | Free text |

**Categories:** `housing`, `groceries`, `transport`, `dining`, `utilities`, `health`, `personal`, `kids`, `subscriptions`, `entertainment`, `savings`, `debt`, `income`, `other`

Account names in the CSV must exactly match what you've entered in the app (including capitalization and spacing). The importer will warn you about any mismatches.

---

## Accounts CSV import format

You can also bulk-import accounts from a CSV:

| Column | Required | Notes |
|--------|----------|-------|
| `name` | Yes | Account display name |
| `type` | No | Account type (freeform) |
| `group` | No | `liquid`, `loc`, `credit-card`, `registered`, `other-asset`, `other-liability` |
| `balance` | No | Opening balance amount |
| `openingAsOf` | No | Anchor date, YYYY-MM-DD (defaults to 2026-06-01 if omitted) |
| `rate` | No | Annual interest rate, e.g. `8.94%` |
| `notes` | No | Free text |
| `isLiability` | No | `true` or `false` |

---

## Troubleshooting

**Blank screen after sign-in:** Check that `firebase-config.js` exists in your repo (not `firebase-config.template.js`) and that the values are correct.

**"Permission denied" errors in the console:** Your Firestore security rules may not have been published. Go back to Step 5.

**Balances look wrong:** Check the `openingAsOf` date on each account. The balance shown is your opening balance plus every transaction on or after that date. If the anchor date is wrong, the live balance will be off.

**Transfers not affecting both accounts:** The account names in the transfer must exactly match the names in your Accounts list. Check for extra spaces or capitalization differences.

**CSV import skipping rows:** The importer skips rows where it can't find a matching account name. Check the toast notification after import — it will list any unrecognized account names.

---

## Questions

Open an issue on the GitHub repository.
