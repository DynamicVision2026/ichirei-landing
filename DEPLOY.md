# Deploying ICHIREI to Google Cloud Run

Everything below works from a browser (GCP Console + **Cloud Shell**, the terminal icon at the top right of the Console) — no local CLI needed.

**What gets deployed:** one container that serves the website *and* `/api/*` (the unchanged engine). Cloud Run allows long requests (we set **300 s**), so the full-depth `claude-sonnet-5` reasoning pass is no longer cut off at Vercel's 60 s.

| | |
|---|---|
| Project ID | `ichirei` |
| Region | `asia-northeast1` (Tokyo) |
| Cloud Run service | `ichirei` |
| Artifact Registry repo | `ichirei` (created in Step 1) |
| Secret | `ANTHROPIC_API_KEY` (Secret Manager) — mounted as an env var, never in the image or repo |
| Domain (later) | `ichirei.soul-id.jp` |

The Vercel setup is untouched and stays live as a fallback until you've confirmed Cloud Run works.

---

## Step 0 — Already done (just confirm)

You've already: created project `ichirei` with billing, enabled **Cloud Run, Cloud Build, Artifact Registry, Secret Manager**, and created the secret `ANTHROPIC_API_KEY` (version 1). Quick check in Cloud Shell:

```bash
gcloud config set project ichirei
gcloud services list --enabled --filter="name:(run OR cloudbuild OR artifactregistry OR secretmanager)" --format="value(name)"
gcloud secrets versions list ANTHROPIC_API_KEY
```
You should see all four services and an `enabled` version 1.

## Step 1 — Create the Artifact Registry repository (one time)

Console → **Artifact Registry → Create repository**: name `ichirei`, format **Docker**, mode **Standard**, location type **Region → asia-northeast1** → **Create**.
Or in Cloud Shell:
```bash
gcloud artifacts repositories create ichirei --repository-format=docker --location=asia-northeast1
```

## Step 2 — Permissions (one time)

Two identities need access:

1. **The identity Cloud Build runs as** (build → push → deploy).
2. **The identity the Cloud Run service runs as** (needs to read the secret).

