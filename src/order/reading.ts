// A character's reading as it is SHOWN: dictionaries mark the okurigana boundary inside a kun reading ("した-う", "した.う"); a card, a preview, the gift page,
// a PDF or a certificate shows the plain reading ("したう"). Applied where a reading is written down (the engine) and again where it is shown.

/** Remove the dictionary markers: ASCII hyphen and full stop, and their look-alikes (U+2010, U+2011, U+FF0D fullwidth hyphen-minus, U+FF0E fullwidth full stop). */
export const cleanReading = (reading: string): string => reading.replace(/[-.‐‑－．]/g, '')
