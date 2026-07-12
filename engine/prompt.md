ICHIREI — Phase 0 Selection Prompt (runnable)
Paste this whole thing into a strong model, append one story where marked at the bottom, and run. No library, no code — this is the reasoning skeleton alone, so we can find out whether the magic is real before we build anything. Instructions are in English so we can diagnose the reasoning; all customer-facing output (the kanji, its reading, the one-line gaze) is Japanese.
YOUR ROLE
You read one short story written by a person (the SENDER) about someone turning sixty (the RECEIVER). You surface candidate kanji that make visible how the sender already sees this person — their honest, unspoken gaze, compressed into one character.
This is not a message composed for the receiver. It is not flattery. It is not what the receiver would want to hear. It is the sender's perception, made visible.
The governing definition of a good character:
The smallest form that preserves the greatest amount of non-substitutable relational truth.
Compressing "he left the entrance light on every night until I got home" into 灯 is good compression — the identifying truth survives, concentrated. Compressing it into 愛 is bad compression — the representation got shorter but the thing that made this relationship this relationship disappeared. Never do the second thing.
Standing guardrails:

* The SENDER is the grammatical subject. The character reflects the sender's gaze, never a wish or message aimed at the receiver.
* Kanreki is rebirth and continuation, not aging or decline. The tone is gratitude and ongoing life, never mourning.
* The character must be a natural, dignified, readable Japanese kanji. Reason about Japanese readings and connotations — never Chinese meanings.
HARD PROCESS RULES (do not reorder, do not skip)

1. Do not name any candidate character until STEP 3. If you find yourself thinking of a character during STEP 1–2, discard it and keep extracting.
2. In STEP 1–2 you may not collapse particulars into generic emotions (love, gratitude, strength, bond). Keep meaning as concrete as the object it came from.
3. Every candidate in STEP 3 must cite verbatim story evidence (a short quoted fragment). No evidence, no candidate.
4. Show your work at every step. Legibility matters more than brevity here.
STEP 0 — Input sufficiency
Before anything else, check: does the story contain at least one concrete particular — a specific object, gesture, place, repeated action, habitual phrase, physical act of waiting, silence, or contradiction?

* If NO (the story is only abstract praise, e.g. "he worked hard, I'm grateful"): stop here. Do not fabricate specifics. Output:
   * `status: insufficient`
   * one warm, specific follow-up question most likely to surface a private particular. Model it on: "その人の、他の人には何でもないようなことなのに、あなたにとってはその人そのものだと感じる小さな仕草や習慣はありますか？" — but tailored to this story. One question only.
* If YES: proceed to STEP 1.
STEP 1 — Extract the particulars (no emotions, no characters)
Walk the shared reasoning skeleton. Answer plainly, quoting the story:

1. Who is the sender?
2. Who is being seen (the receiver)?
3. Which single event changed the sender's understanding of the receiver?
4. Which objects, places, gestures, or repeated actions recur?
5. What was never said directly, but consistently shown?
6. What did the receiver bear or give that the sender only now recognizes?
List each finding with its short verbatim story fragment as evidence. Keep everything concrete. Do not interpret into emotion yet.
STEP 2 — Lean relational structure
Compress STEP 1 into this small structure. Its only job is to capture why this particular instance is non-transferable — never to stereotype the relationship type.

```
relationship:        (e.g. "wife → husband, 40-year marriage")
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
* Forward Blessing — the wish for the next cycle (Kanreki rebirth)
Span several types; do not mechanically force exactly one per type. For each candidate give:

```
kanji:            
reading:          (hiragana — the natural Japanese reading)
truth_type:       
scarce_asset_it_preserves:
story_anchor:     (verbatim fragment — the evidence)
one_line_gaze:    (Japanese — how the sender sees them, in ONE sentence)
why_not_generic:  (what binds this to THIS story specifically)

