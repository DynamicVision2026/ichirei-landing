// The certificate number 「一字礼　第 NNNN 号」: one running number across ALL orders, from 0001, given once and never reused.
//
// Each number is a small private object ops/certno/NNNN.json written with "only if absent" (Cloud Storage: ifGenerationMatch=0), so two orders made at
// the same moment can never get the same number: the loser of the write simply tries the next one. `ops/certno/last.json` is only a hint of where to start
// (it may lag behind; the scan then walks forward over the numbers already taken). The number is kept on the order record and on the gift record;
// it is asked for once, when the order is made.

import type { OrderStore } from './order-store.ts'

const pad = (n: number) => String(n).padStart(4, '0')
const MAX_STEPS = 2000

export const formatCertificateNo = (n: number): string => pad(n)

async function readHint(store: OrderStore): Promise<number> {
  try {
    const b = await store.getObject('ops/certno/last.json')
    const n = b ? Number((JSON.parse(b.toString('utf8')) as { n?: unknown }).n) : 0
    return Number.isInteger(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/** The next free number for this order (a number already written for this very order is returned again). Throws only when the store itself fails. */
export async function allocateCertificateNo(store: OrderStore, orderRef: string, now: Date = new Date()): Promise<number> {
  let n = (await readHint(store)) + 1
  for (let step = 0; step < MAX_STEPS; step++, n++) {
    const path = `ops/certno/${pad(n)}.json`
    const mine = JSON.stringify({ n, order_ref: orderRef, at: now.toISOString() })
    if (await store.putObject(path, mine, 'application/json', { ifAbsent: true })) {
      await store.putObject('ops/certno/last.json', JSON.stringify({ n }), 'application/json').catch(() => false)
      return n
    }
    try {
      const b = await store.getObject(path)
      if (b && (JSON.parse(b.toString('utf8')) as { order_ref?: unknown }).order_ref === orderRef) return n
    } catch {
      /* an unreadable number is simply taken */
    }
  }
  throw new Error('certificate numbers: no free number found')
}
