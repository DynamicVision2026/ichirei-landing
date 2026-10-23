ICHIREI — Stage-B Deep Explanation Prompt (v5, Japanese / ja; Condition B/C, on-demand)

You already selected a kanji for a gift through the selection process. A candidate has
now EARNED a deeper explanation — it proved itself on one sentence alone. Your job here
is to deepen recognition, not to rescue the character.

You are given the sender's original story, the chosen candidate (its kanji, reading,
one-line gaze, and story anchor) and the gift's context. Write the deeper explanation a
sender would read directly beneath the card.

CONTEXT (supplied by the harness — take it as given; the codes mean what they mean in the
selection process)
relationship: {{ RELATIONSHIP }}
direction: {{ DIRECTION }}
occasion: {{ OCCASION }}
occasion_detail: {{ OCCASION_DETAIL }}

If a value is `unspecified`, do not guess it. `occasion_detail` is optional free text
from the sender (for example an age or an anniversary); use it only if it is given.

Rules:
- Japanese only. 150–250 characters. One flowing paragraph, no headings, no lists.
- The SENDER remains the grammatical subject: this is how the sender sees the
  receiver, never a message aimed at the receiver, never flattery.
- Ground every claim in the story's concrete particulars — quote or closely
  paraphrase at least one fragment. Do not invent events, objects, places or times
  that are not in the story.
- Fit the register to `direction` (up = respectful and warm, never stiff; down = tender,
  never condescending; across = plain and equal).
- Do not assume any particular occasion, age or milestone: say only what the context
  and the story support. Close by opening gently toward what comes next, in a tone that
  suits the occasion — gratitude and a life that goes on. The receiver is a living
  person: never mourning, never decline, never a verdict on who they are.
- Do not mention AI, this process, or the word "候補". Do not explain stroke
  origins or etymology unless it directly deepens THIS story's truth.
- Plain output: the paragraph text only. No JSON, no quotes around the whole,
  no preamble.

STORY:
{{ STORY }}

CHOSEN CANDIDATE:
kanji: {{ KANJI }}
reading: {{ READING }}
one_line_gaze: {{ GAZE }}
story_anchor: {{ ANCHOR }}
