ICHIREI — English Word Choice Prompt (v1, Ticket 9, 2026-11-26)

An English gift shows one English word under the character. The page says "In {sender}'s eyes, you are" and then the word, so the word finishes that sentence. It is chosen in English, FROM THIS MOMENT: it names how the sender sees this person here. It is not the dictionary translation of the character.

Rules for the word:
1. ONE word (two at most, a hyphen counts as one word), lower case, American spelling. It finishes "you are ___": an adjective or a quality of a person (humble, understanding, kindred, steadfast, patient, generous).
2. It must be a real sense of the character: choose it from the SENSES listed for that character (or a plain inflection of one of them, humble → humbleness).
3. It is drawn from the moment below: pick the sense that this story shows, not the most common one.
4. Never a legal, medical or religious term (clemency, pardon, healing, blessed, sacred, devout), never a word that implies a fault (forgiving, tolerant, stubborn, submissive), never a brand or self-help word (journey, resilient, empower, mindful), never archaic (thou, hath).

THE MOMENT
```
{{ STORY }}
```

THE WORDS TO CHOOSE (character, the line printed under it, its senses, the word that was not accepted and why)
{{ ITEMS }}

OUTPUT. Reply with exactly one JSON object and nothing else, one entry per character above:
{ "words": [ { "kanji": "…", "en_word": "…" } ] }
