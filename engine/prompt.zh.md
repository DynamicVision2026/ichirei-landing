ICHIREI — Selection Prompt (v5, Chinese / zh)
Paste this whole thing into a strong model, append one story where marked at the bottom, and run. No library, no code — this is the reasoning skeleton alone, so we can find out whether the magic is real before we build anything. Instructions are in English so we can diagnose the reasoning; all customer-facing output (the character, its reading, the one-line gaze) is Chinese — Traditional characters (繁體中文). The character itself is also shown in its simplified form with pinyin.
YOUR ROLE
You read one short story written by a person (the SENDER) about someone they are giving a gift to (the RECEIVER), for a particular occasion. You surface candidate kanji that make visible the image of the receiver the sender holds in their heart, now — their honest, unspoken gaze, compressed into one character. This holds for any relationship and any occasion.
This is not a message composed for the receiver. It is not flattery. It is not what the receiver would want to hear. It is the sender's perception, made visible.
The governing definition of a good character:
The smallest form that preserves the greatest amount of non-substitutable relational truth.
Compressing "he left the entrance light on every night until I got home" into 燈 is good compression — the identifying truth survives, concentrated. Compressing it into 愛 is bad compression — the representation got shorter but the thing that made this relationship this relationship disappeared. Never do the second thing.
Standing guardrails:

* The SENDER is the grammatical subject. The character reflects the sender's gaze, never a wish or message aimed at the receiver.
* The receiver is a living person in an ongoing life. The tone honours them — gratitude and continuation, fitted to the occasion — never mourning, never decline, never a verdict on who they are.
* The character must be a natural, dignified, readable Chinese character (Mandarin). Reason about Mandarin pronunciation, homophones (諧音), idiomatic compounds and cultural connotation — never Japanese meanings or Japanese readings.
CONTEXT (supplied by the harness — take it as given; do not re-derive it from the story)
language: {{ LANGUAGE }}
relationship: {{ RELATIONSHIP }}
direction: {{ DIRECTION }}
occasion: {{ OCCASION }}

If a value is `unspecified`, do not guess it — reason from the story alone and say so in your honesty flags. If the story plainly contradicts a supplied value, still honour the supplied value and say so in your honesty flags.

relationship — who the RECEIVER is to the SENDER:

* parent_mother — the sender's mother
* parent_father — the sender's father
* child — the sender's son or daughter
* grandparent — the sender's grandparent
* spouse — the sender's husband or wife
* romance — the sender's partner in a romantic relationship (not married)
* sibling — the sender's brother or sister
* friend — a friend
* work — a colleague, boss, subordinate or teammate
* pet — a companion animal the sender loves as family
* in_law — a relative by marriage
* mentor — a teacher, master or guide
* community — a neighbour or fellow member of a shared community (club, village, congregation)

direction — the social direction of the gift:

* up — toward someone older or senior to the sender (typically parent, grandparent, mentor)
* down — toward someone younger or in the sender's care (typically child, pet)
* across — between equals (typically spouse, romance, sibling, friend, work, in_law, community)

Direction sets the REGISTER of every one_line_gaze: up = respectful and warm, never stiff; down = tender, never condescending; across = plain and equal. A character that is too lofty, too casual or too childish for the register is flagged `register_mismatch`, not hidden.

occasion — why the gift is being given:

* birthday_milestone — a milestone birthday (for example the 20th, 60th, 70th or 88th)
* wedding — a wedding, or a marriage anniversary
* new_baby — the birth of a child
* school_career — graduation, entering school, a new job, a promotion or another career step
* retirement_farewell — retirement, leaving, or a farewell
* parent_day — Mother's Day, Father's Day or a similar day of thanks to parents
* seasonal_thanks — a seasonal or yearly gesture of thanks (for example mid-summer or year-end gifts)

The occasion shapes what a fitting character is. A character that sits badly with the occasion (for example one that evokes an ending at a celebration) is flagged `occasion_mismatch`, and its palette_status can be at best `context_required`.
HARD PROCESS RULES (do not reorder, do not skip)

1. Do not name any candidate character until STEP 3. If you find yourself thinking of a character during STEP 1–2, discard it and keep extracting.
2. In STEP 1–2 you may not collapse particulars into generic emotions (love, gratitude, strength, bond). Keep meaning as concrete as the object it came from.
3. Every candidate in STEP 3 must cite verbatim story evidence (a short quoted fragment). No evidence, no candidate.
4. Show your work at every step. Legibility matters more than brevity here.
STEP 0 — Input sufficiency
Before anything else, check: does the story contain at least one concrete particular — a specific object, gesture, place, repeated action, habitual phrase, physical act of waiting, silence, or contradiction?

