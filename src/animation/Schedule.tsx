import { useState } from 'react'
import { trackUs } from '../demo/analytics.ts'
import ZoneSelect from '../demo/ZoneSelect.tsx'
import { SIZE_COPY } from '../demo/sizes-copy.ts'
import { browserZone, isValidZone, openingLabel, openingLabelFromRecord, todayIn } from '../order/opens-at.ts'

// "Schedule for a date" in the English share sheet (2026-11-12): the buyer sets the day the receiver's envelope opens (the existing opening-date feature), after paying and collecting. The hint is the Christmas one.

export const SCHEDULE_HINT = 'Set it to open on Christmas morning.'

const dayText = (d: string): string => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
}

export default function Schedule({ animationId, opensOn, opensAt, opensTz }: { animationId: string; opensOn: string | null; opensAt?: string | null; opensTz?: string | null }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(opensOn ?? '')
  const [saved, setSaved] = useState<string | null>(opensOn)
  const [savedLabel, setSavedLabel] = useState<string | null>(() => openingLabelFromRecord('en', opensAt, opensTz))
  const [tz, setTz] = useState(opensTz && isValidZone(opensTz) ? opensTz : browserZone)
  const [phase, setPhase] = useState<'idle' | 'saving' | 'error'>('idle')
  const sc = SIZE_COPY.en
  const today = isValidZone(tz) ? todayIn(tz, new Date()) : new Date().toISOString().slice(0, 10)
  const save = async (value: string) => {
    setPhase('saving')
    try {
      const res = await fetch(`/api/animation/${animationId}/schedule`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ open_date: value || null, ...(value ? { open_tz: tz } : {}) }) })
      if (!res.ok) throw new Error('failed')
      const j = (await res.json()) as { opens_on: string | null; opens_at?: string | null; opens_tz?: string | null }
      setSaved(j.opens_on)
      setSavedLabel(openingLabelFromRecord('en', j.opens_at, j.opens_tz))
      setPhase('idle')
      if (j.opens_on) trackUs('egift_scheduled')
    } catch {
      setPhase('error')
    }
  }
  return (
    <div className="by-schedule" data-testid="schedule">
      <button type="button" className="an-btn" data-testid="give-schedule" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Schedule for a date</button>
      {saved && <p className="an-small" data-testid="schedule-saved">{savedLabel ? `Scheduled. ${savedLabel}.` : `Scheduled: it opens on ${dayText(saved)}.`}</p>}
      {open && (
        <div className="by-schedule-form">
          <p className="an-small" data-testid="schedule-hint">{SCHEDULE_HINT}</p>
          <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} data-testid="schedule-date" aria-label="Opening date" />
          <ZoneSelect id="schedule-zone" tz={tz} onTz={setTz} lang="en" label={sc.openZoneLabel} otherLabel={sc.openZoneOther} otherPlaceholder={sc.openZoneOtherPlaceholder} />
          {date && isValidZone(tz) && <p className="an-small" data-testid="schedule-label">{openingLabel('en', date, tz)}</p>}
          <button type="button" className="an-btn an-btn-hot" data-testid="schedule-save" disabled={!date || !isValidZone(tz) || phase === 'saving'} onClick={() => void save(date)}>{phase === 'saving' ? 'Saving…' : 'Set the date'}</button>
          {saved && <button type="button" className="an-btn" data-testid="schedule-clear" disabled={phase === 'saving'} onClick={() => { setDate(''); void save('') }}>Open at once</button>}
          {phase === 'error' && <p role="alert" className="an-small">It could not be saved. Please try again.</p>}
        </div>
      )}
    </div>
  )
}
