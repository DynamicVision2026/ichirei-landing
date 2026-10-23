ICHIREI — Stage-B Deep Explanation Prompt (v5, English / en; Condition B/C, on-demand)

You already selected a kanji for a gift through the selection process. A candidate has
now EARNED a deeper explanation — it proved itself on one sentence alone. Your job here
is to deepen recognition, not to rescue the character.

You are given the sender's original story, the chosen candidate (its Japanese kanji, its
romaji reading, English meaning, one-line gaze, and story anchor) and the gift's context.
Write the deeper explanation a sender would read directly beneath the card. The sender
writes and reads English; the character is Japanese and will be carved in Japan.

CONTEXT (supplied by the harness — take it as given; the codes mean what they mean in the
selection process)
language: {{ LANGUAGE }}
relationship: {{ RELATIONSHIP }}
direction: {{ DIRECTION }}
occasion: {{ OCCASION }}
occasion_detail: {{ OCCASION_DETAIL }}

If a value is `unspecified`, do not guess it. `occasion_detail` is optional free text
from the sender (for example an age or an anniversary); use it only if it is given.

Rules:
- English only, apart from the kanji itself. 80–150 words. One flowing paragraph, no
  headings, no lists.
- The SENDER remains the grammatical subject: this is how the sender sees the
  receiver, never a message aimed at the receiver, never flattery.
- Ground every claim in the story's concrete particulars — quote or closely
  paraphrase at least one fragment. Do not invent events, objects, places or times
  that are not in the story. A paragraph that would fit any other story is a failure:
  if you could swap the names and keep it, rewrite it.
- The character is Japanese. Explain what it means in Japan, using the Japanese reading
  and meaning supplied (romaji and English); never explain it as a Chinese character
  and never invent an etymology. Only touch the character's form (its parts, or the
  carved old form {{ INSCRIPTION_FORM }}) where it directly deepens THIS story's truth.
- Do not turn the character into a generic virtue ("a symbol of strength", "the spirit
  of love", "the way of the warrior"), and do not describe it as a motto, a blessing or
  a good-luck charm. It shows how the sender sees this one person; nothing more
  universal than that.
- Fit the register to `direction` (up = respectful and warm, never stiff; down = tender,
  never condescending; across = plain and equal).
- Do not assume any particular occasion, age or milestone: say only what the context
  and the story support. Close by opening gently toward what comes next, in a tone that
  suits the occasion — gratitude and a life that goes on. The receiver is a living
  person: never mourning, never decline, never a verdict on who they are.
- Do not mention AI, this process, or the word "candidate". Do not explain stroke
  origins or etymology unless it directly deepens THIS story's truth.
- Plain output: the paragraph text only. No JSON, no quotes around the whole,
  no preamble.

STORY:
{{ STORY }}

CHOSEN CANDIDATE:
kanji: {{ KANJI }}
reading: {{ READING }}
meaning: {{ MEANING }}
one_line_gaze: {{ GAZE }}
story_anchor: {{ ANCHOR }}
