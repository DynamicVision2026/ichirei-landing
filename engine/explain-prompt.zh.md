ICHIREI — Stage-B Deep Explanation Prompt (v5, Chinese / zh; Condition B/C, on-demand)

You already selected a character for a gift through the selection process. A candidate
has now EARNED a deeper explanation — it proved itself on one sentence alone. Your job
here is to deepen recognition, not to rescue the character.

You are given the sender's original story, the chosen candidate (its character, pinyin,
one-line gaze, and story anchor) and the gift's context. Write the deeper explanation a
sender would read directly beneath the card.

CONTEXT (supplied by the harness — take it as given; the codes mean what they mean in the
selection process)
language: {{ LANGUAGE }}
display_script: {{ DISPLAY_SCRIPT }}
relationship: {{ RELATIONSHIP }}
direction: {{ DIRECTION }}
occasion: {{ OCCASION }}
occasion_detail: {{ OCCASION_DETAIL }}

`display_script` is the script of everything you write: `simplified` = 简体中文,
`traditional` = 繁體中文. If a value is `unspecified`, do not guess it. `occasion_detail`
is optional free text from the sender (for example an age or an anniversary); use it only
if it is given.

Rules:
- Chinese only, in the display_script. 120–220 characters. One flowing paragraph, no
  headings, no lists. When you name the chosen character, write it in the display_script's
  form: use SIMPLIFIED_FORM when display_script is simplified and TRADITIONAL_FORM when it
  is traditional (below).
- The SENDER remains the grammatical subject: this is how the sender sees the
  receiver, never a message aimed at the receiver, never flattery.
- Ground every claim in the story's concrete particulars — quote or closely
  paraphrase at least one fragment (quote it exactly as the sender wrote it; do not
  convert it between simplified and traditional). Do not invent events, objects, places
  or times that are not in the story.
- Fit the register to `direction` (up = respectful and warm, never stiff; down = tender,
  never condescending; across = plain and equal).
- Do not assume any particular occasion, age or milestone: say only what the context
  and the story support. Close by opening gently toward what comes next, in a tone that
  suits the occasion — gratitude and a life that goes on. The receiver is a living
  person: never mourning, never decline, never a verdict on who they are. Avoid any
  unlucky Mandarin homophone or idiom (death, ending, parting, severing).
- Do not mention AI, this process, or the word "候选"/"候選". Do not explain stroke
  origins or etymology unless it directly deepens THIS story's truth.
- Plain output: the paragraph text only. No JSON, no quotes around the whole,
  no preamble.

STORY:
{{ STORY }}

CHOSEN CANDIDATE:
SIMPLIFIED_FORM: {{ KANJI }}
TRADITIONAL_FORM: {{ INSCRIPTION_FORM }}
pinyin: {{ READING }}
one_line_gaze: {{ GAZE }}
story_anchor: {{ ANCHOR }}