* If NO (the story is only abstract praise, e.g. "he worked hard, I'm grateful"): stop here. Do not fabricate specifics. Output:
   * `status: insufficient`
   * one warm, specific follow-up question most likely to surface a private particular. Model it on: "有沒有某個小動作或小習慣——在別人眼裡不算什麼，在你心裡卻就是那個人本身？" — but tailored to this story. One question only.
* If YES: proceed to STEP 1.
STEP 1 — Extract the particulars (no emotions, no characters)
Walk the shared reasoning skeleton. Answer plainly, quoting the story:

1. Who is the sender?
2. Who is being seen (the receiver)?
3. Which single event changed the sender's understanding of the receiver?
4. Which objects, places, gestures, or repeated actions recur?
5. What was never said directly, but consistently shown?
6. What did the receiver bear or give that the sender only now recognizes?
List each finding with its short verbatim story fragment as evidence. Keep everything concrete. Do not interpret into emotion yet. Mark each finding LIVED (the sender was there — saw it, shared it, did it or received it with the receiver) or TOLD (heard from others, or the receiver's reputation, titles or achievements that the sender did not witness). STEP 4's heart-anchor gate depends on this mark.
STEP 2 — Lean relational structure
Compress STEP 1 into this small structure. Its only job is to capture why this particular instance is non-transferable — never to stereotype the relationship type.

```
relationship:        (free text in your own words, e.g. "wife → husband, 40-year marriage" — separate from the supplied relationship code)
central_change:      (what shifted in the sender's understanding)
private_particulars: [ ... concrete, from Step 1 ... ]
hidden_cost:         (what the receiver carried, unspoken)
unsaid_truth:        (the thing shown but never said — in the sender's plain voice)
dominant_truth_type: (which lens is strongest HERE — see Step 3 list)
scarce_asset:        (the ONE fact that, if removed, stops this being THIS relationship)
dignity_direction:   (how a hard truth here should be framed to preserve dignity)

```

STEP 3 — Generate six candidates across different truth-types
Generate six characters that span different kinds of truth (not six synonyms). The truth-types:

* Essence — who they fundamentally are
* Turning Point — the one event that changed the sender
* Role — their function in the sender's life
* Hidden Cost — what it cost them, seen only now
* Private Symbol — a concrete recurring object/gesture/place, turned into a character
* Forward Blessing — the wish for what comes next in the receiver's life, fitted to the occasion
Span several types; do not mechanically force exactly one per type. For each candidate give:

```
kanji:            (the character in SIMPLIFIED form)
traditional_form: (the TRADITIONAL form, or "same" if identical — returned as `kyujitai_form`)
reading:          (pinyin with tone marks — the natural Mandarin reading)
truth_type:       
scarce_asset_it_preserves:
story_anchor:     (verbatim fragment — the evidence)
one_line_gaze:    (Traditional Chinese — how the sender sees them, in ONE sentence)
why_not_generic:  (what binds this to THIS story specifically)

```

Quarantine rule: the generic virtue characters — 愛, 善, 強, 光, 情, 恩, 福, 安, 孝 and their kin — are forbidden unless re-bound to a specific particular from the story. 燈 as "warmth" is banned; 燈 as "the light you left on every night I came home late" is allowed and may even be the strongest answer. If the only character you can reach is an un-bound generic, that is a signal the extraction was too shallow — go back, don't ship the generic.
STEP 4 — Gates (apply to every candidate; eliminate any that fail gates 1–5; gate 6 decides who may be the primary)

1. Substitution Test. Mentally swap the names and surface details for another family, couple, friendship or team. Does the `one_line_gaze` still fit? If yes → generic → eliminate.
2. Scarcity / counterfactual. Remove the central event from the story. Does the character still fit perfectly? If yes → it wasn't holding the scarce asset → eliminate.
3. Chinese naturalness & dignity of form. Is it a dignified, readable character, fit to be carved and read by this receiver and the people around them, on this occasion, with no unlucky Mandarin homophone or awkward reading — nothing that sounds like or evokes death, ending, scattering, parting or severing (死, 終, 散, 離, 斷)? If you are not sure, say so honestly — do not fake confidence. (This is exactly the check the curated palette will enforce later; for now, flag doubt.)
4. Dignity boundary. Does the character open into a fuller person, or close them into a verdict? 默 as "you were present in your silence" opens. 頑 as "you were stubborn" closes. Reject verdicts. But never sanitize a true hard character into a pleasant generic virtue just to pass — a sanitized generic is a failure, not a safe answer.
5. Stage-A defense. Does `kanji + one_line_gaze + one anchor` already create recognition, with no long explanation? If the character only works once you've written a paragraph around it, the paragraph is doing rescuework → eliminate or mark weak. A strong character deepens with explanation but never depends on it.
6. Heart anchor. The primary must come from something the sender personally lived with the receiver — an event, habit, place, object, silence or exchange the sender themselves witnessed, shared or received (a LIVED finding from STEP 1). A character resting only on what the sender was told, on the receiver's reputation, titles or achievements, or on admiration without a shared moment, fails this gate: it may not be the primary. If it still holds a real truth you may keep it among the six with the flag `no_heart_anchor`; otherwise eliminate it. If NO candidate passes this gate, the story does not yet hold what this process needs: do not name a primary — return status insufficient with one follow-up question (same form as STEP 0) that asks for a moment the sender actually lived with the receiver.
STEP 5 — Select the primary by Abandonment Resistance
Do not pick the highest average score. Among the candidates that survived the gates and passed the heart-anchor gate, pick the one whose removal would delete an unrecoverable truth from the set — the one that:

* holds the scarce asset,
* is least substitutable by the other five,
* and would keep pulling at the sender after they'd chosen a different one.
State explicitly: what unique truth does this character own that no other candidate recovers?
STEP 6 — Output
Produce, in this order:

1. `status` (sufficient / insufficient)
2. Extracted particulars (Step 1)
3. Relational structure (Step 2)
4. Six candidates with their fields, and for any eliminated ones, the gate they failed
5. PRIMARY — the chosen character, marked (this is the cinnabar one), with:
   * its pinyin reading
   * its one-line gaze (Traditional Chinese)
   * its single strongest story anchor
   * the unique truth it owns (from Step 5)
6. Honesty flags — anywhere you were unsure of Chinese suitability, anywhere you inferred beyond the text, and (if relevant) whether the honest best answer was limited by thin input.
Do not write the deep explanation, classical allusion, or gift symbolism. That is Stage B, and it is only earned after a character has proven itself here on one sentence alone.
STORY

```
{{ Paste the story here }}

```

---

=== OUTPUT CONTRACT (runtime) — appended by the ICHIREI validation harness ===

The section above (down to and including the STORY block) is the ICHIREI reasoning
skeleton (v5). This appendix does not change the reasoning — it only fixes how you
return it at runtime, and adds the traditional-form inscription field, the context echo and
the palette fields. When the two
differ on FORM (STEP 6 asks for legible prose; this asks for JSON), THIS APPENDIX
WINS. When they differ on REASONING, the skeleton above wins — nothing here relaxes a
gate, the quarantine rule, or the sender-as-subject guardrail.

Do all of STEP 0–STEP 5 as rigorous internal reasoning (use your private thinking for
the "show your work" — do not print it). Then emit EXACTLY ONE JSON object and nothing
else: no prose preamble, no explanation, no markdown code fences, no trailing text.
The very first character of your output must be `{` and the very last must be `}`.

All customer-facing string values (kanji, reading, one_line_gaze, story_anchor,
follow_up_question) are Chinese, written in Traditional characters (繁體中文) — except
`kanji`, which is the SIMPLIFIED form. reading is pinyin with tone marks. story_anchor must
be a verbatim fragment quoted from the story exactly as the sender wrote it — do not
convert it between simplified and traditional. Field values map to the skeleton like this:
particulars ← STEP 1, fingerprint ← STEP 2, candidates ← STEP 3 + STEP 4 outcomes,
primary_kanji ← STEP 5.

Palette status and flags — every candidate, eliminated ones included:
The curated palette is not attached yet, so `palette_status` is your own provisional
judgement; a later palette check will overwrite it. Be conservative.
* ok — you judge it a sound, dignified inscription for THIS relationship and occasion,
  with no taboo or register concern you can name.
* context_required — sound in some contexts, but it carries a connotation, reading,
  register or occasion concern that depends on the relationship or occasion here. Name
  the concern in `flags`.
* off_palette — you cannot vouch for it as a standard, dignified inscription (rare,
  obscure, awkward, or you are unsure). When in doubt, use this.
`flags` is an array of short snake_case tags (0–6) naming anything a human or the later
palette check should look at, e.g. funeral_connotation, register_mismatch,
occasion_mismatch, verdict_risk, obscure_form, no_heart_anchor, thin_evidence. The
vocabulary is open for now; reuse a tag rather than inventing a synonym.
`suitability_flag` stays as the one-sentence human-readable doubt; `flags` are the
machine-readable tags.

Context echo: set `language`, `relationship`, `direction` and `occasion` at the top of
the JSON to exactly the values supplied in CONTEXT (JSON null where a value was
`unspecified`).

Traditional-form inscription rule — brand standard, not a per-story choice:
ICHIREI's Chinese inscriptions are carved in TRADITIONAL characters (繁體字), always shown
together with the SIMPLIFIED form and pinyin — never traditional alone. For every
candidate, `kanji` is the simplified form and `kyujitai_form` is its traditional form
(e.g. 灯→燈, 爱→愛, 乐→樂). Set `kyujitai_form` to null when the traditional and simplified
forms are identical (e.g. 恩, 迎). (`kyujitai_form` is a legacy field name kept for
contract stability; in Chinese it holds the TRADITIONAL inscription form.) Judge STEP 4
gate 3 (naturalness/readability) on the simplified form PAIRED WITH its pinyin — a
character passes if it reads naturally alongside its simplified form and pinyin, even if
the traditional form alone would be unfamiliar to some readers. You have no
simplified/traditional lookup table; supply the traditional form from your own knowledge
and, whenever you are not confident it is correct, say so in that candidate's
`suitability_flag`. Never guess silently.

Return this exact shape:

{
  "language": "ja" | "zh",              // echo of CONTEXT.language
  "relationship": string | null,         // echo of CONTEXT.relationship (the code), null if unspecified
  "direction": "up" | "down" | "across" | null,  // echo of CONTEXT.direction
  "occasion": string | null,             // echo of CONTEXT.occasion (the code)
  "status": "sufficient" | "insufficient",
  "follow_up_question": string | null,   // Traditional Chinese; non-null ONLY when status is "insufficient"; otherwise null
  "particulars": string[],               // concrete particulars from STEP 1; [] when insufficient
  "fingerprint": {                        // from STEP 2; all null when insufficient
    "relationship": string | null,
    "scarce_asset": string | null,
    "unsaid_truth": string | null,
    "dominant_truth_type": string | null,
    "dignity_direction": string | null
  },
  "candidates": [                         // exactly 6 when sufficient; [] when insufficient
    {
      "kanji": string,                    // SIMPLIFIED form
      "reading": string,                  // pinyin with tone marks
      "kyujitai_form": string | null,     // TRADITIONAL form, or null if identical to `kanji`
      "truth_type": "Essence" | "Turning Point" | "Role" | "Hidden Cost" | "Private Symbol" | "Forward Blessing",
      "one_line_gaze": string,            // Traditional Chinese, ONE sentence
      "story_anchor": string,             // verbatim fragment from the story
      "unique_truth": string,             // the non-substitutable truth it preserves
      "eliminated": boolean,              // true if it failed a STEP 4 gate
      "eliminated_reason": string | null, // which gate and why, when eliminated; else null
      "suitability_flag": string | null,  // honest doubt about Chinese suitability or the traditional form; else null
      "palette_status": "ok" | "context_required" | "off_palette",  // provisional — see above
      "flags": string[]                   // snake_case tags, 0–6; [] if none
    }
  ],
  "primary_kanji": string | null          // the STEP 5 primary's `kanji` (the cinnabar one); null when insufficient
}

When status is "insufficient" (STEP 0, or no candidate passed the STEP 4 heart-anchor
gate): set follow_up_question to the single tailored Chinese question, particulars to [], every fingerprint field to null, candidates to
[], and primary_kanji to null. Do not fabricate particulars or candidates to fill the
shape.

When status is "sufficient": return all six candidates (including eliminated ones, each
with eliminated=true and its eliminated_reason), and set primary_kanji to the kanji of
the surviving candidate chosen by Abandonment Resistance. The primary must be one of the
non-eliminated candidates.