On new projects both default to the Compute Engine default service account `PROJECT_NUMBER-compute@developer.gserviceaccount.com`. (If the trigger's *Service account* dropdown in Step 3 shows the legacy `PROJECT_NUMBER@cloudbuild.gserviceaccount.com`, use that for `BUILD_SA` below.)

Paste into Cloud Shell:
```bash
PROJECT_ID=ichirei
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Cloud Build identity: build, push image, deploy to Cloud Run, write logs
for role in roles/cloudbuild.builds.builder roles/run.admin roles/iam.serviceAccountUser \
            roles/artifactregistry.writer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${BUILD_SA}" --role="$role" --condition=None --quiet >/dev/null
done

# Cloud Run runtime identity: read the Anthropic key
gcloud secrets add-iam-policy-binding ANTHROPIC_API_KEY \
  --member="serviceAccount:${RUN_SA}" --role=roles/secretmanager.secretAccessor
```

## Step 3 — Connect GitHub and create the build trigger

1. Console → **Cloud Build → Triggers → Create trigger** (labels can differ slightly between Console versions).
2. **Name** `ichirei-deploy`. **Region**: `asia-northeast1` if offered (otherwise `global`; both work — the deploy always goes to Tokyo).
3. **Event**: *Push to a branch*.
4. **Source → Repository**: *Connect new repository* → **GitHub** → sign in and **install/authorize the "Google Cloud Build" GitHub app** for the `DynamicVision2026` organization (an org owner must approve it) → select **`ichirei-landing`** → *Connect*.
5. **Branch** (regex) — **two phases**:
   - **First, for testing: `^claude/cloud-run-migration$`** — the Cloud Run files live only on this branch until you merge.
   - **After you've verified and merged to `main`: edit the trigger to `^main$`.** From then on every push to `main` redeploys automatically.
6. **Configuration**: *Cloud Build configuration file* → location *Repository* → file `/cloudbuild.yaml`.
7. **Service account**: select the account you granted roles to in Step 2.
8. **Create**.

## Step 4 — First deploy

Console → **Cloud Build → Triggers → `ichirei-deploy` → Run → branch `claude/cloud-run-migration` → Run trigger**. Watch **Cloud Build → History** (about 4–6 minutes: build, push, deploy).

When it succeeds, open **Cloud Run → `ichirei`** and copy the service URL (`https://ichirei-xxxxx-an.a.run.app`). Verify:

1. `<URL>/api/health` shows `"apiKeyConfigured": true` and `"applied": { "requestTimeout": 300000, … }`.
2. `<URL>/` shows the landing page; `<URL>/demo` shows the harness.
3. On `/demo`: tap **golden fixture を入れる** → run. The processing screen now runs as long as the reasoning takes (up to ~290 s) instead of dying at 60 s. Expect **迎** as the primary.

## Step 5 — Merge, switch the trigger to `main`

Once the golden fixture works on Cloud Run: merge `claude/cloud-run-migration` into `main`, then change the trigger's branch regex to `^main$` (Step 3.5). Keep Vercel as a fallback until you're satisfied; delete it afterwards.

## Step 6 — Custom domain `ichirei.soul-id.jp`

**Heads-up:** Cloud Run *domain mappings* are still a **Preview** feature, and Google recommends a global external Application Load Balancer for production. `asia-northeast1` is a supported mapping region, and for this validation harness a mapping is the simplest route. (Latency on mapped domains has been reported higher than on the `.run.app` URL — irrelevant for a 2–3 minute reasoning request, but know it exists.) If you later want production-grade, ask for the load-balancer variant.

1. **Verify you own `soul-id.jp`** (needed once; for a subdomain Google verifies the parent domain, and the mapping is tied to the Google account that verifies it — use the account you'll map with):
   Console → **Cloud Run → Manage custom domains → Add mapping**. Pick service `ichirei`, region `asia-northeast1`, choose **Verify a new domain** → it opens **Google Search Console**. Add a **Domain** property `soul-id.jp`; Search Console shows a **TXT record** like `google-site-verification=xxxxxxxx`.
2. **Add that TXT record at Onamae** (below), wait a few minutes, click **Verify** in Search Console.
3. Back in Cloud Run **Add mapping**: service `ichirei`, domain **`ichirei.soul-id.jp`**. The dialog then lists the **exact DNS record(s) to add — that dialog is authoritative; use what it shows.** For a subdomain it is expected to be:

   | Type | Name | Value |
   |---|---|---|
   | CNAME | `ichirei` | `ghs.googlehosted.com.` |

4. **Add the record(s) at Onamae (お名前.com)**:
   お名前.com Navi にログイン → **ドメイン設定 → ドメイン一覧**（または「ドメイン」メニュー）→ `soul-id.jp` を選択 → **DNS関連機能の設定 → DNSレコード設定を利用する → DNSレコード設定**. Add:

   | ホスト名 | TYPE | VALUE | TTL |
   |---|---|---|---|
   | *(空欄 = soul-id.jp 本体)* | TXT | `google-site-verification=…`（Search Console の値） | 3600 |
   | `ichirei` | CNAME | `ghs.googlehosted.com` | 3600 |

   → **追加 → 確認画面へ進む → 設定する**. (Menu wording can differ slightly. If Onamae rejects the CNAME value, retry with a trailing dot: `ghs.googlehosted.com.`. Don't touch other existing records. Records only take effect if `soul-id.jp` uses **Onamae's nameservers**; if its nameservers point elsewhere, add the same records at that DNS provider instead. A host can't have a CNAME and another record at the same time — remove any existing `ichirei` record first.)
5. Wait. DNS can take minutes to hours; the **managed HTTPS certificate usually takes ~15 minutes and can take up to 24 h**. Cloud Run's *Manage custom domains* page shows progress (certificate provisioning → active). Check from Cloud Shell:
   ```bash
   gcloud beta run domain-mappings describe --domain ichirei.soul-id.jp --region asia-northeast1
   ```
6. Open `https://ichirei.soul-id.jp/demo`.

---

## Step 7 — Purchase flow: Shopify checkout + order storage

The site at `/` now ends in a purchase: the sender picks a character, fills in names, delivery date, inscription form and package (Simple ¥9,800 / Standard ¥15,800), and is sent to **Shopify checkout** (store `soul-id-2.myshopify.com`). The **story and the engine result are never sent to Shopify** — they are saved in a private Cloud Storage bucket as `orders/<order_ref>.json`, and the same `order_ref` rides on the Shopify line item so production can look the order up.

What the server needs (check `<URL>/api/health` → `"orders"`; it lists what is still missing, never the values):

| Setting | Where | What |
|---|---|---|
| `SHOPIFY_STOREFRONT_TOKEN` | **Secret Manager** secret (mounted by `cloudbuild.yaml`) | Storefront API access token |
| `SHOPIFY_VARIANT_SIMPLE`, `SHOPIFY_VARIANT_STANDARD` | Cloud Build trigger **substitutions** `_SHOPIFY_VARIANT_SIMPLE`, `_SHOPIFY_VARIANT_STANDARD` | the Shopify variant ids of the two packages |
| `ORDER_BUCKET` | substitution `_ORDER_BUCKET` | the Cloud Storage bucket for orders |

**7a — Shopify admin (browser).**
1. **Products:** create the two packages so their **prices are the source of truth** (the site never sends a price): one product with two variants, or two products — *Simple* **¥9,800** and *Standard* **¥15,800** (tax-included, matching how the store prices). Make both **available to the sales channel / app that owns the Storefront token** (step 2) — a product that is not published to it cannot be put in a cart.
2. **Storefront token:** *Settings → Apps and sales channels → Develop apps → Create an app* → *Configure Storefront API scopes*: **`unauthenticated_read_product_listings`** and **`unauthenticated_write_checkouts`** (plus `unauthenticated_read_checkouts`) → *Install app* → copy the **Storefront API access token**. (You already created the Secret Manager secret `SHOPIFY_STOREFRONT_TOKEN`; if you rotate the token, add a new version there.)
3. **Variant ids:** open each product → the variant → the number at the end of the URL (`…/products/123/variants/`**`45678901234567`**) is the id. Either the number or the full `gid://shopify/ProductVariant/45678901234567` works.
4. The eight line-item attributes (`kanji`, `inscription_form`, `reading`, `sender_name`, `receiver_name`, `delivery_date`, `language`, `order_ref`) show on each order as **line-item properties**; `order_ref` is also on the order itself. `inscription_form` is the **glyph to carve** (after the sender's choice of old/modern or traditional/simplified).

**7b — Cloud Storage bucket + permissions (Cloud Shell).**
```bash
PROJECT_ID=ichirei
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Private bucket in Tokyo (no public access, uniform access control)
gcloud storage buckets create gs://ichirei-orders --location=asia-northeast1 \
  --uniform-bucket-level-access --public-access-prevention

# The Cloud Run runtime identity may create / overwrite / read the order objects
gcloud storage buckets add-iam-policy-binding gs://ichirei-orders \
  --member="serviceAccount:${RUN_SA}" --role=roles/storage.objectUser

# …and read the Shopify token secret
gcloud secrets add-iam-policy-binding SHOPIFY_STOREFRONT_TOKEN \
  --member="serviceAccount:${RUN_SA}" --role=roles/secretmanager.secretAccessor
```
Orders contain **personal data** (names, the sender's story): keep the bucket private, decide a retention period (a bucket *lifecycle rule* can delete objects after N days), and mention it in your privacy policy.

**7c — Trigger substitutions.** Cloud Build → Triggers → `ichirei-deploy` → Edit → *Substitution variables*: `_ORDER_BUCKET` = `ichirei-orders`, `_SHOPIFY_VARIANT_SIMPLE` = `<id>`, `_SHOPIFY_VARIANT_STANDARD` = `<id>`. Save and run the trigger (the deploy now also mounts the new secret).

**7d — Verify.** `<URL>/api/health` → `"orders": { "ready": true, "store": "gcs", … "missing": [] }`. Then on `<URL>/` choose a character, fill the form and press the order button: you land on a Shopify checkout with the package, and the line shows the eight properties. Do **not** complete a real payment while testing (or use Shopify's *Bogus Gateway* / a test order you cancel).

**Looking an order up (production).** Console → **Cloud Storage → `ichirei-orders` → `orders/` → `IC-YYYYMMDD-XXXXXXXX.json`** → *Preview*. The top block **`production`** has everything at a glance — the character and the glyph to carve, reading, **gaze line**, **story anchor**, sender/receiver names, delivery date, package and the **certificate text**; below it are the full `story` and `engine_result`. `status` is `cart_created` once Shopify accepted the cart (`cart_failed` / `pending` orders were never checked out).

**If the order button shows an error:** `503 … not configured` → the health page says which setting is missing; `502 cart_failed` → Shopify refused the cart (most often a variant id that is wrong or not published to the Storefront app; the reason is in the order's `error` field).

---

## Editing the engine prompt

`engine/prompt.ja.md`, `engine/prompt.zh.md` and `engine/prompt.en.md` (and `engine/explain-prompt.ja.md` / `.zh.md` / `.en.md`) are plain text read at request time. Edit → commit → push to the trigger's branch → Cloud Build rebuilds and redeploys automatically (~4–6 min). No code changes. (Editing on github.com in the browser works fine.)

## Changing the timeout

Three numbers must stay in step: Cloud Run `--timeout` (`_TIMEOUT` in `cloudbuild.yaml`, 300 s), the server (`ICHIREI_REQUEST_TIMEOUT_MS` / `ICHIREI_SOCKET_TIMEOUT_MS`, default 300 000 ms), and the frontend deadline (`ENGINE_TIMEOUT_MS` in `src/demo/DemoApp.tsx`, 290 s — keep it just under the server's). Cloud Run's maximum is 3600 s.

## Rollback

Cloud Run → `ichirei` → **Revisions** → pick the previous revision → **Manage traffic → 100%**. Or point users back at the Vercel deployment.

## Cost / abuse note

The site is public (`--allow-unauthenticated`) and every `/demo` run spends Anthropic tokens. Mitigations already in place: `--max-instances=3`, scale-to-zero. Recommended: set a **monthly spend limit in the Anthropic Console**, and share the URL sparingly. A password gate or Identity-Aware Proxy can be added later.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Deploy step: *Permission denied on secret* | Run the `secrets add-iam-policy-binding` in Step 2 (runtime identity needs `secretAccessor`). |
| Deploy step: *artifact repo not found* / push denied | Step 1 not done, or build identity lacks `artifactregistry.writer`. |
| Deploy step: *cannot set IAM policy / allUsers* | An organization policy blocks public access. Allow it for this project, or remove `--allow-unauthenticated` and front the service differently. |
| Trigger can't see the repo | GitHub app not approved for the org (Step 3.4). |
| `/api/health` → `apiKeyConfigured: false` | Secret not mounted: check Cloud Run → `ichirei` → Revisions → Variables & Secrets, and Step 2's secret grant. |
| Blank page | Image built without `ICHIREI_BASE=/` (the Dockerfile sets it; don't remove it). |
| Run is cut off at exactly 300 s | Raise the three timeout numbers together (above). |
| Certificate stuck on *provisioning* | DNS not yet correct/propagated; confirm the CNAME with `dig ichirei.soul-id.jp CNAME`; if you use a proxying DNS service, turn the proxy off for this record. |

## Local container test (optional, needs Docker)

```bash
docker build -t ichirei:local .
node scripts/test-container.mjs        # runs the image against a fake model upstream, no key needed
```
