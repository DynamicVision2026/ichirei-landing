// Imported FIRST by scripts/test-reveal.ts: ES imports are hoisted, so a plain `process.env.ICHIREI_RATES = 'off'` line in the test file would run AFTER engine/rates.ts built its shared cache (with the real
// rate sources). Evaluated before the other imports, this keeps the shared cache from ever reaching the network.
process.env.ICHIREI_RATES = 'off'
export {}
