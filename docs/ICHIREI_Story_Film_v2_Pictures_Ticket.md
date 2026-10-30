> **Superseded in detail by the code and DEPLOY.md; kept for the original intent.**

# ICHIREI story film v2: new pictures for every order

**Builds on:** `ICHIREI_Story_Film_Engine_Ticket.md` (commit `85cb341`). Everything stays the same except the pictures.

**Owner decision:** the fixed 40-picture library is dropped. Every order gets **4 new pictures drawn from its own story**, so each film matches the story it tells.

---

## 1. What changes
| | Now (`85cb341`) | v2 |
|---|---|---|
| Film script call | 4 lines + 4 library scene IDs | 4 lines + **4 picture descriptions** |
| Pictures | Library placeholders `S-01…S-40` | **4 new images per order**, from Google's image model on Vertex AI |
| When pictures are made | (not made) | On the **first open** of `/a/<id>` (after payment) |
| Fallback | S-39 / S-40 | A plain washi picture for any slot that fails; the film always plays |

Keep: the lines, the checks on the lines, the timing, the character reveal, memorial mode, reduced motion, delivery, and the logs.

## 2. The film script call (change)
The output becomes:
```json
{ "lines": ["…","…","…","…"],
  "pictures": ["…","…","…","…"] }
```
Each picture description is **English, 15–40 words**, describing **one moment from the story** for its line: the people as silhouettes, hands or seen from behind; the key object or action; the place; the season and light.

Rules (add to `engine/film-prompt.md`):
- **Only what the story says.** No new objects, places or people.
- **No faces.** People appear only as silhouettes, as hands, or seen from behind.
- **No text of any kind** in the picture: no letters, signs, screens with words, logos or brands.
- No names, real places, schools or companies.
- **No illness, hospital, injury, funeral or decline images**, even if the story mentions them; show the moment around them instead. For memorial orders, no celebration images.
- Setting: follow the story's own culture and place. If the story doesn't say, use a simple neutral East Asian home or street.
- The four pictures are four different moments, in story order.

**Code check on the pictures:** each description is 15–40 words, contains no digits and no level 1 words, and does not contain the chosen character. If a check fails, retry once. If it fails again, the script fallback applies as today.

## 3. Making the pictures
- **Model:** Google's image model on Vertex AI.
  - Model name in env `ICHIREI_FILM_IMAGE_MODEL`, location in `ICHIREI_FILM_IMAGE_LOCATION`. Choose the current recommended image-generation model and a region where it is available, and report both.
  - Auth: the Cloud Run service account through Application Default Credentials. **No API key.** (The owner enables the API and grants the role; see section 8.)
- **Prompt = fixed style + the picture description.** The style text is fixed in code, the same for every order:
  > Japanese sumi-e ink-wash painting on warm off-white washi paper. Soft graded black ink only, with at most one muted earth-brown accent wash. Loose, confident brush strokes, visible paper grain, generous empty space. People only as simple silhouettes, as hands, or seen from behind; no faces or facial features. No text, letters, signatures, seals or frames. Quiet, tender, everyday life. Consistent hand, as if one painter made the whole series. Portrait 4:5.

  Memorial adds: *"Paler grey-beige paper, very soft ink, still and calm."*
- **Format:** portrait 4:5, saved as WebP at about 1080×1350.
- **Storage:** in the existing private order bucket under `films/<animation-id>/1.webp … 4.webp`. Serve the pictures through the server (or short-lived signed URLs). They must never be publicly listable.
- The 4 pictures are made **in parallel**.

## 4. When the pictures are made (and the Cloud Run CPU problem)
- **The film script** is still written at order creation, as today.
- **The pictures** are made when `/a/<id>` is **first opened**, which happens after payment. Unpaid orders cost nothing for pictures.
  - The page shows 「映像を準備しています」 and calls `POST /api/film/<id>/render`. **That request stays open until the pictures are done** (timeout 120 s), so the CPU stays allocated and nothing is lost. No `--no-cpu-throttling` is needed.
  - Use a lock so two opens never make two sets of pictures. A second open waits for the first, or polls.
  - If the script is missing (for example it was lost after the order response), the same request writes the script first, then makes the pictures.
- Once the pictures are saved, every later open plays at once with no AI call.

## 5. Picture check (one fast vision call)
After the 4 pictures are made, one `claude-haiku-5-5` call looks at all 4 together with their descriptions. A picture **fails** if it shows:
- a face with features;
- any readable text or letters;
- illness, hospital, injury, blood or a funeral (any order);
- celebration in a memorial order;
- nudity or violence;
- something clearly different from its description.

Any failed picture is **made again once**. If it fails a second time, that slot uses the plain washi fallback picture. A film never shows a failed picture. Log `film_picture_fail` with the reason (no story text).

## 6. Fallbacks and limits
- If the image model is unavailable or times out, the failed slots use the washi fallback and the film still plays. Log `film_image_error`.
- **Limits per order:** at most 1 full set plus 4 single-picture retries.
- **Daily limit:** env `ICHIREI_FILM_DAILY_MAX`, default 200 films a day. Above it, the pictures wait until the next day and the page says 「映像は明日お届けします」.
- Remove the library placeholders `S-01…S-38` and `manifest.json`. Keep 2 generic washi pictures as the fallback.

## 7. Logs (no story text)
`film_render_start`, `film_render_done` (with time taken and picture count), `film_picture_fail` (with the reason), `film_image_error`, and an estimated cost per film.

## 8. What the owner does (one time, in Cloud Shell)
The builder writes the exact commands in `DEPLOY.md`:
- Enable the Vertex AI API in project `ichirei`.
- Grant the Cloud Run service account the role **Vertex AI User** (`roles/aiplatform.user`).
- Add the new env vars to `cloudbuild.yaml` (not set by hand on the console, because the next deploy would overwrite them).

## 9. Tests
- **Offline suites:** mock the image model and the vision check. Test:
  - the lock;
  - the per-slot fallback;
  - the limits;
  - memorial rules;
  - a missing script being rewritten on open;
  - the bucket staying private.
- **Real test on the live site:** with `_ANIMATION_SAMPLES` on, the 4 sample films (`AN-sample…`) use real picture descriptions. They are hand-written in the sample data; for the ja sample, write them from story 0020. Opening a sample link makes real pictures, so the owner can judge the look on his phone.
- Test on iPhone Safari and Android Chrome.

## 10. Done when
- Opening the Japanese sample link makes 4 real ink-wash pictures that match the lunchbox story, and the film plays with them.
- An ICHIREITEST order creates a film whose pictures match that order's own story.
- All suites pass, the build is green, and a new Cloud Run revision exists.
- Report:
  - the commit;
  - the model and region used;
  - the measured time and estimated cost per film;
  - the Cloud Shell commands for the owner.
- **Nothing in Shopify or outside this repo is touched. Never print or commit secrets.**
