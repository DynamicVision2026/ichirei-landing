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

The site at `/` now ends in a purchase: the sender picks a character, fills in names, delivery date, inscription form and package (Simple ¥9,800 / Standard ¥18,850), and is sent to **Shopify checkout** (store `soul-id-2.myshopify.com`). The **story and the engine result are never sent to Shopify** — they are saved in a private Cloud Storage bucket as `orders/<order_ref>.json`, and the same `order_ref` rides on the Shopify line item so production can look the order up.

What the server needs (check `<URL>/api/health` → `"orders"`; it lists what is still missing, never the values):

| Setting | Where | What |
|---|---|---|
| Storefront token | the Secret Manager secret `SHOPIFY_STOREFRONT_TOKEN` that `cloudbuild.yaml` mounts (**the secret must exist or the deploy fails** — this caused the early build failures), and optionally the trigger substitution `_SHOPIFY_STOREFRONT_TOKEN`, which wins when set. The token is the **public** Storefront token, public by design | Storefront API access token |
| `SHOPIFY_VARIANT_SIMPLE`, `SHOPIFY_VARIANT_STANDARD` | Cloud Build **substitutions** `_SHOPIFY_VARIANT_SIMPLE`, `_SHOPIFY_VARIANT_STANDARD` (defaults in `cloudbuild.yaml`: `67789502447864` = シンプル `ICHIREI-SIMPLE`, `67789502480632` = スタンダード `ICHIREI-STANDARD`) | the Shopify variant ids of the two packages |
| `ORDER_BUCKET` | substitution `_ORDER_BUCKET` | the Cloud Storage bucket for orders |

