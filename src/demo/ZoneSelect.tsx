import { useMemo, useState } from 'react'
import { ZONE_CHOICES, browserZone, isValidZone, zoneName, type OpensLang } from '../order/opens-at.ts'

// The time zone the opening time (7:00 a.m.) is read in (2026-11-14): US Eastern / Central / Mountain / Pacific, UK, Japan, Taipei, the visitor's own zone, or any other IANA name typed in.
// `tz` is '' while a typed name is not a valid zone (the parent then keeps the order from being sent).

export default function ZoneSelect({ tz, onTz, lang, label, otherLabel, otherPlaceholder, id }: { tz: string; onTz: (tz: string) => void; lang: OpensLang; label: string; otherLabel: string; otherPlaceholder: string; id: string }) {
  const browser = useMemo(browserZone, [])
  const inList = ZONE_CHOICES.some((z) => z.id === tz)
  const [other, setOther] = useState(false)
  const [text, setText] = useState('')
  const extra = !ZONE_CHOICES.some((z) => z.id === browser) ? browser : null
  const value = other ? '__other' : inList || tz === extra ? tz : '__other'
  return (
    <div className="zoneField" data-testid={`${id}-wrap`}>
      <label className="clab" htmlFor={id}>{label}</label>
      <select
        id={id}
        data-testid={id}
        value={value}
        onChange={(e) => {
          if (e.target.value === '__other') {
            setOther(true)
            onTz(isValidZone(text.trim()) ? text.trim() : '')
          } else {
            setOther(false)
            onTz(e.target.value)
          }
        }}
      >
        {ZONE_CHOICES.map((z) => <option key={z.id} value={z.id}>{zoneName(lang, z.id)}</option>)}
        {extra && <option value={extra}>{zoneName(lang, extra)}</option>}
        <option value="__other">{otherLabel}</option>
      </select>
      {value === '__other' && (
        <input type="text" data-testid={`${id}-other`} value={text} placeholder={otherPlaceholder} maxLength={60} onChange={(e) => { setText(e.target.value); onTz(isValidZone(e.target.value.trim()) ? e.target.value.trim() : '') }} />
      )}
    </div>
  )
}
