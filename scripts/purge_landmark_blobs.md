# Purge downloaded landmark images from git history

Once `docs/landmarks/manifest.json` is fully **hotlink-based** (every `src` is an
`https://upload.wikimedia.org/...` URL — run `scripts/fetch_landmarks.py`), the
self-hosted JPGs under `docs/landmarks/<COUNTY_ID>/` are dead weight. Deleting
them from the working tree is easy; reclaiming the ~9.4 MB they occupy in git
**history** requires a history rewrite + force-push.

> ⚠️ A history rewrite changes every commit hash after the first touched commit.
> Anyone with a clone must re-clone (or hard-reset). `git push --force` is
> required and is intentionally blocked in this agent's sandbox, so **run the
> force-push yourself** after reviewing. Make a backup branch/clone first.

---

## Step 0 — verify the manifest no longer points at local files

```bash
# should print 0 — no entry still uses a repo-relative path
python3 - <<'PY'
import json
m = json.load(open("docs/landmarks/manifest.json"))
local = [k for k,v in m.items()
         for im in v.get("images", []) if not im["src"].startswith("http")]
print("entries still self-hosted:", len(local))
PY
```

## Step 1 — remove the JPGs from the working tree and HEAD (already done by the fix)

```bash
git rm -r --cached docs/landmarks/*/        # un-track the per-county image folders
rm -rf docs/landmarks/*/                     # delete the files (manifest.json stays)
git add docs/landmarks/manifest.json
git commit -m "Landmarks: hotlink Commons URLs for all counties; drop self-hosted JPGs"
```

This stops the images appearing in **new** history. It does **not** shrink the
repo — the blobs still live in older commits. Steps 2–4 remove them for good.

## Step 2 — back up, then rewrite history

```bash
git branch backup/pre-blob-purge            # safety net (local)
# or: cp -R ../travelOS ../travelOS.bak
```

### Option A — git filter-repo (recommended)

```bash
brew install git-filter-repo      # or: pip3 install git-filter-repo

# Strip every JPG under a county folder from ALL history, keep manifest.json.
git filter-repo --invert-paths \
  --path-regex '^docs/landmarks/[^/]+/.*\.(jpg|jpeg|png)$' --force
```

`--path-regex` matches `docs/landmarks/<ID>/<file>.jpg` only — `manifest.json`
sits directly under `docs/landmarks/` and is left untouched.

### Option B — BFG Repo-Cleaner

```bash
brew install bfg
# BFG protects HEAD by default, so Step 1's commit must already be in place.
bfg --delete-folders 'CN-*' --no-blob-protection   # county folders are named CN-XX-...
# (or target by type)  bfg --delete-files '*.{jpg,jpeg}'   # repo-wide — check nothing else needs jpgs first
```

## Step 3 — reclaim the space locally

```bash
git reflog expire --expire=now --all
git gc --prune=now --aggressive
du -sh .git        # should drop by ~9–10 MB
```

## Step 4 — publish the rewritten history (you run this)

```bash
git push --force origin main
```

Then anyone else with a clone must re-clone or:

```bash
git fetch origin && git reset --hard origin/main
```

---

### Note: filter-repo removes the `origin` remote

`git filter-repo` deletes remotes as a safety measure. Re-add before pushing:

```bash
git remote add origin git@github.com:alexkou/travelOS.git   # adjust URL
git push --force origin main
```

### GitHub note

The rewritten commits drop the blobs, but GitHub keeps unreachable objects for a
while. They are not served by Pages and are eventually garbage-collected. If you
need them gone immediately, contact GitHub Support after the force-push.