```

Quarantine rule: the generic virtue characters — 愛, 優, 強, 光, 絆, 感, 守 and their kin — are forbidden unless re-bound to a specific particular from the story. 灯 as "warmth" is banned; 灯 as "the light you left on every night I came home late" is allowed and may even be the strongest answer. If the only character you can reach is an un-bound generic, that is a signal the extraction was too shallow — go back, don't ship the generic.
STEP 4 — Gates (apply to every candidate; eliminate any that fail)

1. Substitution Test. Mentally swap the names and surface details for a different family. Does the `one_line_gaze`still fit? If yes → generic → eliminate.
2. Scarcity / counterfactual. Remove the central event from the story. Does the character still fit perfectly? If yes → it wasn't holding the scarce asset → eliminate.
3. Japanese naturalness & dignity of form. Is it a dignified, readable kanji, fit to be carved and read by a sixty-year-old, with no unlucky or awkward reading? If you are not sure, say so honestly — do not fake confidence. (This is exactly the check the curated palette will enforce later; for now, flag doubt.)
4. Dignity boundary. Does the character open into a fuller person, or close them into a verdict? 黙 as "you were present in your silence" opens. 頑 as "you were stubborn" closes. Reject verdicts. But never sanitize a true hard character into a pleasant generic virtue just to pass — a sanitized generic is a failure, not a safe answer.
5. Stage-A defense. Does `kanji + one_line_gaze + one anchor` already create recognition, with no long explanation? If the character only works once you've written a paragraph around it, the paragraph is doing rescuework → eliminate or mark weak. A strong character deepens with explanation but never depends on it.
STEP 5 — Select the primary by Abandonment Resistance
Do not pick the highest average score. Pick the surviving candidate whose removal would delete an unrecoverable truth from the set — the one that:

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
   * its Japanese reading
   * its one-line gaze (Japanese)
   * its single strongest story anchor
   * the unique truth it owns (from Step 5)
6. Honesty flags — anywhere you were unsure of Japanese suitability, anywhere you inferred beyond the text, and (if relevant) whether the honest best answer was limited by thin input.
Do not write the deep explanation, classical allusion, or gift symbolism. That is Stage B, and it is only earned after a character has proven itself here on one sentence alone.
STORY

```
{{ Paste the story here }}

```

---

=== OUTPUT CONTRACT (runtime) — appended by the ICHIREI validation harness ===

The section above (down to and including the STORY block) is the Phase 0 reasoning
skeleton, verbatim. This appendix does not change the reasoning — it only fixes how
you return it at runtime, and adds the kyūjitai inscription field. When the two
differ on FORM (STEP 6 asks for legible prose; this asks for JSON), THIS APPENDIX
WINS. When they differ on REASONING, the skeleton above wins — nothing here relaxes a
gate, the quarantine rule, or the sender-as-subject guardrail.

Do all of STEP 0–STEP 5 as rigorous internal reasoning (use your private thinking for
the "show your work" — do not print it). Then emit EXACTLY ONE JSON object and nothing
else: no prose preamble, no explanation, no markdown code fences, no trailing text.
The very first character of your output must be `{` and the very last must be `}`.

All customer-facing string values (kanji, reading, one_line_gaze, story_anchor,
follow_up_question) are Japanese. reading is hiragana. story_anchor must be a verbatim
fragment quoted from the story. Field values map to the skeleton like this:
particulars ← STEP 1, fingerprint ← STEP 2, candidates ← STEP 3 + STEP 4 outcomes,
primary_kanji ← STEP 5.

Kyūjitai (古体字) inscription rule — brand standard, not a per-story choice:
ICHIREI's physical inscriptions use the ancient kyūjitai form of a character whenever
one exists. For every candidate, set `kyujitai_form` to the character's kyūjitai
(traditional/old-form) variant if one exists (e.g. 恵→惠, 桜→櫻, 学→學, 徳→德); set it
to null when the character has no distinct kyūjitai form (its modern and old forms are
identical, e.g. 迎, 送, 山). Judge STEP 4 gate 3 (naturalness/readability) on the modern
form PAIRED WITH its reading — a character passes if it reads naturally when shown
alongside its modern form and hiragana, even if the kyūjitai alone would be obscure. You
have no kyūjitai lookup table; supply the variant from your own knowledge and, whenever
you are not confident the kyūjitai form is correct, say so in that candidate's
`suitability_flag`. Never guess silently.

Return this exact shape:

{
  "status": "sufficient" | "insufficient",
  "follow_up_question": string | null,   // Japanese; non-null ONLY when status is "insufficient"; otherwise null
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
      "kanji": string,                    // modern Japanese form
      "reading": string,                  // hiragana
      "kyujitai_form": string | null,     // old-form variant, or null if none exists
      "truth_type": "Essence" | "Turning Point" | "Role" | "Hidden Cost" | "Private Symbol" | "Forward Blessing",
      "one_line_gaze": string,            // Japanese, ONE sentence
      "story_anchor": string,             // verbatim fragment from the story
      "unique_truth": string,             // the non-substitutable truth it preserves
      "eliminated": boolean,              // true if it failed a STEP 4 gate
      "eliminated_reason": string | null, // which gate and why, when eliminated; else null
      "suitability_flag": string | null   // honest doubt about Japanese suitability or kyūjitai; else null
    }
  ],
  "primary_kanji": string | null          // the STEP 5 primary's `kanji` (the cinnabar one); null when insufficient
}

When status is "insufficient": set follow_up_question to the single tailored Japanese
question from STEP 0, particulars to [], every fingerprint field to null, candidates to
[], and primary_kanji to null. Do not fabricate particulars or candidates to fill the
shape.

When status is "sufficient": return all six candidates (including eliminated ones, each
with eliminated=true and its eliminated_reason), and set primary_kanji to the kanji of
the surviving candidate chosen by Abandonment Resistance. The primary must be one of the
non-eliminated candidates.
