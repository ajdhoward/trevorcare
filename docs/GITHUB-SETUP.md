# GitHub setup — from this portal to your repo, then to Cloudflare

The portal ships with a one-click push button and CI workflows. This guide is
the full manual path with the exact clicks, so nothing is a mystery.

## 1 · Create the repository (one minute)

1. GitHub → **New repository**.
2. Name it (e.g. `family-care-hub`), set **Private** — the portal carries
   health data; never make it public.
3. Leave **README, .gitignore and licence unticked** — it must start empty so
   the push is clean.

## 2 · Give a token access to *only that repo*

1. GitHub → Settings → **Developer settings** → Personal access tokens →
   **Fine-grained tokens** → *Generate new token*.
2. **Repository access:** "Only select repositories" → pick just this repo.
3. **Permissions:** Contents: **Read and write** (Metadata is auto-granted).
   Nothing else.
4. Expiry: 7–30 days is plenty. You can revoke instantly at any time; nothing
   breaks permanently — issue a fresh one when needed.

## 3 · Push

**Option A — the button (no terminal):** Deploy & sync → step 1 → paste the
repo URL and the token → **Push portal to repo**. The token is used for that
single request, never stored, and the audit trail records the push.

**Option B — the terminal:**

```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`.env`, the SQLite database and all private-data patterns are excluded by
`.gitignore` — check with `git status` if you want to see exactly what goes.

## 4 · Wire up GitHub Actions (optional but recommended)

The repo ships two workflows:

| Workflow | What it does | Needs |
|---|---|---|
| `ci.yml` | Typechecks, verifies demo data, and trips on any real-identity marker | nothing — runs automatically |
| `deploy.yml` | Deploys the AI worker (`cloudflare-worker/`) to Cloudflare on every push to `main` | repo secret `CLOUDFLARE_API_TOKEN` (Cloudflare token template **"Edit Cloudflare Workers"**), optional `CLOUDFLARE_ACCOUNT_ID` |

Add secrets under repo → Settings → Secrets and variables → Actions.

For the **full portal** on Cloudflare, use the *Deploy to Cloudflare* button in
Deploy & sync (step 2) — it provisions Workers, D1, KV and R2 and hands you a
URL; or connect Workers Builds (step 5, Path A) for push-to-deploy on the whole
app.

## 5 · Housekeeping

- After the push, revoke the fine-grained token (or let it expire).
- Keep the repo **private**; the public-facing artefact is the *depersonalised
  engine with sample data* — if you want to open-source the engine, push a
  fresh copy with your `public/data/*.json` and `public/downloads/` removed and
  the `.gitignore` patterns doing the exclusion (this repo is already structured
  so that a fresh clone boots on sample data).
- Every push lands in the portal's audit trail when done through the button;
  terminal pushes are visible in `git log`.
