# Cloud saving with Firebase

The editor is a static web app, so it can talk to Firebase directly — no server
of your own to run. Signing in lets a user keep named layouts in their account
and open them again on any device, while the fast `localStorage` working draft
stays exactly where it was.

Everything below is a one-time setup on your own Firebase project. It is free
for this app's scale (Firestore's free tier is 50k reads / 20k writes a day).

---

## 1. Create the project

1. <https://console.firebase.google.com> → **Add project**.
2. Give it a name (e.g. `warehouse-layout`), and you can decline Google
   Analytics.

## 2. Turn on sign-in

**Build → Authentication → Get started**, then under **Sign-in method** enable:

- **Google** — pick a support email and save.
- **Email/Password** — just enable it (leave "Email link" off).

## 3. Create the database

**Build → Firestore Database → Create database**:

- Choose **Production mode** (the rules below replace the defaults).
- Pick the region closest to your users. This cannot be changed later.

Then open the **Rules** tab, paste the contents of
[`firestore.rules`](../firestore.rules) from this repo, and **Publish**.

Those rules are what keep data private — every user can read and write only
`users/{their-own-uid}/…`, and nothing else in the database is reachable.

## 4. Authorise your domain

**Authentication → Settings → Authorized domains → Add domain** and add every
hostname the app is served from:

| Where             | Domain to add                                     |
| ----------------- | ------------------------------------------------- |
| GitHub Pages      | `asif1001.github.io` (or `<your-user>.github.io`) |
| Firebase Hosting  | `<project-id>.web.app`                            |
| Local development | `localhost` (already there by default)            |

Skip this and sign-in fails with _"This site is not authorised in Firebase
yet"_ — the app says so in the dialog, but it is easy to miss.

## 5. Paste the web config

**Project settings** (gear icon) → **Your apps** → the **Web** app (`</>` — add
one if there is none) → **SDK setup and config** → **Config**.

Copy the `firebaseConfig` object into
[`app/js/firebase-config.js`](../app/js/firebase-config.js), replacing the
placeholders:

```js
export const firebaseConfig = {
  apiKey: 'AIza…',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project',
  storageBucket: 'your-project.firebasestorage.app',
  messagingSenderId: '123456789012',
  appId: '1:123456789012:web:abcdef…',
};
```

That config is **not a secret** — it only identifies the project, and the rules
from step 3 are what protect the data. Committing it (and serving it from GitHub
Pages) is normal and expected.

Commit and push. The editor picks it up on the next load.

---

## What gets stored

Two documents per saved layout, sharing one id, under the signed-in user:

```
users/{uid}/layouts/{id}      { name, schemaVersion, bytes, createdAt, updatedAt }
users/{uid}/layoutData/{id}   { data }
```

The split is deliberate: the **My layouts** list only reads the small metadata
documents, so listing twenty layouts does not download twenty plans.

`data` is the same `db_connect` JSON that **Export JSON** writes, minus the
derived `bins` array. Bins are recomputed from the racks when a layout loads
(`fromDbConnect` never reads them) and they are by far the largest part of the
file, so leaving them out keeps a big warehouse well inside Firestore's 1 MiB
per-document limit. The app refuses to save a document over 900 KB and says so,
rather than letting Firestore reject it.

## How it behaves in the app

- **Sign in** — the account button in the toolbar, or any _File →_ cloud entry.
  Google one-click, or email + password (with _Forgot password_).
- **Multiple layouts are account-only.** Signed out you keep one local draft;
  signing in is what unlocks keeping a list of layouts.
- **New layout…** — creates one and saves it to the account in a single step. It
  can start **blank**, from the **sample** layout, or as a **copy of the layout on
  screen**. The account is written _first_, so a failed save leaves the layout you
  had open untouched.
- **Save** (`Ctrl+S`) — syncs immediately. Normally you don't need it: once a
  layout is in your account, **every change saves itself** a couple of seconds
  after you stop typing, and the toolbar shows _unsaved · saving… · synced_. A
  layout that has never been named needs one Save first, because there is nowhere
  to put it yet. If a write fails the toolbar says _not synced_ (hover for the
  reason) and the next edit retries.
- **My layouts…** — everything saved, with the open one marked, plus **Open**,
  **Rename** and **Delete** per row. Opening replaces what is on screen.
- Signed out, or with the config left as placeholders, the editor behaves
  exactly as it always has: nothing is fetched from Firebase and your work stays
  in the browser.

## Deploying the rules from the CLI (optional)

The console is enough, but if you prefer version control:

```bash
npm install -g firebase-tools
firebase login
firebase use --add           # pick your project
firebase deploy --only firestore:rules
```

`firebase.json` in the repo root already points at `firestore.rules`.

## Troubleshooting

| Symptom                                                      | Fix                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| _"This site is not authorised in Firebase yet"_              | Step 4 — add the hostname to **Authorized domains**.                           |
| _"That sign-in method is not enabled for this project"_      | Step 2 — enable Google and/or Email/Password.                                  |
| _"The Firebase API key looks wrong"_                         | Step 5 — re-copy the config; check for a stray quote or a missing field.       |
| _"Firebase refused the request — check the Firestore rules"_ | Step 3 — the rules were not published, or `request.auth` is null (signed out). |
| _"past the … cloud limit"_                                   | The layout is genuinely huge. Split it into zones, or keep using Export JSON.  |
| Nothing happens on **Sign in**                               | The config is still placeholders — the toolbar tooltip says so.                |