**7a — Shopify admin (browser).**
1. **Products:** create the two packages so their **prices are the source of truth** (the site never sends a price): one product with two variants, or two products — *Simple* **¥9,800** and *Standard* **¥18,850** (tax-included, matching how the store prices). Make both **available to the sales channel / app that owns the Storefront token** (step 2) — a product that is not published to it cannot be put in a cart.
2. **Storefront token:** *Settings → Apps and sales channels → Develop apps → Create an app* → *Configure Storefront API scopes*: **`unauthenticated_read_product_listings`** and **`unauthenticated_write_checkouts`** (plus `unauthenticated_read_checkouts`) → *Install app* → copy the **Storefront API access token**. (You already created the Secret Manager secret `SHOPIFY_STOREFRONT_TOKEN`; if you rotate the token, add a new version there.)
3. **Variant ids:** open each product → the variant → the number at the end of the URL (`…/products/123/variants/`**`45678901234567`**) is the id. Either the number or the full `gid://shopify/ProductVariant/45678901234567` works.
4. The nine line-item attributes (`kanji`, `inscription_form`, `reading`, `certificate_meaning_en`, `sender_name`, `receiver_name`, `delivery_date`, `language`, `order_ref`) show on each order as **line-item properties**; `order_ref` is also on the order itself. `inscription_form` is the **glyph to carve** (after the sender's choice of old/modern or traditional/simplified).

**Remembrance orders** (the sender chose the occasion 偲ぶ / 追思 / In memory — a story about someone who has died; the character is kept by the sender or their family) carry a **tenth** line-item property, `ichirei_memorial` = `yes`, and `certificate.memorial` is `true` in the stored order. It means: **carve in black or gold; no red seal and no red-and-white cord** (in Japan a red name on a grave means a living person). Living-person orders have no such property. `receiver_name` is then the name of the person being remembered; the delivery address is simply the buyer's own.

`certificate_meaning_en` is the one-phrase English meaning printed on the bilingual certificate. The order result also stores a `certificate` object (`character`, `reading`, `romanization`, `meaning_en`, `line`, `line_en`) built by code.

**Analytics (no setup).** The same bucket also receives privacy-safe choice events under `analytics/YYYY-MM-DD.jsonl` (random session id, language, relationship, occasion, slot, choice, explained, ordered — no story, names or kanji text). Read them with `node scripts/report-choices.mjs --bucket <ORDER_BUCKET>` in Cloud Shell.

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

**7d — Verify.** `<URL>/api/health` → `"orders": { "ready": true, "store": "gcs", … "missing": [] }`. Then on `<URL>/` choose a character, fill the form and press the order button: you land on a Shopify checkout with the package, and the line shows the nine properties. Do **not** complete a real payment while testing (or use Shopify's *Bogus Gateway* / a test order you cancel).

**Looking an order up (production).** Console → **Cloud Storage → `ichirei-orders` → `orders/` → `IC-YYYYMMDD-XXXXXXXX.json`** → *Preview*. The top block **`production`** has everything at a glance — the character and the glyph to carve, reading, **gaze line**, **story anchor**, sender/receiver names, delivery date, package and the **certificate text**; below it are the full `story` and `engine_result`. `status` is `cart_created` once Shopify accepted the cart (`cart_failed` / `pending` orders were never checked out).

**If the order button shows an error:** `503 … not configured` → the health page says which setting is missing; `502 cart_failed` → Shopify refused the cart (most often a variant id that is wrong or not published to the Storefront app; the reason is in the order's `error` field).

---

## Step 8 — `/track`: order status (read-only)

`https://ichirei.soul-id.jp/track` (the order confirmation email links to `/track?order=%231016`) takes an **order number + email** and shows 制作中 / 発送済み (+ carrier, tracking number, link) / お届け完了, or a short cancellation notice, with an estimated arrival (Japan: within 10 business days, weekends skipped; elsewhere: within one month) and the line 「ご不明な点は、ご注文確認メールにご返信ください。」 in ja / zh-Hans / zh-Hant / en. No new database: the status is derived from Shopify.

**What it can see and say.** The **read-only** Dev Dashboard app **ICHIREI Tracking** (client id `394a8e955f7e28104f3e2089630bb3a5`, scope `read_orders` only). The server asks Shopify for the **one** order named, answers **only if the email on the order matches** and the order has an `ICHIREI…` SKU, and returns **only** order date, status, SKU(s), carrier, tracking number, tracking URL and the estimated date. Never a name, an address or an email. A wrong number, a wrong email, an order without an email and an order without an ICHIREI SKU all give the same “not found”. It never writes anything to Shopify and registers no webhook.

**Limits.** Per IP: 10 requests / 10 minutes; per order number: 5 *wrong* guesses / hour (then that order is locked for the hour); per instance: 300 / hour. These counters live in each Cloud Run instance's memory (max 3 instances), so they are a brake on guessing, not an exact global quota.

**One-time setup (yours — Cloud Shell):**
```bash
PROJECT_ID=ichirei
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# 1. The client secret of ICHIREI Tracking (Dev Dashboard → the app → Settings). Paste it when asked;
#    it never goes into code, the trigger, a log or a chat.
read -rs -p "ICHIREI Tracking client secret: " SECRET; echo
printf '%s' "$SECRET" | gcloud secrets create SHOPIFY_ADMIN_CLIENT_SECRET --data-file=- --replication-policy=automatic --project=$PROJECT_ID
unset SECRET

# 2. Let the Cloud Run service account read that one secret
gcloud secrets add-iam-policy-binding SHOPIFY_ADMIN_CLIENT_SECRET \
  --member="serviceAccount:${RUN_SA}" --role=roles/secretmanager.secretAccessor --project=$PROJECT_ID
```
The server reads the secret **at request time** through the Secret Manager API (not as a mounted variable), so a missing or not-yet-granted secret can never break a deploy — `/track` just answers “can't check right now” until step 1–2 are done. The client id is the substitution `_SHOPIFY_ADMIN_CLIENT_ID` (already the default in `cloudbuild.yaml`). Check `<URL>/api/health` → `"track": { "ready": true }`.

**Shopify-side things that decide whether it works** (check these first if `/track` says “can't check right now” — the log line `[ichirei-track] unavailable: …` names the reason):
- the app must be **installed on `soul-id-2`** and allowed to read **customer data** (order **email** and **shipping country** are *protected customer data*: Dev Dashboard → the app → *API access* → *Protected customer data access*, level 2);
- with only `read_orders`, Shopify returns orders from the **last 60 days** — an older order will show “not found” (that needs `read_all_orders`, which is a different scope and a different approval);
- the Admin API version is `2025-01` (`SHOPIFY_API_VERSION` to change).

**Overseas shipping.** The market “海外 ICHIREI” (JPY, EMS ¥6,000) is configured in Shopify; which market a checkout falls into is decided by Shopify from the buyer's country at checkout. The site does not pass a country — test one overseas order end to end before announcing.

---

## Current state (as of 2026-10-25) — what is set up in GCP and Shopify

Recorded from the owner's report; nothing here is a secret value. Re-check with `<URL>/api/health`.

| Item | State |
|---|---|
| Cloud Run service | `ichirei`, project `ichirei`, `asia-northeast1`; trigger `ichirei-deploy` deploys on push to `main`; live at https://ichirei.soul-id.jp |
| Last verified build | on commit `49f3266` (Shopify launch: new prices, certificate line, `/track`) — **succeeded** |
| `/api/health` | `orders` **ready** (store: `gcs`), `track` **ready**, nothing missing |
| Runtime service account | `581109768569-compute@developer.gserviceaccount.com` |
| Secret `SHOPIFY_STOREFRONT_TOKEN` | exists, holds the **public** Storefront token; the service account has `secretAccessor` (mounted by `cloudbuild.yaml`; its absence broke earlier builds) |
| Secret `SHOPIFY_ADMIN_CLIENT_SECRET` | exists, holds the `shpss_` **client secret** of the *ICHIREI Tracking* app (Dev Dashboard); `secretAccessor` granted to the service account; read at request time by `/track` |
| Order bucket | private `gs://ichirei-orders-581109768569` (not `ichirei-orders` as in the example commands above); `objectAdmin` for the service account; trigger substitution `_ORDER_BUCKET` = `ichirei-orders-581109768569` |
| Trigger substitutions | `_SHOPIFY_VARIANT_SIMPLE=67789502447864`, `_SHOPIFY_VARIANT_STANDARD=67789502480632` (defaults in `cloudbuild.yaml`), `_SHOPIFY_ADMIN_CLIENT_ID=394a8e955f7e28104f3e2089630bb3a5`, `_ORDER_BUCKET` as above |
| Credential hygiene | A `shpat_` token that was pasted into a chat was the **Headless private token**, not the Tracking app's; it was **rotated and the old one deleted**. The Tracking app uses only the `shpss_` client secret (client-credentials grant). |

**Not yet verified:** a real order lookup on `/track` (the owner will supply an order number + email), an overseas test order (market 「海外 ICHIREI」, EMS ¥6,000), and whether the Tracking app is approved for protected customer data (order email / shipping country) and limited to orders of the last 60 days (see Step 8). Order objects in the bucket hold personal data — decide a retention rule.

---

## Engine v6 — what changed for operations (2026-10-25)

- **Two model calls per run.** The selection call (as before), then a short **review call** (`engine/review-prompt.md`, effort `low`, ≤ 1,500 output tokens). Cost and latency go up a little; set `ICHIREI_REVIEW_MODEL` to a cheaper model if you like. `ICHIREI_REVIEW=off` skips it — but then the **freestyle (遊び字) is never shown** (it ships only after a PASS). The review's verdicts appear in the Cloud Run log as one `[ichirei-review] {…}` line each (slot, kanji, pass, reason; never the story).
- **Three cards, not six.** Main (本命, cinnabar), Second (次点) and an optional Freestyle (遊び字). If neither main survives the palette referee and the review, the customer is asked the model's own fallback question (`insufficient`) — the freestyle is never promoted.
- **Classical lines** appear only for palette rows that a named reviewer has signed (`reviewed_by` filled in), in the cell format `text — source` (space, em dash, space). **Nothing is shown today** (every row is `draft-unreviewed`). The review sheets for reviewers are `review/classical_echo_ja.csv` and `review/classical_echo_zh.csv` (regenerate with `node scripts/export-review.mjs`).
- **`REQUIRE_CLASSICAL_ECHO`** (environment variable, **off** by default): when `1`, a main candidate without a reviewed classical line is not eligible. Switch it on only after the palette is reviewed, or most orders will come back `insufficient`. Add it with `gcloud run services update ichirei --region asia-northeast1 --update-env-vars REQUIRE_CLASSICAL_ECHO=1` (it will survive deploys; `cloudbuild.yaml` uses `--update-env-vars`).
- **Story length:** no minimum; **2,000 characters** is the hard maximum for `story` on `/api/select`, `/api/explain`, `/api/poem` and the order endpoint (raised from 600 on 2026-10-30 so spoken stories are never cut off; the page still says 50–300 is enough); the textarea stops at 2,000 and a live counter shows from 1,500. Voice input (「声で話す」) stops at 2,000: the first 2,000 characters are kept and a short note says the rest was not added. Follow-up answers are a **separate field** `follow_ups` (at most two answers, **600 characters each**, counter from 450), so a full 2,000-character story can still be followed up; the engine reads story + answers merged, and orders keep them apart (`story`, `follow_ups`). Longer → `400 { code: "story_too_long" | "follow_up_too_long" | "too_many_follow_ups", max: 2000 | 600 }` before any model call. Output room for a long story: selection 14000 (retry 20000), explain 6000, poem 4000, poem/card review 4000, film script 4000 (`ICHIREI_FILM_MAX_TOKENS`); the story is input, so it does not use output room, only the model's reasoning can grow with it.

---

## Engine v8 — what changed for operations (2026-10-26)

- **The main character names the person, not an object in the scene** (the *person test*, in `engine/prompt.{ja,zh,en}.md` gate 7 and in review rule 6 "Scene noun" in `engine/review-prompt.md`). "If this scene had never happened, would this character still be true of them?" — if not (花, 靴, a lunch-box-type noun), it can only be the freestyle (遊び字). No code decides this; edit the prompts to tune it. Five golden stories from the 2026-10-26 live test are in `scripts/fixtures-v8/` (run by `scripts/test-v8.ts`). **They are retellings of copyrighted stories: keep the repository private.**
- **A replacement fills a missing MAIN only (spec step 8, owner decision 2026-10-30).** If NO main candidate is live after the referee and the review (or the live ones cannot be the primary), the engine asks for ONE replacement (`engine/replace-prompt.md`, appended to the filled selection prompt), judged by the same referee and the same review; it becomes the main. A removed or never-generated SECOND (or freestyle) card is NOT replaced: one true card shown quickly beats a weaker card shown slowly. The reason is logged without any story text: `[ichirei-engine] main_slot_empty {live, missing:[{slot,kanji,cause:not_generated|referee|review|model,reason}], will_replace}` (main missing), `[ichirei-engine] second_slot_empty {…, will_replace:false}` (second missing, nothing asked) and `[ichirei-engine] replacement {attempt, ok, ms, kanji|reason}`. Env: `ICHIREI_REPLACE=off` disables it; `ICHIREI_REPLACE_ATTEMPTS` (1; only for a result with a live main that cannot be primary), `ICHIREI_REPLACE_MODEL`, `ICHIREI_REPLACE_EFFORT` (medium), `ICHIREI_REPLACE_MAX_TOKENS` (6000).
- **Where the time goes** — one line per run: `[ichirei-timing] {select_ms, review_ms, replace_ms, total_ms, status, stop_reason, output_tokens, model, effort, max_tokens}`. `/api/select` also streams `{"type":"stage","stage":"reading|choosing|checking|replacing"}` lines and the page shows them as honest progress steps (no fake percentage). The knobs are environment variables on the Cloud Run service. **`cloudbuild.yaml` now sets them on every deploy** (substitutions `_EFFORT`, `_MAX_TOKENS`, `_REVIEW_MODEL`, `_REVIEW_EFFORT`, `_CALL_TIMEOUT_MS` → `--update-env-vars`), so a value set by hand on the console (`ICHIREI_EFFORT=high` …) is replaced by the file's value at the next deploy: change them in `cloudbuild.yaml` (or on the trigger), not on the console. Measure with `scripts/bench-select.mjs` (the five stories, several configs, per-stage seconds, p50/p90, and a quality line per story — it needs `ANTHROPIC_API_KEY`, or `--url https://ichirei.soul-id.jp` to time the live service).

- **Rate limit** (per IP, per Cloud Run instance — a brake, not an exact quota): `/api/select` **12 per hour**, `/api/explain` **40 per hour**. Over the limit → `429 { code: "rate_limited" }` with `Retry-After`, before any model call; the page shows a localized message. Env: `ICHIREI_SELECT_LIMIT` / `ICHIREI_EXPLAIN_LIMIT` = `max/minutes` (e.g. `20/60`) or `off`. Refusals are logged as `[ichirei-limit] {route, limited:true}` (no IP, no story).
- **Chrome auto-translate** is switched off (`<html translate="no">`, `<meta name="google" content="notranslate">`, class `notranslate` on every kanji element): the site has its own EN / 日本語 / 繁中.
- **Card order** on the page, in the DOM and visually, is main (本命) → second (次点) → freestyle (遊び字), revealed one after the other in that order.

## Engine v8.1 — fixes after the live test of the speed settings (2026-10-27)

- **The review is a safety check, not an editor.** `engine/review-prompt.md` lets it FAIL a candidate only under a named safety rule: `palette` (hard block / taboo / blocked occasion), `occasion` (the occasion's taboos), `memorial` (celebration or birth characters, death-talk as such — nothing else), `dignity`, `register` (wrong register for the direction), and for the freestyle `insult`. Everything else (scene noun, third-person or consoling voice, invention, generic, thin evidence) is a **concern**: it goes in the verdict's `concern` and in the `[ichirei-review]` log line, and never removes a card. The scene-noun test lives in the selection prompt (the person test). In code (`applyReviewVerdicts`) a veto of a main candidate counts only if its `rule` is one of those names; a fail without one is **ignored** (action `review_veto_ignored`, visible in the result's referee actions). The optional freestyle is dropped on any fail.
- **Never more than three cards.** `engine/slots.ts` is the last gate: one main (the primary), one second, one freestyle; anything extra is removed (`slot_overflow_eliminated`, logged as `[ichirei-engine] slot_overflow`). The replacement fills **only an empty MAIN slot**; with a live main card nothing is asked of the model. One attempt by default (`ICHIREI_REPLACE_ATTEMPTS`, was 2: a failed attempt cost ≈ 40 s). The page also shows at most one second card.
- **Never zero cards without a question.** If the referee and the review remove every main candidate, ONE replacement is tried first (it becomes the main card); if that fails, the result is `insufficient` with the model's own fallback question, and if the model gave none, a last-resort question per language (`DEFAULT_FOLLOW_UP` in `engine/contract.ts`). A model that itself answers `insufficient` without a question gets the same. The contract validator rejects more than three live cards.
- **Shorter answer.** The output contract in `prompt.{ja,zh,en}.md` no longer asks for the context echo (stamped by the engine anyway), `particulars`, the fingerprint notes (only `emotional_register` is kept: the explain call uses it), `eliminated` / `eliminated_reason`, and `palette_status` / `flags` / `suitability_flag` are written only when there is something to say. Anchors are short fragments, `unique_truth` ≤ 15 words. On the five fixture answers: **5,491 → 3,364 characters of JSON (−39%)**. `normalizeModelOutput` fills the neutral values, so every later stage sees the old shape; an old-shape answer still works.

## Engine v9 — the classical lexicon as the source of the main characters (2026-10-27)

**What it is.** `engine/lexicon.csv` (167 rows, 153 distinct characters, 149 rows with a verified line) holds the characters the classical masters made famous: what each means in its line, the person it names, the relationships it suits, the source and the stand-alone reading risk. In lexicon mode the **main and second characters come only from this list**; the AI still reads the story and decides which listed character is the truest compression of the person (`engine/lexicon-prompt.md` — the reasoning lives there, not in code). The freestyle stays open under the existing taboo rules. The palette engine is the fallback.

**The switch: `ICHIREI_LEXICON_MODE` = `off` | `shadow` | `on`** (code default: `shadow`; **shipped value since 2026-10-28: `on`**, set in `cloudbuild.yaml` after the live shadow comparison; `cloudbuild.yaml` passes it on every deploy as `_LEXICON_MODE`, so change it THERE or override the substitution on the Cloud Build trigger — a value set by hand on the console is overwritten by the next deploy). `/api/health` reports it as `lexiconMode`.

| Mode | What the customer gets | What else happens |
|---|---|---|
| `off` | the palette engine, exactly as before | nothing |
| `shadow` (code default) | the palette engine's answer, exactly as before | ONE extra selection-only call (the lexicon prompt; no review, no replacement; not streamed to the page) runs beside it; when the customer's answer is ready it gets up to `ICHIREI_SHADOW_GRACE_MS` (20 s) to finish, and `[ichirei-lexicon] shadow {…}` logs what lexicon mode would have chosen next to what the customer got (kanji, relationship, occasion, `same_main`; **never story text**). **It doubles the selection cost and raises the Anthropic rate use while it is on.** |
| `on` | slots 1–2 from the lexicon | see below |

**`on` in detail.**
1. The prompt is built as: the **static lexicon block first** (instructions + every usable lexicon entry, identical for every request, sent with `cache_control: ephemeral` so it is cached), then the language's filled prompt, then **this gift's list** — the lexicon characters that fit the relationship, direction and occasion, with the palette's blocks applied by code (`eligibleFor` in `engine/lexicon.ts`: a row in the palette(s) that judge the language, no `hard_block`, not blocked for the occasion, not on the remembrance default block, "DO NOT USE" benchmark rows 默 and 迎 never; `(JP only)` rows only in Japanese).
2. Owner restrictions (in `LEXICON_RESTRICTIONS`): **藏 partner only**; **恩 upward (direction `up`) or partner only** (the lexicon row carries no partner tag, so today it is effectively upward only — the restriction only narrows); **綠 not for a partner in Chinese** (zh and en).
3. The referee rejects any main or second character that is not on the list (`palette: not_in_lexicon`, flag `not_in_lexicon`, action `not_in_lexicon_eliminated`); slot 2 is promoted as usual, and an empty slot may be refilled by ONE replacement, which must also be on the list. The review call is skipped for slots 1–2 (pre-vetted) and kept for the freestyle only.
4. **No fit.** If no listed character truly fits, the model returns `insufficient` + `lexicon_miss: true` + ONE follow-up question. If the sender's answer still finds no fit (`follow_ups` is not empty), the **palette engine answers** instead, every live card flagged `lexicon_miss`, with no classical line. (A model that picks outside the list for both slots and cannot be replaced counts as a miss too, reason `no_valid_choice`.) A story that is merely too thin is the ordinary `insufficient`, not a miss.
5. **Every miss is logged**, one line, no story text: `[ichirei-lexicon] miss {"relationship","occasion","direction","language","emotional_register","reason","outcome":"question|fallback","follow_ups_used"}` — read these in Cloud Run logs to see where the lexicon should grow.
6. If `lexicon.csv` cannot be loaded the engine logs `[ichirei-lexicon] unavailable` and answers with the palette engine; the lexicon never takes the service down.

**The classical line on the card** (only in `on`): `line_original` + `source` are shown **only** when the lexicon row has a human `reviewed_by` (not empty, not `draft-`/`interim-`, **not starting with "Claude"**) **and** `card_fit` is `high` **and** `kana_only` is not `yes`; otherwise the card shows no classical line, as today. `reviewed_by` / `reviewed_on` are empty on every row now, so **no line is shown until a person reviews rows** — fill the two columns in `engine/lexicon.csv` and the line appears. (In `off`/`shadow` nothing changed: lines still come from reviewed palette rows only, and there are none.)

**Palette rows for the lexicon.** 86 lexicon characters had no row in the palettes (the owner counted 92 rows/forms; 86 distinct characters, each missing in both languages): 86 `ja` + 86 `zh` rows were added by `scripts/add-lexicon-palette-rows.mjs` from `scripts/lexicon-palette-data.json` — readings, meanings, status, taboo flags, blocked occasions, register, inscription fitness, as an **AI first pass that only adds restrictions** (`reviewed_by: Claude(AI一次確認)`, `reviewed_on: 2026-10-27`; never counted as reviewed), carrying over each `standalone_reading_risk`. Re-run the script after editing the JSON (it is idempotent).

**Illness and frailty (2026-10-28, after a live stroke-recipient story returned 篤).** (1) *Superseded by spec v9.1 the same day: 篤/笃 is no longer a palette block — a lexicon character with a verified line is never level 1; keeping it away from an ill receiver is the illness rule's job (below), per gift.* (2) `engine/prompt.{ja,zh,en}.md` got an **ILLNESS AND FRAILTY** rule: when the story says or implies that the receiver is ill, in hospital, recovering from a stroke, living with dementia or frail, never choose a character with an illness, death or ending association in the buyer's language (篤, 峠, 迎, 渡, 逝, 終, 静 as in 静養 …; illustrative, not a list the code enforces). (3) `engine/review-prompt.md` has the matching safety rule **`illness`** (in `REVIEW_VETO_RULES`), so the review may veto a main or second — and drop a freestyle — under it. (4) The live story is the fixture `scripts/fixtures-v9/s0005-teacher-stroke-illness.json` (a retelling of a private-database story: keep the repository private); `scripts/test-v9.ts` checks that 篤 never appears. The prompt and review rules rely on the model's judgement and have not been run against the real model.

**Variety (strengthened 2026-10-28).** `engine/lexicon-prompt.md` rule 8: choose the most story-specific eligible character; a broad virtue character (恕, 誠, 和, 敬 …) may be the main **only when the key moment of the story is explicitly about that virtue** — otherwise a more specific character is the main and the broad one, if it still fits, is the second. It is a rule in the prompt (the model judges the story), not a code rule. The `[ichirei-main]` line carries `broad_virtue` (true for 恕 誠 和 敬, `BROAD_VIRTUES` in `engine/lexicon.ts`) so repeats of those four are easy to count.

**Daily count of main characters.** Every finished run that shows a main logs one line, no story text: `[ichirei-main] {"day":"2026-10-28","kanji":"待","count_today_on_this_instance":3,"source":"lexicon|palette|palette_after_lexicon_miss","broad_virtue":false,"joyo":true,"language","relationship","occasion"}` (`engine/main-count.ts`; the day is the JST business day). The counter is per Cloud Run instance; the day's total per character is the number of lines in Cloud Logging, e.g. `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="ichirei" AND textPayload:"[ichirei-main]"' --freshness=1d --format='value(textPayload)' | grep -o '"kanji":"[^"]*"' | sort | uniq -c | sort -rn`.

**Switching back.** Set `_LEXICON_MODE` to `shadow` or `off` in `cloudbuild.yaml` (or on the trigger) and push. In `on` mode, read the `[ichirei-lexicon] miss` lines to see where the lexicon should grow. Not measured on the live model by this change — the shadow comparison (5 live stories) was the owner's.

## The poem (歌の添え書き) — ONE poem included free in every order (decision 2026-10-28)

**What changed from the paid add-on:** the poem is now part of the gift. There is **no price, no extra charge, no poem product and no poem line item in Shopify**. The Shopify variant env vars `SHOPIFY_VARIANT_POEM_TANKA / _TANG / _CI / _EN` and the preview switch `ICHIREI_POEM_PREVIEW` are **gone from the code and from `cloudbuild.yaml`**. (If they are still set on the Cloud Run service from earlier deploys they are simply ignored; remove them on the console whenever convenient.) `/api/poem-types` is gone and `/api/health` no longer lists `poemTypes` / `poemPreview`.

- **Flow (`src/demo/PoemAddOn.tsx`):** after the buyer has chosen a character the order form shows the step to everyone — **four formats as radio buttons** (tanka / tang / ci / en), the first one chosen **by the site language** (`DEFAULT_POEM_TYPE` in `src/order/packages.ts`: ja → tanka, zh → ci, en → en). The poem is written at once and shown **in full** (every line, then the reading aids: 書き下し / romaji / English / 現代語訳) with "this poem is printed on your card" — before checkout. The order button waits while a poem is being written. Another format can be tried; each one is written once and kept for the session (switching back costs nothing). The page keeps only the `poem_id`; `/api/order` reads the poem back from the server (poem text is never sent by the browser) and checks that it belongs to the chosen character and language. At most one (`MAX_POEMS = 1`).
- **If the poem fails twice** (`/api/poem` answers an error twice for that format) the page says so politely — the order goes ahead **without a poem** (no `poems` in the request, no poem attributes, `certificate.poems = []`) and the film simply has no poem part. A "try again" button stays.
- **Shopify:** the poem goes on the **main ICHIREI line item** as the attributes `ichirei_poem_type`, `ichirei_poem_text` (one line per row) and `ichirei_poem_reading` (the reading aids), placed after `order_ref` / `ichirei_memorial` and before `ichirei_animation_url`; and in `certificate.poems` (type, lines, reading) of the stored order and the response. The order total is the package price only.
- **The story film does not use the poem** (the film retells the story and ends with the character; see "The story film").
- **The model:** `engine/poem.<type>.md` (one prompt per type — the writing rules) and `engine/poem-review-prompt.md` (a fast safety review under the named rules). Settings: `ICHIREI_POEM_MODEL` (default = the selection model), `ICHIREI_POEM_EFFORT` (low), `ICHIREI_POEM_MAX_TOKENS` (4000), `ICHIREI_POEM_TIMEOUT_MS` (45000 — the whole generation, retry and review included), `ICHIREI_REVIEW=off` skips the review. **20 poems per hour per IP** (`ICHIREI_POEM_LIMIT`, "max/minutes" or `off`) — switching formats counts.
- **Code checks** (`engine/poem-check.ts`): tanka 5-7-5-7-7 morae counted from the kana reading the model returns; tang 4 lines, all 5 or all 7 characters, traditional characters, lines 2 and 4 rhyme; ci one of the three patterns and its line lengths; en 4–6 short lines; for all: the chosen character in the poem, no character the palette blocks for this gift (level 1, level 3 for the occasion, the remembrance block), occasion words in English. All poem rules are unchanged.
- **Logs / analytics (no story, no poem text):** `[ichirei-poem] {type, ok, attempts, …}` per poem (failures with `reasons` and `problems`); analytics events `poem_previewed` (type, when written), `poem_added` (type, when the order is made) and `ordered` with `poem_types`; `scripts/report-choices.mjs` prints a poem block.
- **Cost note:** the poem is now written for every buyer who reaches the order form (about one model call, plus the safety review), and again for each other format they try. The 20-per-hour limit is the brake.
- **Not measured:** whether the real model passes the form checks every time — the logs say.

**Poem changes after the first live poem test (2026-10-28).**
- **Why a poem fails — now visible.** Every failed poem writes ONE log line, no story and no poem text: `[ichirei-poem] {"type","ok":false,"code":"poem_failed","reasons":["character_missing", …],"problems":["…the failed checks in words…"]}`. The codes: `parse` (the reply was not the JSON shape), `call` (the model call itself failed), `form` (line count / syllables / characters / traditional script), `character_missing` (the chosen character is not in the poem), `rhyme`, `palette` (a blocked character or word), `review:<rule>` (the safety review vetoed it, with its reason in `problems`), `gendaigo` (the Japanese modern translation is missing). The 502 answer carries `reasons` too (the failed checks in words are in the server log only — the preview switch that exposed them is gone). **The English poem's first failure (lunch-box story, 待) could not be diagnosed from here — production logs are not reachable from the build session; the cause is in the log line of that request.** Likeliest causes, all addressed: the character left out of the English lines (the prompt now says to copy it as the character and shows the shape), a line over 12 words (13–16 is now only a craft note), a reply wrapped in a code fence or with chatter (read now), or the Haiku review vetoing a poem that contains the Chinese character (the review prompt now says the chosen character is intended).
- **漢詩 must rhyme.** `engine/rhyme.ts` (library `pinyin-pro`, in `dependencies`) takes the last character of lines 2 and 4 (the whole line is given, so a polyphonic character takes its line's reading) and requires the same rhyme group of the 14 modern groups (中華新韻: 一麻 二波 三皆 四開 五微 六豪 七尤 八寒 九文 十唐 十一庚 十二齊 十三支 十四姑). Line 1 is free. A failure is regenerated once with the pinyin of both line ends fed back; failing twice = `poem_failed` with reason `rhyme`. This is MODERN Mandarin rhyme, not 平水韻: a classically correct rhyme that differs today (入声 endings, for example) will be refused.
- **Classical imagery, no modern words** in the tang and ci prompts (電話 → 一聲, 弁当 → 飯盒 → 竹籠 …). The code only notes modern words (電話 弁當 手機 電車 …) as a craft note.
- **Craft notes (never fail a poem).** A tanka that repeats the same kanji (母 … 母; the chosen character may repeat), a tang whose lines 2 and 4 end on the same character, a modern word in a tang / ci, an English line of 13–16 words: one regeneration with the note fed back; if the second try is not better the first poem ships. If the second try fails a hard check, the first (which passed every hard check) ships.
- **現代語訳.** For a Japanese buyer a tang and a ci also carry `gendaigo`: a short modern Japanese rendering (one or two sentences), under the 書き下し. Missing = regenerated once, then `poem_failed` (reason `gendaigo`). Both are in the stored reading text (`ichirei_poem_reading`: 書き下し first, then 現代語訳). English and Chinese buyers: unchanged.

**Poem follow-up (2026-10-28).** (1) *現代語訳:* the code requires `gendaigo` for a Japanese buyer's tang / ci (a poem without it is regenerated, then fails — it can never ship without one) and returns it in `aids.gendaigo` and inside `reading` (書き下し, a blank line, 現代語訳); a test now covers the `POST /api/poem` answer and the stored poem. A reply that gives it line by line (an array) is joined instead of dropped. The success log line now says which aids a poem carries (`aids: {kakikudashi: 4, gendaigo: true, …}`, counts only), so a poem without it is visible in Cloud Logging at once. If a live Japanese tang still shows only the 書き下し, the running revision is older than `74ec447` — check the Cloud Run revision. (2) *Truth of events:* all four poem prompts have rule **3b**: state only what the story says happened; a visit, return or meeting planned for later stays in the future (tang / ci: mark it with 將 待 擬 期 and never 今日 / 今朝 / 已 / 又; tanka and English: keep the tense). Prompt wording only — the code cannot judge it, and the safety review does not check it (it is not a safety rule).

## The story film (`/a/<id>`, v2: a new set of pictures for every order, 2026-10-28)

Every order gets a **30-second film that retells the customer's own story in four short scenes and ends with the chosen character**. No manual step, the same fixed template for everyone, silent. **v2:** the fixed 40-picture library is gone; the four pictures are **drawn for each order from its own story**.

- **Two steps, two moments.** (1) **When the order is made** (`POST /api/order`, the place that creates `ichirei_animation_url`; there are no payment webhooks and none may be added): one small model call writes the **script** — four lines *and four English picture descriptions* (15–40 words, one moment of the story each) — while the Shopify cart is made. The buyer waits at most `ICHIREI_FILM_WAIT_MS` (default 8000) and the film can never block or fail an order. (2) **On the first open of `/a/<id>`** (after payment) the page asks `POST /api/film/<id>/render`; that request **stays open until the four pictures are drawn** (≤ 120 s, `ICHIREI_FILM_RENDER_MS`) so Cloud Run keeps the CPU — nothing is lost and **no `--no-cpu-throttling` is needed**. The page shows 「映像を準備しています」 meanwhile. **Unpaid orders cost nothing for pictures.** Every later open plays at once with no AI call.
- **The script call (`engine/film.ts`, `engine/film-prompt.md`).** `ICHIREI_FILM_MODEL` (default `claude-haiku-5-5`), 30 s per try, one retry with the failed checks fed back. Output `{"lines":[4],"pictures":[4]}` (`{"declined":true}` for a goodwill refusal). All reasoning is in the prompt file: retell, never invent; the sender's voice, quotations word for word; line length ja 12–28 characters, zh-Hant 10–24, en 4–14 words; the character not named; no names, places, numbers; every engine safety rule (no illness / hospital / decline, 還暦 = rebirth, dignity, goodwill); and for the pictures: only what the story says, **no faces** (silhouettes, hands, backs), **no text of any kind**, no illness / hospital / injury / funeral image, no celebration image in a remembrance film, four different moments; **contemporary everyday clothes** (no kimono, yukata or other traditional dress unless the story mentions it) in **the buyer's own modern world** (ja → a modern Japanese home and town; zh → a modern Taiwanese, Hong Kong or Chinese home and street, never Japanese houses, paper lanterns, tatami; en → a neutral modern home; a place or culture the story names wins); **no religious symbols** (a cross — also one formed by a window frame —, Buddhist altar, shrine, temple, torii …) unless the story mentions them, most of all in a remembrance film.
- **The referee (`checkFilmScript`, `checkPictures`).** Four lines and four descriptions; line length; every quotation exactly in the story; the character in no line; no digits; no names; per-language illness words; the engine's blocklists; the word "AI". Each description: 15–40 words, no digits, no Japanese / Chinese characters (so never the chosen character), no personal name, no face / text / illness / injury / funeral words, no celebration word in a remembrance film, not the same as another. A failed script is retried once, then the **script fallback**: the "your moment" line and the "who they are" line over two plain washi pictures (nothing to draw), then the character (a 20-second film). Logs `film_generated` / `film_retry` / `film_fallback` (reason codes only, never story text).
- **The pictures (`engine/film-art.ts`).** A fixed sumi-e style text (in code, the same for every order — it includes "People wear contemporary everyday clothes; modern objects (a plain modern umbrella, modern doors, phones and trains) unless the description says otherwise."; a remembrance film adds "Paler grey-beige paper, very soft ink, still and calm.") + the description → **Google's image model on Vertex AI**, four pictures **two at a time** (`ICHIREI_FILM_IMAGE_CONCURRENCY`), 4:5, saved as WebP 1080 × 1350. Auth is the Cloud Run **service account** through the metadata server — **no API key anywhere**. **Model:** `ICHIREI_FILM_IMAGE_MODEL` (cloudbuild `_FILM_IMAGE_MODEL`; default **`gemini-3.1-flash-image`**, then **`gemini-2.5-flash-image`** — a model that answers "not found" hands over to the next one in the list, separated by `|`); **location:** `ICHIREI_FILM_IMAGE_LOCATION` (`_FILM_IMAGE_LOCATION`, default **`global`**). These two names were taken from public documentation and third-party pages and were **not tried against a live project from the build session** — see "First run" below; if the first sample fails with `model_not_found` or `permission`, change them in `cloudbuild.yaml` (never on the console: the next deploy would overwrite them).
- **Quota (429) — added after the first live run, where 10 of 16 slots fell back to washi on `code: quota`.** A 429 from the first model tries the **fallback model at once** (`gemini-2.5-flash-image`; the first model stays the first choice), and if every model is out of quota the picture **waits 8 s, then 20 s, then 40 s** (`ICHIREI_FILM_QUOTA_WAITS_MS`) and tries again, as long as the 120 s render window has room (`film_quota_wait` is logged per wait). **Quota answers do not count toward the order's limit.** A slot that still failed only for quota or an outage (image model down, check unavailable) is **not final**: it is `pending`, the film shows washi there for now and is marked **`incomplete`** (`status: incomplete` in `films/<id>/art.json`, `incomplete: true` in the view). The **next open** of `/a/<id>` plays it at once and asks the server to draw **only the missing slots** (at least `ICHIREI_FILM_RETRY_MS`, 60 s, after the last try, so a quota is not hammered); the new picture replaces the washi on the page without a reload. **One background retry** is scheduled about 10 minutes after the first incomplete render (`ICHIREI_FILM_BG_RETRY_MS`, 0 = none; `film_render_retry`) — best effort: an idle Cloud Run instance can be paused or shut down, so the next open is what you can rely on. **Washi is final only when the SAME slot fails the safety check a third time, after one rewrite:** the first failure draws the picture again; the second makes the picture's description be **rewritten once** (a small Haiku call, `engine/film-picture-rewrite-prompt.md`: the same moment from a different view — e.g. hands on an umbrella handle, the open door from inside — checked by the same description rules, `film_picture_rewrite` in the log, saved as `rewritten` in `art.json`) and drawn again; failing that too makes the washi final. If the rewrite itself cannot be had (an outage) the slot waits for the next try — never washi. Our own errors — a check that cannot run, quota, timeouts, error answers — never make washi final and never count toward the order's cap (12 SUCCESSFUL draws — four first, four retries, four redraws after a rewrite; at the cap nothing more is drawn and a pending slot stays pending).
- **The picture check.** One `claude-haiku-5-5` vision call (`engine/film-picture-check-prompt.md`, `max_tokens` 4000, effort low — `ICHIREI_FILM_CHECK_MAX_TOKENS`) looks at the pictures just drawn with their descriptions; **if that call fails for any reason, each picture gets its own call**. A picture **fails** on: a face with features, **readable words** (handwriting, a letter or a notebook that cannot be read as words is allowed — the remembrance story is about letters), an illness / hospital / injury / funeral image, a celebration (remembrance films), nudity or violence, a person in traditional dress or a home that does not belong to the buyer's world (reasons `clothing`, `setting`), a religious symbol including a window-frame cross (`religious`), or something clearly different from its description. The check is told the buyer's language; a description that names the thing itself (a story that mentions a kimono or an altar) is allowed. The referee also refuses such words in the description itself (`pic_blocked`) unless the story mentions them. A picture that fails is **drawn once more** in the same render (with a hint for why it failed); if it fails again that slot gets the plain **washi** picture (`public/film/washi-1.webp`, `washi-2.webp`, made by `node scripts/make-film-washi.mjs`) for good. **A picture that could not be checked is never shown, and never thrown away:** it is stored as `films/<id>/<n>.unchecked.webp` (never served; the slot is `unchecked`, the film `incomplete`), and only the check is tried again — after 5 s, 15 s and 30 s (`ICHIREI_FILM_CHECK_WAITS_MS`), then on the next open (no image call). When it passes the picture becomes public (`<n>.webp`). **`film_check_error` now carries the real cause** (no story text): `causes: [{kind: http|timeout|parse|max_tokens|refusal|network, status, stop_reason, reply (first 200 characters)}]`, with `single: n` on a per-picture call, and `slots`, `try`. The first live failure (`reason:"check"`, pictures discarded and drawn again, cap reached, final washi) was caused by the check call being too tight — `max_tokens` 600 with no effort setting, so a model that thinks first could run out before it wrote the JSON (the likeliest reading; the log did not record the cause, which is why it is recorded now). The film always plays.
- **Limits.** At most **one full set plus four single-picture retries** per order (12 successful draws; errors, quota answers, timeouts and check errors excluded). **Daily:** `ICHIREI_FILM_DAILY_MAX` (default **200** sets a day; `off` = none) — above it the pictures wait for the next day and the page says 「映像は明日お届けします」 (the count is `films/renders-<day>.jsonl`). **One set per film:** a lock in this process and, across instances, a create-if-absent object `films/<id>/art.json` (a fresh lease is waited for; a stale one is taken over after 150 s).
- **Storage.** The pictures are private objects in the **order bucket** (`films/<animation id>/1.webp … 4.webp`, `art.json`), uploaded with a plain media upload (no ACL, no public access), read with the service account's token and **served only by the server** (`GET /api/film/<id>/picture/<n>.webp`, `private` cache, `noindex`). Nothing lists the bucket; the object API accepts only those paths.
- **Logs (no story text, no description):** `film_render_start`, `film_render_done` (time, pictures drawn, washi count, **`est_cost_jpy`** — an estimate: images × `ICHIREI_FILM_IMAGE_USD` (0.039 assumed) + the check's tokens at assumed Haiku prices, × `ICHIREI_FILM_JPY_PER_USD` (150 assumed); *not a measurement*), `film_picture_fail` (slot, reason, fails), `film_image_error` (slot, code), `film_quota_wait` (slot, wait_ms), `film_check_error` (the real cause), `film_check_wait`, `film_render_deferred`, `film_render_retry` (a later try of an incomplete film). `film_render_done` also says `pending` and `incomplete`.
- **The template (`src/animation/film.ts`).** 9:16, washi picture inside a dark frame, slow push-in, 0.8 s cross-fade, each line phrase by phrase (quotations in gold). 0–5 / 5–10 / 10–15 / 15–20 s four scenes; 20–27 s the character revealed in ink (cinnabar) with its reading; 27–30 s the "who they are" line, then the gold ICHIREI seal; the last frame holds. **Remembrance:** grey-beige paper, 5.5 s per scene (37.5 s), black ink, the seal only fades in. `prefers-reduced-motion`: a still page of the four scenes and the character. The word "AI" is never shown; the character keeps `translate="no"`. KanjiVG / Make Me a Hanzi are gone; `/credits` lists the typefaces only.
- **Samples for phone tests.** `ICHIREI_ANIMATION_SAMPLES=on` (cloudbuild `_ANIMATION_SAMPLES`, **temporarily `on`**; set to `off` after the owner's tests): four reserved ids play **hand-written** scripts with **real pictures drawn on the first open** (stored under `films/AN-sample…/`, so each is drawn once): Japanese — story 0020, the lunchbox story — `/a/AN-sampleja222222222222`, Chinese `…/AN-samplezh222222222222`, English `…/AN-sampleen222222222222`, remembrance `…/AN-samplemem22222222222`. Off, they are plain 404s. **Redrawing:** the samples carry a picture revision (`SAMPLE_ART_REV` in `engine/animation.ts`: Japanese `2`, Chinese `5`, English / remembrance `4`); stored pictures of another revision are ignored, so they are drawn again on the next open after this deploy — no bucket access needed. To force any sample to be drawn again, change its revision, or delete its objects: `BUCKET=$(gcloud run services describe ichirei --region=asia-northeast1 --project=ichirei --format=json | jq -r '.spec.template.spec.containers[0].env[] | select(.name=="ORDER_BUCKET") | .value'); gcloud storage rm -r "gs://$BUCKET/films/AN-sampleja222222222222" "gs://$BUCKET/films/AN-samplezh222222222222" "gs://$BUCKET/films/AN-samplemem22222222222"`.
- **Delivery (unchanged).** `ichirei_animation_url` on the Shopify line item, `animation_id` on the order record, `animation_url` in the `/api/order` answer, `GET /api/animation/<id>/qr.svg` for the card. **Only the owner can do in Shopify (nothing was touched):** show the property in the confirmation e-mail with Liquid (`{% for property in line.properties %}{% if property.first == 'ichirei_animation_url' %}<a href="{{ property.last }}">…</a>{% endif %}{% endfor %}`).
- **Env:** `ICHIREI_FILM` (`off` = script fallback only, tests), `ICHIREI_FILM_MODEL`, `ICHIREI_FILM_TIMEOUT_MS`, `ICHIREI_FILM_WAIT_MS`, `ICHIREI_FILM_IMAGE_MODEL`, `ICHIREI_FILM_IMAGE_LOCATION`, `ICHIREI_FILM_IMAGE_PROJECT` (default: the project of the metadata server), `ICHIREI_FILM_IMAGE_TIMEOUT_MS` (**90000** per picture), `ICHIREI_FILM_CHECK_TIMEOUT_MS` (60000), `ICHIREI_FILM_CHECK_MAX_TOKENS` (4000), `ICHIREI_FILM_CHECK_WAITS_MS` (5000,15000,30000), `ICHIREI_FILM_RENDER_DEADLINE_MS` (200000: how long one render may keep waiting and retrying; a request is still held for 120 s and the page asks again), `ICHIREI_FILM_RENDER_MS`, `ICHIREI_FILM_DAILY_MAX`, `ICHIREI_FILM_CHECK_MODEL`, `ICHIREI_FILM_RENDER_LIMIT` (per-IP, default 30 / 10 min). `/api/health` shows `filmPictures: {model, location, dailyMax}`.

### One-time setup for the pictures (the owner, in Cloud Shell — project `ichirei`)

Two commands; paste them one after the other. They only switch on Vertex AI in your own project and let the site's own service account use it (nothing in Shopify, no key):

```
gcloud services enable aiplatform.googleapis.com --project=ichirei
```
```
gcloud projects add-iam-policy-binding ichirei --member="serviceAccount:$(gcloud run services describe ichirei --region=asia-northeast1 --project=ichirei --format='value(spec.template.spec.serviceAccountName)' | grep . || echo $(gcloud projects describe ichirei --format='value(projectNumber)')-compute@developer.gserviceaccount.com)" --role="roles/aiplatform.user"
```

(The second command finds the service account the `ichirei` Cloud Run service runs as — or, when none was set, the project's default compute account — and gives it **Vertex AI User**. Changing the new env vars is done in `cloudbuild.yaml`, not on the console.) If the account running Cloud Shell cannot do this, the error says which permission is missing.

**First run.** Open `https://ichirei.soul-id.jp/a/AN-sampleja222222222222` on the phone. It shows 「映像を準備しています」 for roughly 10–40 seconds, then the film with four pictures of the lunchbox story. If it plays with plain washi pictures instead, look in Cloud Logging for `film_image_error` (`code`: `permission` = the role is not there yet or takes a few minutes; `model_not_found` = change `_FILM_IMAGE_MODEL` / `_FILM_IMAGE_LOCATION`; `quota` = Vertex quota (the film then plays with washi and is retried — see "Quota"; to get more room ask for a higher quota for the model in the Google Cloud console, IAM & Admin → Quotas, filter "Gemini" / "online prediction requests per minute" and "image"); `blocked` = the image model refused a prompt) or `film_check_error` — then open it again (an incomplete film retries by itself on the next open).

### Tests

`scripts/test-film.ts` (the script referee incl. the picture descriptions, the call with a fake model: good, retry, fallback, timeout, off, no key, logs), `scripts/test-film-art.ts` (the style, the Vertex client against a fake server — URL, token, 4:5, model hand-over, error codes, metadata server —, the picture check, a set with per-slot retry and washi, the lock across instances, the limits, the private bucket), `scripts/test-animation.ts` (records, timeline, API incl. the first open, order wiring, samples, the real server with a fake image model), `scripts/test-animation-browser.mjs` (Chromium on iPhone-class, Pixel-class and 320 × 568 screens, incl. the first-open flow). **No test calls Google or Claude; the image model's look and the picture check's judgement have not been seen.** The phones are emulated in Chromium — real iPhone Safari and Android Chrome are for the owner's check of the sample links. `ANTHROPIC_API_KEY=… node --experimental-strip-types scripts/run-film-db.mjs` runs the *script* call over ~11 stories for a human to read (picture descriptions included).

## The receiver's gift page (Part 3 of 2026-10-31)

`/g/<token>` is now a sequence of screens — sealed envelope → opening → letter → film → reveal → poem → certificate → keepsakes and the one thank-you — in
`src/gift/`. No new environment variable.

- **Opening date** (`open_date` on the order, up to a year ahead; empty = at once): until that day (Japan time) `GET /api/gift/<token>` answers only the closed
  envelope (the two names, the date, the days left) and the pictures, the render, the scroll and the thank-you answer 403. The sender sees everything at any
  time with `?preview=<their own page id>` (the link on their page).
- **Certificate number** 「一字礼　第 NNNN 号」: one running number across all orders, from 0001, never reused. Each number is a small private object
  `ops/certno/NNNN.json` in the order bucket, written with "only if absent" (so two simultaneous orders can never share one); `ops/certno/last.json` is only a
  hint of where to start. The number is kept on the order record and the gift record. A number is taken when the order is made, so an order that is never paid
  leaves a gap — numbers are never handed out twice.
- **Thank-you**: one reply per gift (200 characters), stored on the gift record, shown on the sender's page; no e-mail is sent.

## Sharing a gift, and fonts that come from our own server (Part 4 of 2026-10-31)

No new environment variable.

- **The picture a shared link shows** (`GET /api/gift/<token>/og.png`, 1200 × 630): the sealed envelope with 「○○へ」 and the gold seal on the dark ground —
  drawn from the two names only, so it can never show the character. Made once per gift (and again only if a name is corrected within the 24 hours) and kept in
  the private bucket as `og/<token>.<hash>.png`; served with `Cache-Control: public, max-age=3600`.
- **The link preview** (LINE, WhatsApp, WeChat, e-mail do not run the page's scripts): `GET /g/<token>` answers `dist/index.html` with this gift's own Open Graph
  tags (`og:title` 「○○へ　一字の贈りもの」, `og:description` 「○○さんから · 11月10日に開封」, the picture above). Names and the opening date only; every value is
  escaped; the generic landing tags, the Google font loader and the `<noscript>` font link are removed from it.
- **WeChat** has no share link: the sender page offers the QR code as an image to save (`/api/gift/<token>/qr.png`) and says to send the image or the video.
- **Fonts**: the gift page, the film/sender page and /credits ask Google for nothing (fonts.googleapis.com / fonts.gstatic.com are unreliable in mainland China).
  Their fonts are `public/fonts/*.woff2` (see the README there), declared in `src/fonts.css`. `index.html` skips the Google font loader and the landing photo for
  `/g/`, `/a/` and `/credits`. `scripts/measure-weight.mjs` builds the app, serves it with gzip, blocks every Google host and adds up the bytes of the whole
  receiver path (about 340 KB for a Chinese reader, 440 KB for English, 970 KB for Japanese, which carries a 590 KB Japanese serif; plus the film's four
  pictures).

## Downloads: the film as an MP4, the story scroll, the card as a PDF (Part 5 of 2026-10-31)

「ギフトを保存する」 on the receiver's page (after the certificate) and on the sender's page; shown only when the film is complete (a final washi slot is allowed).

- **The film as an MP4** — 1080 × 1920, H.264 (High, yuv420p, faststart), 24 fps, **no sound**, 30 s (37.5 s for a remembrance). Composed from the same timeline
  and frame maths as the film on the page (`src/animation/film.ts`) in `engine/render/film-video.ts` — nothing is written or drawn by a model — and encoded by
  **ffmpeg, which the container now installs** (`Dockerfile`, runtime stage). Made **once per order**, the first time someone presses 「映像を保存」 after the
  pictures are final, and kept in the private bucket next to the pictures (`films/<AN-id>/film.mp4` + `film.json`); made again only if the character changed in the
  24-hour window or the pictures were drawn again. The request stays open while it is made (so Cloud Run keeps the CPU); at most `ICHIREI_FILM_VIDEO_PARALLEL`
  (default 2) renders run at once per instance, the rest are told to ask again. `ICHIREI_FILM_VIDEO_LIMIT` (default 8 per 10 minutes per address) limits asking.
  Served inline with `Accept-Ranges` (an iPhone plays video in ranges) and as an attachment with `?download=1`. **`cloudbuild.yaml` now deploys with 1 GiB of memory
  (was 512 MiB)**: the frames are composed in memory.
- **The story scroll** (PNG, PDF) — unchanged; only when all four pictures are real.
- **The card as a PDF** — an e-gift: an A4 landscape PDF to print at home, two pages (outside, inside), each the card's own sheet at true size with crop marks and
  a dashed fold line, and the instruction in the margin (cut, glue back to back or print double-sided, fold: an A6 card); the names and the message are filled
  in. The wooden sizes: a keepsake copy of the printed card itself (A5 landscape with bleed, two pages, the lines for the names left blank as on the printed one).
  Neither carries a sample mark, a price or any order data.
- **Public for ten years**: the gift page stays online for at least ten years (the FAQ says so); nothing deletes a gift record, its pictures or its video.

## The engine spec in this repo

`docs/ICHIREI_Engine_v9_Spec.md` is the owner's spec (v9.3, 2026-10-30) — the single source of truth: if code and the document disagree, the document wins and the difference is reported. The code check of 2026-10-30 found four differences (the free poem, no main-character count in analytics, the wider freestyle teasing list, the palette-row rule); all four were settled by updating the spec, so code and spec agree. The older alignment report of the v9.1 build is `review/V9_1_alignment_report.md`.

## Spec v9.2 step 5 — the freestyle card and money (2026-10-28)

**Money is never blocked in the freestyle card.** Audit of every list and prompt (found / changed):
- **`engine/freestyle-blocklist.csv`** held five money characters under the category `money_status`: **ja 金 銭 稼, zh 钱 錢 — removed.** The other 14 entries of that category are *poverty / stinginess / low-standing* words (ja 貧 乏 賤 卑 吝; zh 穷 窮 贫 貧 贱 賤 抠 摳 吝). They stay, now under the category **`status`**, because a card that says "poor" or "stingy" shames the person by itself (the dignity boundary). **Owner decision:** if you want them off the list too, delete those rows — the safety review's `dignity` rule would then be the only guard.
- **Everywhere else, no money character is on any list:** the ja / zh palette has none as a hard block or "context required" row (宝 and 貴 are plain `ok`), none has a blocked occasion; the remembrance block (`memorial-block.csv`) and the lexicon have none; 財 富 貯 奢 払 貸 借 倹 are in no list at all (the freestyle slot needs no palette row).
- **Prompts:** `engine/prompt.{ja,zh,en}.md` STEP 5b rule 2 forbade "money or status" — now "body, appearance, weight, intelligence, status, sexual meaning, illness, disability, cruelty", plus an explicit **"MONEY IS NOT FORBIDDEN"** paragraph (a friend who always pays, a parent who saved for the children's school, a colleague who lent money; characters 金 銭 財 富 貯 稼 奢 払 宝 …; what stays forbidden is *shaming a person for debt, poverty or stinginess*). `engine/review-prompt.md` (the safety review) listed "money or status" under `insult` — removed; it has a new **MONEY** paragraph (a card is never failed because its topic is money; it fails only under `dignity` for shaming debt / poverty / stinginess; the occasion rules' "debt" means the burden of owing, not money as a topic) and the `dignity` rule now names debt / poverty shaming. `engine/poem-review-prompt.md` listed money among the insults — removed (shaming for debt or poverty still fails).
- **Offered whenever the story gives an honest playful choice:** the optional-freestyle sentence now says to OFFER it for any joke, habit or thing they always do for each other (who is late, who pays, who saves) and to output none only when the story truly holds no shared play or kindness of that kind.
- **Truthful and light (2026-10-30, prompts only):** every line that says who the receiver is (`one_line_gaze`, `why_this`) states only what the story says — no added fact, feeling or outcome ("forgave" when the story says he never came again). The safety review fails such a line under the new rule `truth` (added to `REVIEW_VETO_RULES`, otherwise a veto on a main card would be ignored). The freestyle card is LIGHT — a smile, a shared joke; with no light moment in the story there is no freestyle card, and a painful or shame-linked detail (黒 for oil-stained hands the child was ashamed of) is never used for it (review rules `register` / `dignity`). The sentence above about offering the freestyle for any habit or kindness now applies to light moments only.
- **Story opener (2026-10-30, Part A).** Once a relationship and an occasion are picked, the page shows ONE question above the story box (`engine/story-questions.json`: sets up / across / down / work / memorial × four angles habit / moment / said / changed, ja / zh-Hant / en; a RANDOM angle first, 「別の問いにする」 cycles). The browser sends `prompt_question {id, text}` to `/api/select`; the server uses only the id and its own wording (`engine/story-questions.ts`), puts it on one line before the story (`{{ SENDER QUESTION }}` in the three prompt files: "the story answers this question; the question is context only") and it does not count toward the 2,000 characters. Submit needs **10 characters** (client only; the server still has no minimum). The story, chips and question are saved in the browser as a **draft** (`localStorage` key `ichirei.draft.v1`): offered on return with 続ける / 新しく書く (deletes at once), expires after 30 days, cleared after a successful order; nothing is sent to us. Without speech recognition the voice button is hidden and one line points to the keyboard microphone. New analytics events (codes only: language, question set, a known question id): `story_opened`, `question_shown`, `question_switched`, `voice_used`, `draft_restored`, `story_submitted`, `followup_shown`, `reveal_shown`. The order record keeps `prompt_question_id`. `node scripts/report-choices.mjs --bucket …` now also prints opened → submitted → revealed per language and question set, and which question ids led to which main characters (from the orders; counts only). No new env vars or secrets.
- **The reader's language (2026-10-30, Part B).** A collapsed field under the chips, 「受け取る方が読むのは？」 / 對方閱讀的語言？ / "Where will they read it?" (Japan · Taiwan / Hong Kong / Macau · English-speaking · Other; default = same as the sender; **not shown for remembrance**), sent to `/api/select` as `reader` (`ja | zh | en | other`). The palette referee then judges the character in the buyer's family AND the reader's (`refereeFamilies(language, reader)` in `engine/palette.ts`): Japan → ja, Taiwan etc. → zh, English-speaking → both (as for an English buyer), Other → nothing added. The English rules apply as they are: a hard block or occasion block in either palette removes the card, a main needs a row in both palettes, the freestyle is checked against both blocklists, the review gets the other family's row (`palette_zh` / `palette_ja`), and the lexicon list for the gift only holds characters both palettes accept. Log: `[ichirei-referee] reader cross-check {kanji, slot, blocked_by, reason}` (an English buyer's own cross-check still logs `en cross-check`). The replacement rule is unchanged (a missing main only). `reader` is echoed in the engine result; no new env vars.
- **Copy: the claims must be true (2026-10-30, Part F).** Slogan on the badge row (`s1`) and in the footer (`slogan`): en "Designed in Tokyo. Made in Japan. Delivered worldwide." · ja 「東京でデザインし、日本でつくり、世界へ届ける。」 · zh-Hant 「東京設計・日本製作・送達全世界。」 (it also goes on the printed card, Part E). No hand-made / hand-carved / artisan claim anywhere (use 「木に刻む」 / "made in wood in Japan" / 「刻於木上」), "gold colour" / 「金色」 (never gold leaf / 金箔 until the maker confirms real leaf), "wooden tag" / 「木札」 / 「木牌」 (never walnut until the maker confirms walnut). `scripts/test-claims.ts` scans every customer-facing source for the banned words and fails the build's test run if one comes back.
- **Three sizes (2026-10-31) — this replaces the four sizes below.** 一字礼 eギフト **¥3,980** (`ICHIREI-EGIFT`, nothing posted: the whole digital gift sent as a link, with the downloads and the card as a PDF to print at home) · 木札 ¥9,800 (`ICHIREI-SIMPLE`, おすすめ) · 版木 ¥18,850 (`ICHIREI-STANDARD`); the page shows them left to right in that order. The separate デジタル ¥2,980 and カード ¥4,980 are gone, with `_SHOPIFY_VARIANT_DIGITAL` / `_SHOPIFY_VARIANT_CARD` and their code paths. **You create the e-gift in Shopify yourself** (¥3,980, SKU `ICHIREI-EGIFT`, a digital product with no shipping) and put its variant id in the Cloud Build substitution **`_SHOPIFY_VARIANT_EGIFT`** (env `SHOPIFY_VARIANT_EGIFT`); while it is empty the size is hidden and `/api/order` refuses it (`size_unavailable`). Old test orders carrying `ICHIREI-DIGITAL` / `-CARD` stay readable (`/ops` shows them as 「（旧）…」). The e-gift needs no delivery date (it is delivered at once, or on its opening date) and no shipping choice; 木札 and 版木 keep the ship-to choices (to me / directly / receiver enters the address — Japan only) and the printed card in the box, made by the owner. **`/ops`: an e-gift order never appears in the card print list or in the workshop CSV** (it is listed under 「そのほか … 製作なし」, and its 24-hour change window works as for the others). Remembrance: all three sizes, ink black, no red, plain envelope.
- **Four sizes and where it goes (2026-10-30, Part C).** One gift in four sizes (the story, character, poem, film and story pictures are the same): ① デジタル ¥2,980 (`ICHIREI-DIGITAL`, no shipping) · ② カード ¥4,980 (`ICHIREI-CARD`, A6 folded printed card in an envelope, mail Japan and worldwide) · ③ 木札 ¥9,800 (`ICHIREI-SIMPLE`, recommended; Japan free / overseas EMS ¥6,000) · ④ 版木 ¥18,850 (`ICHIREI-STANDARD`; same shipping). Shown ③, ④, ②, ① (① last, 「今すぐ贈れる」). **The owner creates ① and ② in Shopify** (① a digital product with no shipping), then sets the Cloud Build substitutions `_SHOPIFY_VARIANT_DIGITAL` and `_SHOPIFY_VARIANT_CARD` (env `SHOPIFY_VARIANT_DIGITAL` / `SHOPIFY_VARIANT_CARD`); **while a variant id is empty, that size is hidden on the page (`GET /api/sizes` lists only sizes with a variant) and `/api/order` refuses it (`400 size_unavailable`)**, so the site works with only ③ and ④. Nothing is created in Shopify by us. The order record keeps `size_code`, `ship_to`, `gift_message`, `gift_packaging`, `no_price_slip`; the line attributes add `ichirei_size` (the SKU), `ship_to`, and for a direct gift `gift_packaging=yes`, `no_price_slip=yes`, `gift_message`. Before checkout (②③④): 「自分に届ける」 (the card's 「＿＿さんへ」「＿＿より」 stay blank for handwriting) · 「相手に直接届ける」 (the receiver's address is typed as the shipping address at checkout; names and a message of up to 60 characters are printed on the card; no price slip, gift packaging) · 「eギフトで贈る」 (the receiver types the address — Part D; Japan only for ③④ at launch, worldwide for ②). Remembrance: all four sizes, ink black, plain cord, no gift wording. Stroke limit for ③ (`ICHIREI_SIMPLE_MAX_STROKES`) unchanged.
- **Two pages per order, and the e-gift (2026-10-30, Part D).** The sender's private page `/a/<AN-…>` (exists since the film) now also shows, below the film, the 「贈る」 buttons — LINE (`https://line.me/R/share?text=…`), copy the link (also shown as selectable text), a QR code on screen, e-mail — and where the order stands (size, delivery, e-gift waiting / received; no price). The film page's own share button shares the RECEIVER's link. The receiver's page `/g/<RG-…>` (new, its own 100-bit token, never indexed) plays the film first, then shows 「○○より」, the receiver's name, the sender's message, the character, the certificate line and the poem; it never shows a price, an order number, the other candidates, the sender's story or the sender's page id (its pictures come through `/api/gift/<token>/picture/<n>.webp`). Endpoints: `GET /api/gift/<token>`, `POST /api/gift/<token>/render`, `GET /api/gift/<token>/picture/<n>.webp`, `GET /api/gift/<token>/qr.svg`, `POST /api/gift/<token>/address`. The order creates a second small record `orders/RG-….json` (`engine/gift.ts`) and the Shopify line gets `ichirei_gift_url` (the QR on the printed card points to the receiver page). **E-gift:** the sender types their e-mail (kept on our side only, never sent to Shopify); the receiver presses 「受け取る」 and types name, postal code, prefecture, address, phone (Japan format; the card size also takes another country; ③④ are Japan only). The address is stored on the gift record only and returned by NO call; a second submission is refused. **After 7 days with no address the sender is e-mailed once; after 30 days the order is flagged for the owner (no automatic refund); the address is deleted 90 days after the order ships** (`engine/egift-ops.ts`, run from the owner page, Part E). **No mail service is wired yet:** the reminder is POSTed as `{to, subject, text}` to `ICHIREI_MAIL_WEBHOOK_URL` when that env var is set (any Make / Zapier / own function that sends it); without it nothing is sent and the run only reports who is due — the owner has to choose a mail service. `ops/orders-<day>.jsonl` and `ops/egift.jsonl` in the order bucket hold a small index (order_ref, token, size, where it goes, remembrance, delivery date — no names, story, e-mail or address).
- **Story scroll, card print file and the owner page `/ops` (2026-10-30, Part E).**
  - **Story scroll** (the four pictures, side by side, with the four lines, the character and the slogan, to keep): `GET /api/gift/<token>/scroll.png|pdf` (receiver) and `GET /api/animation/<id>/scroll.png|pdf` (sender). PNG 2400 px wide; PDF is a single page. Shown as 保存 buttons only when **all four pictures are real** (a washi slot or an incomplete film has none: the endpoint answers 404 `not_ready`). Rate limit `ICHIREI_SCROLL_LIMIT` (default 20 per 10 minutes per person). The small picture credit line is the only mention of the drawing method.
  - **Card print file** (`engine/render/`, pdfkit + fontkit + sharp): A5 landscape, 3 mm bleed, two pages (front: character, reading, meaning, certificate line, poem; back: the four pictures, the QR code to the RECEIVER's page, 「＿＿さんへ」「＿＿より」 as typed). Cinnabar only for the main character; remembrance in ink. Text is set from the fonts in `assets/fonts/` (Zen Old Mincho Black for the character, Noto Serif JP / TC Regular for the lines; subset to the characters the site can show — JIS X 0208 and Big5 — about 15 MB in the repo, SIL OFL, see `assets/fonts/README.md`). The Dockerfile copies `assets/`. No font is fetched at run time.
  - **Owner page** `/ops` (no link anywhere, `noindex`, `no-store`): today's orders first, a card PDF per order (②③④), "all of today's cards" as one PDF, a CSV of today's wooden orders for the workshop (③④: character in its carving form, remembrance, where it goes, gift packaging / no price slip, and the e-gift address as typed), buttons to mark 印刷済み / 発送済み (written only to our own order record — **nothing is written to Shopify**), and the e-gift reminder run. It lists codes only, never a story. HTTP Basic Auth, any user name, password = secret `ICHIREI_OPS_PASSWORD`. **Without the password `/ops` answers 503 and stays closed.** The secret is read **at request time** from Secret Manager (like `/track`), so creating it can never break a deploy, and the page works as soon as it exists and is granted. Set it in Cloud Shell (it asks you to type it; it never goes through chat or the repo):
    ```bash
    read -rs -p "ICHIREI ops password: " P; echo
    printf %s "$P" | gcloud secrets create ICHIREI_OPS_PASSWORD --replication-policy=automatic --data-file=- --project=ichirei
    gcloud secrets add-iam-policy-binding ICHIREI_OPS_PASSWORD --project=ichirei \
      --member="serviceAccount:$(gcloud run services describe ichirei --region=asia-northeast1 --project=ichirei --format='value(spec.template.spec.serviceAccountName)' || true)" \
      --role=roles/secretmanager.secretAccessor
    unset P
    ```
    If the `describe` prints nothing, the service runs as the default Compute account: use `PROJECT_NUMBER-compute@developer.gserviceaccount.com` as the member (the same account that already reads `ANTHROPIC_API_KEY`). To rotate, add a new version; the page picks it up within a minute. `ICHIREI_OPS_PASSWORD` set as a plain environment variable wins (local runs only; do not put it in the Cloud Build substitutions). POSTs from `/ops` are accepted only from this very site (Sec-Fetch-Site / Origin). `ICHIREI_OPS_LIMIT` (default 60 per 10 minutes) limits the owner-page calls.
  - **Workshop CSV: the address of "send to me" / "send directly" orders (2026-10-30).** Those orders are addressed at the Shopify checkout, so the CSV asks Shopify for the shipping address of exactly those orders, through the **existing read-only app ICHIREI Tracking** (scope `read_orders` only; the same client id and secret `/track` uses — no new scope, no Shopify setting changed, no write). The order is matched by the `order_ref` our cart carries. The address goes straight into the CSV: it is **not stored, not logged, not shown on any page**. e-gift orders keep the address the receiver typed on our form (never looked up). The `address_source` cell says what happened: `Shopify checkout address` (read), `…order not found (read_orders sees 60 days)`, `…the Tracking app needs protected customer data access (name, address, phone)`, `…not configured` or `…could not be asked just now` — in each failing case the CSV still downloads, the cell says "look it up in Shopify". **If Shopify refuses the address fields**, the only fix is on Shopify's side and is yours to decide: Dev Dashboard → the ICHIREI Tracking app → *API access* → *Protected customer data access* → request **Level 2** (name, address, phone; the email field `/track` already uses is in the same level), reason "fulfil the order", then release a new app version and let it be approved/installed. We change nothing there.
- **Free card preview before payment (2026-10-30).** The flow is now: story → up to three characters with their "how it matches" lines (**no pictures**) → the customer picks ONE character (and the poem format) → the **card's inside** is shown on screen, lightly marked 「見本」, with the chosen character, "who they are", the poem and the **four story pictures with their lines** → size choice and order. Nothing is downloadable before payment (the story scroll and the print PDF only exist for orders). Remembrance: ink black, no red.
  - **The pictures start the moment a character is picked** (`POST /api/preview`: one small model call writes the film script; `POST /api/preview/<id>/render` draws the four pictures and stays open; `GET /api/preview/<id>` shows what is there so far, each picture as soon as it has passed its safety check). They are drawn **once per story**: the draft keeps only a hash of the story + language + remembrance flag; another character, another poem format or another set of candidates asks for the same draft and draws nothing. A changed story (or language, or remembrance) is a new set. At order time the draft **becomes the order's film** (same script, same pictures; `[ichirei-preview] draft_adopted` in the log); if it cannot be adopted (another story, or a line contains the chosen character) the order makes its film as before. Pictures never block checkout.
  - **「別の候補を見る」:** `POST /api/select` accepts `exclude` (the characters already shown, both forms) and `retry` (1 or 2); they are named in the prompt (`{{ ALREADY SHOWN }}` in `engine/prompt.*.md`), left out of the lexicon list and removed by the referee from every slot (`already_shown_eliminated`). At most 2 retries per story (a third is `400 retry_limit`); then the page says to write a little more. Every character shown is kept on the order (`shown_characters`, with its set and slot) — the 24-hour switch list of the owner page.
  - **Cost and limits.** One preview = one script call + four pictures + their checks, before anyone has paid. Per person (the connection's address, like the story limit, per instance): at most **5 new picture sets a day** (`ICHIREI_PREVIEW_DAILY_MAX`, default 5; `0` = no pictures before payment); beyond it the card shows without pictures and says they come after the order. `ICHIREI_PREVIEW_LIMIT` (30 starts per hour per connection) and the existing `ICHIREI_FILM_RENDER_LIMIT` brake the calls. **The global daily cap `ICHIREI_FILM_DAILY_MAX` (default 200 sets) now counts previews too**, so raise it when traffic grows; when it is reached the preview shows without pictures (`deferred`) and so do new orders' films until the next day.
  - **Analytics (codes only):** `card_preview_shown`, `candidates_retry` (1 or 2), `pictures_before_pay` (shown / limited / failed, with whole seconds from the pick), `preview_to_order`.
- **The 24-hour change window after payment (2026-10-30).** Rule: within 24 hours of payment the customer may switch to **another character already shown for this story** (the poem is written again, once, in the same format; the pictures stay), fix the printed names or message, change the poem format once, or cancel for a full refund. After 24 hours nothing for a change of mind (made to order); our own mistakes are fixed within 14 days of delivery; the digital size has the same 24-hour switch and afterwards no refund unless the gift page does not work. **How it is done at launch:** the customer replies to Shopify's order-confirmation e-mail and the owner makes the change on `/ops` in a minute — there is no self-service button yet.
  - **When does the window start? At payment.** There are no payment webhooks, so `/ops` asks Shopify (the read-only ICHIREI Tracking app, `read_orders`; **no customer data in that query**) for each order's payment time, by the `order_ref` our cart carries. Paid / authorized orders count; unpaid (a bank transfer not in yet, an abandoned checkout), cancelled, refunded or voided ones are listed under 「そのほか」 and **never** in the lists to make. If Shopify cannot be asked, the order's own time is used instead and the page and the CSV say so (`payment: unverified`).
  - **Nothing is made before the window closes.** The workshop CSV (木札・版木) and "all cards" PDF list only orders **more than 24 hours after payment**, not cancelled (the CSV also leaves out what is already shipped, the PDF what is already printed). A card PDF or a printed/shipped mark for an order inside the window is refused (409). Orders inside the window are on `/ops` under 「変更受付中（あと◯時間）」, greyed, with their actions.
  - **The owner's actions** (`POST /ops/change`, same password, same-site only; available only inside the window and only for an order that is paid and not cancelled): **change character** (only from `shown_characters` of the order; the poem is rewritten with the same format by the same code as the page's poem step; a poem that cannot be written changes nothing; the Simple set's stroke limit still applies; a film line that contains the new character stops the change); **change poem format** (once per order); **edit the printed names and message** (message at most 60 characters, only for a gift that goes to the receiver); **mark cancelled** (a flag on our record: the order leaves the print list and the CSV — **the refund is made by the owner in Shopify; nothing here touches Shopify**). Each change is written to the order's log (`ops.log`: who = the user name typed at the `/ops` prompt, when, what — the character change as 「証 → 憶」, names as which fields, never story text). The film page and the receiver's page update at once; the film's pictures and lines are never redrawn. **Shopify's own order keeps the character, poem and names that were sent at checkout** (line attributes): production reads our record, so the owner should treat `/ops` as the truth and the Shopify attributes as the original order.
  - **Where the customer reads the rule:** the sender's page `/a/<id>` (the page the order's link opens; there is no thank-you page of ours — the checkout and its thank-you page are Shopify's, which this repo does not touch), the note above the order button, `/legal`, and **Shopify's order-confirmation e-mail, which we do not edit: paste the snippet below there yourself.**
  - **Liquid snippet for the order-confirmation e-mail** (Shopify admin → *Settings → Notifications → Customer notifications → Order confirmation → Edit code*; paste it where the body text should appear, e.g. above the order summary). It shows only when an ICHIREI size is in the order:
    ```liquid
    {% assign has_ichirei = false %}
    {% for line in subtotal_line_items %}
      {% if line.sku contains 'ICHIREI-' %}{% assign has_ichirei = true %}{% endif %}
    {% endfor %}
    {% if has_ichirei %}
      <p>ご注文から24時間以内であれば、ご覧いただいた他の字への変更・キャンセルを承ります。このメールにご返信ください。<br>
      下單後 24 小時內，可更換為您看過的其他字，或取消訂單。請直接回覆此信。<br>
      Within 24 hours of your order you can switch to another character you have seen, or cancel. Just reply to this e-mail.</p>
    {% endif %}
    ```
    (Trim the languages you do not need. `line.sku` is the variant SKU: `ICHIREI-DIGITAL`, `-CARD`, `-SIMPLE`, `-STANDARD`.)
- **Legal notice `/legal` and three FAQ entries (2026-10-30).** `https://ichirei.soul-id.jp/legal` (ja / zh-Hant / en, linked from the footer of the landing and from beside the order button) holds the 特定商取引法 table, the return/change/cancel rules (24 hours; our mistakes within 14 days; digital) and three short questions (the same three are also on the landing's FAQ). **Before this repo, ICHIREI had no such page and no link to one** (the footer had only `/track`); what exists on soul-id.jp or in the Shopify store's own policy pages was not checked and is not touched. **The seller's own details are placeholders — 【 】 — and must be filled by the owner**: 販売業者, 運営責任者, 所在地, 電話番号, メールアドレス, and also the ② card's shipping fee, the payment methods, when payment is taken and the days to make and ship. Edit them in `src/legal/legal-copy.ts` (search for `PLACEHOLDER`), commit and push; the page shows a grey note and tinted cells for as long as one remains. Prices, EMS ¥6,000 and the rules come from the product definition. Have the legal wording read by someone qualified before launch.
  - **E-gift reminders:** `POST /ops/egift/run` (the button on `/ops`) sends the 7-day reminders, flags 30-day orders and deletes addresses 90 days after shipping. To run it daily without opening the page, a Cloud Scheduler job would need to call it with the same Basic Auth — optional, not created by us. Mail: still `ICHIREI_MAIL_WEBHOOK_URL` (a Make / Zapier / own function that receives `{to, subject, text}`); without it nothing is sent.
- **Tests:** `scripts/test-money.ts` (the lists, the prompts, three money stories — `scripts/fixtures-v92/m1-friend-pays-dinner.json` freestyle 奢, `m2-thrifty-mother-school.json` 貯, `m3-colleague-lent-money.json` 貸 — through the real engine with a fake model, every money character surviving the referee and the review, and the dignity verdict still removing a debt-shaming card). **The model is a fake: the real model's choices and the real reviewer's judgement of money cards are unmeasured** — run the three stories through the real engine and read the result.

## Engine v9.1 — aligned to `ICHIREI_Engine_v9_Spec.md` (2026-10-28)

The spec is the single source of truth. **The full step-by-step comparison (what differed, what changed, what the owner should confirm) is in `review/V9_1_alignment_report.md`**; every Section C status change is in `review/v9_1_section_c_changes.csv` (regenerate with `node --experimental-strip-types scripts/apply-spec-v91-palette.ts`, idempotent).

- **New env/settings:** `ICHIREI_SIMPLE_MAX_STROKES` (cloudbuild `_SIMPLE_MAX_STROKES`, default **20**): the Simple set carves at most this many strokes; above it Standard only — enforced on the order form and again by the server (`engine/order.ts`, counts from `engine/strokes.csv`, KANJIDIC2 via the MIT package `kanji-data`, data CC BY-SA 4.0). `/api/health` shows `simpleMaxStrokes`. Set the workshop's real limit there.
- **Carved form:** Japanese (and English) buyers get the modern form 新字体 (温 静 灯); the old-form choice is gone (an old client's `kyujitai` means `modern`). Chinese buyers: traditional by default, simplified on request.
- **Cards:** three "how it matches" lines (who they are / your moment / the feeling), no percentages or scores; the main card may carry 深く響く.
- **New safety behaviour:** goodwill check (a hostile or mocking story is politely declined: `declined: true`, the page shows the message, nothing to answer); relationship test; the review now checks **all three cards** and may veto under `relationship` and `goodwill` besides the earlier rules.
- **Logs added** (no story text): `[ichirei-safety] removed {…}` (every card removed for safety: by referee / review / slots, with the rule), `[ichirei-safety] goodwill_decline`, `[ichirei-lexicon] ideal_not_in_lexicon` (the ideal character the model would have chosen with no limits, when it is not on the list). Existing: `[ichirei-main]` (daily main count), `[ichirei-lexicon] miss`, `[ichirei-lexicon] shadow`, analytics events for chosen / ordered.
- **Not measured on the real model:** the relationship test, the goodwill check, the illness rule and the truth / ideal-character step are prompt rules — the tests only prove the plumbing around them.

### v9.2 (2026-10-28) — readability, and the Chinese wedding block

- **Readability rule (spec step 4, owner decision).** For a **Japanese buyer the MAIN must be a 常用漢字** the receiver can read. A lexicon character outside the 常用漢字 (恕 馨 毅 綴 撫 …) may be the **second or the freestyle only**. Chinese and English buyers: no change. The list is `engine/joyo.txt` (the official 2,136 characters; derived from KANJIDIC2 grades 1–6 and 8, minus the four variant forms 填 剥 頬 𠮟; read by `engine/joyo.ts`). The Japanese eligible list in the prompt marks each non-常用 entry "NOT 常用漢字: second or freestyle only"; `engine/prompt.ja.md` gate 8 and `engine/lexicon-prompt.md` rule 10 say it; and the **code enforces it**: `canBeMain` in the palette referee (`engine/palette.ts`) refuses a non-常用 primary (action `primary_refused_not_readable`) and promotes the readable second; if neither main is readable, ONE replacement is asked for and it must itself be readable to become the main (`engine/replace.ts`, `engine/replace-prompt.md`); the other character stays as the second. It applies in every lexicon mode and in the palette engine. The test is on the character as the candidate carries it: **藏 is not 常用 but its Japanese carved form 蔵 is**, so a Japanese buyer's 蔵 is a readable main (it is partner-only anyway) — the example 藏 in the instruction is a Chinese-form character.
- **Effect on 恕:** a Japanese buyer can no longer get 恕 as the main (it can still be the second), and the stronger variety rule above applies to 誠 和 敬.
- **Chinese wedding block: 断 only.** 帰/归, 還/还, 秋, 続/续, 継/继, 耐 are Japanese 忌み言葉 and are blocked for weddings in the **Japanese** palette only (归 is auspicious in a Chinese wedding, 之子于归). For Chinese buyers the wedding block is just 断, which is already a hard block. The zh wedding blocks added on 2026-10-28 morning for 归 秋 续 继 耐 and the zh 还 row are removed (palette: 823 rows); `scripts/apply-spec-v91-palette.ts` and `review/v9_1_section_c_changes.csv` reflect it.
- **Fixture change:** `scripts/fixtures-v8/s0004-mother-memorial.json` recorded 綴 as the main; 綴 is not 常用, so the replay uses 包 (庇 is still the second).
- **Not measured on the real model:** the variety rule is prompt wording; the readability rule is enforced by code, but how often it forces a replacement call is unknown until live runs.

## Japanese palette review (first pass, applied 2026-10-27)

The Japanese palette (all 322 `ja` rows) had a **first-pass review by an AI reviewer** (Claude), 2026-10-26. The sheets are kept in `review/ja/` (`palette_ja.csv`, `classical_echo_ja.csv`, `Reviewer_Reply_JA.md`). `node scripts/apply-ja-review.mjs` applied them to `engine/palette.csv` (117 cell changes, all stricter or corrections): `taboo_flags`, `blocked_occasions` (including the new `memorial` codes on 27 celebration / beginning characters; wedding 帰 還 続 断 継 秋 耐; retirement 肩 窓; birthday 迎 渡 峠; new_baby 星), six `ok → context_required` (渡 草 犬 耐 黙 梨), reading corrections (峠 背 蝶 祝 想 育), 嘆 carved as 嘆, `inscription_fitness` downgrades. Owner decisions on the 要検討 items: **寿 is not blocked for `new_baby`**; **志 is `context_required`**.

**An AI pass is not a human review.** A `reviewed_by` that starts with "Claude" counts as **not reviewed** (`isAiReviewer` in `engine/palette.ts`): no classical line from those rows is ever shown on a card, `REQUIRE_CLASSICAL_ECHO` stays off (an AI-reviewed line would not satisfy it anyway), an `ok` row stays unvouched for, and no copy may claim a native-speaker or human check (`scripts/test-ja-review.ts` scans the demo, landing and reveal copy). `classical_echo` in `engine/palette.csv` was not touched; `review/ja/classical_echo_ja.csv` is the starting point for the human reviewer (38 lines filled by the AI, **unchecked against a book**). The 18 hand-written `interim-unreviewed` rows keep that marker. When a person signs a row, put their name in `reviewed_by` and the date in `reviewed_on` (the engine then treats the row as reviewed).

Consequence to know about: **迎 is now blocked for `birthday_milestone`** ("お迎えが来る"), and 黙 is `context_required`. The product's golden story (father, 還暦, "駅まで迎えに来て") no longer yields 迎 for that occasion. The automated tests that used that golden answer now run it under `parent_day`.

## Engine speed settings (2026-10-26) — target: under 60 s per run

| Setting | Env | Was | Now |
|---|---|---|---|
| Selection reasoning depth | `ICHIREI_EFFORT` | `high` | **`medium`** |
| Selection output limit (reasoning **and** answer) | `ICHIREI_MAX_TOKENS` | 20000 (8000 for one day) | **14000**. The answer itself is only ≈ 1–2k tokens; the rest is room for the model's reasoning, which a long remembrance story used up (a live run hit 8000 after 105 s). A run that still hits the limit is **retried once automatically with `ICHIREI_MAX_TOKENS_RETRY` (20000)**, inside the run budget; only a second hit shows an error. Logged as `[ichirei-engine] max_tokens_hit {…, retry}`; the `[ichirei-timing]` line carries `attempts` and `max_tokens_used` |
| Review call (it only checks a short answer) | `ICHIREI_REVIEW_MODEL` / `ICHIREI_REVIEW_EFFORT` | the selection model, `low` | **`claude-haiku-5-5`**, `low` (its output limit is 2,500 tokens) |
| Replacement (a missing main card) | `ICHIREI_REPLACE_MODEL` | the review model | the selection model (it must pass the person test); its review uses the review model |
| Longest the selection call (and the replacement's ceiling) may take | `ICHIREI_CALL_TIMEOUT_MS` | — (90000 for one day: it cut off slow-but-fine runs) | **150000** (150 s). A selection that hits it is **retried once automatically** (if the run budget `ICHIREI_RUN_BUDGET_MS`, 270 s, still has room); two timeouts → the page shows its timeout message (`code: model_timeout`) |
| Longest the review call may take | `ICHIREI_REVIEW_TIMEOUT_MS` | — | **60000**. A review that times out (or fails) never fails the run: the selection is shown without it — the mains stand, the unreviewed freestyle is dropped — and it is logged |
| Longest a replacement call may take | `ICHIREI_REPLACE_TIMEOUT_MS` | — | **75000** (it is optional: on timeout the sender simply gets the cards that exist) |

`/api/health` reports the running values (`effort`, `maxTokens`, `maxTokensRetry`, `reviewModel`, `reviewEffort`, `callTimeoutMs`, `reviewTimeoutMs`). **Quality has not been measured on the live model** — compare against the five stories with `scripts/bench-select.mjs` and, if the main characters get shallower, raise `_EFFORT` back to `high` in `cloudbuild.yaml` (one line).

## Editing the engine prompt

`engine/prompt.ja.md`, `engine/prompt.zh.md` and `engine/prompt.en.md` (and `engine/explain-prompt.ja.md` / `.zh.md` / `.en.md`) are plain text read at request time. Edit → commit → push to the trigger's branch → Cloud Build rebuilds and redeploys automatically (~4–6 min). No code changes. (Editing on github.com in the browser works fine.)

## Changing the timeout

Three numbers must stay in step: Cloud Run `--timeout` (`_TIMEOUT` in `cloudbuild.yaml`, 300 s), the server (`ICHIREI_REQUEST_TIMEOUT_MS` / `ICHIREI_SOCKET_TIMEOUT_MS`, default 300 000 ms), and the frontend deadline (`ENGINE_TIMEOUT_MS` in `src/demo/DemoApp.tsx`, 290 s — keep it just under the server's). Cloud Run's maximum is 3600 s.

## The Reveal landing (what changed for deployment)

- The customer site at `/` is the Reveal design (`src/reveal/`; the approved prototype is kept in `design/reveal/`). Nothing new to configure: same service, same secrets.
- **Photos** live in `public/img/` (JPG = the source; `npm run build` makes the WebP files next to them with `sharp`, a build-time tool only). To swap a photo, commit a new JPG of the same name.
- **`GET /api/rates`** serves one daily JPY rate table for the "≈ US$65" lines. The server fetches it from a free keyless source (jsDelivr's currency-api, with a Cloudflare Pages mirror), caches it for 24 hours and never blocks a page on it; if the source is down the lines simply disappear. Checkout is always JPY. `ICHIREI_RATES=off` turns the fetch off. No secret is involved.
- The server now gzips the page, scripts and styles (never `/api/*`, so the streaming heartbeat is untouched) and lets `/img/*` be cached for an hour.
- Fonts come from Google Fonts: the landing loads five families (Bricolage Grotesque, Zen Kaku Gothic New, Zen Old Mincho, Noto Sans TC, Noto Serif TC); `/demo` and `/track` keep the earlier set.

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
