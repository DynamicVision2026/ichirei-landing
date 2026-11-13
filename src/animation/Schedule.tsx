import { useState } from 'react'
import { trackUs } from '../demo/analytics.ts'

// "Schedule for a date" in the English share sheet (2026-11-12): the buyer sets the day the receiver's envelope opens (the existing opening-date feature), after paying and collecting. The hint is the Christmas one.

export const SCHEDULE_HINT = 'Set it to open on Christmas morning.'

const dayText = (d: string): string => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
}

export default function Schedule({ animationId, opensOn }: { animationId: string; opensOn: string | null }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(opensOn ?? '')
  const [saved, setSaved] = useState<string | null>(opensOn)
  const [phase, setPhase] = useState<'idle' | 'saving' | 'error'>('idle')
  const today = new Date().toISOString().slice(0, 10)
  const save = async (value: string) => {
    setPhase('saving')
    try {
      const res = await fetch(`/api/animation/${animationId}/schedule`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ open_date: value || null }) })
      if (!res.ok) throw new Error('failed')
      const j = (await res.json()) as { opens_on: string | null }
      setSaved(j.opens_on)
      setPhase('idle')
      if (j.opens_on) trackUs('egift_scheduled')
    } catch {
      setPhase('error')
    }
  }
  return (
    <div className="by-schedule" data-testid="schedule">
      <button type="button" className="an-btn" data-testid="give-schedule" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Schedule for a date</button>
      {saved && <p className="an-small" data-testid="schedule-saved">Scheduled: it opens on {dayText(saved)}.</p>}
      {open && (
        <div className="by-schedule-form">
          <p className="an-small" data-testid="schedule-hint">{SCHEDULE_HINT}</p>
          <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} data-testid="schedule-date" aria-label="Opening date" />
          <button type="button" className="an-btn an-btn-hot" data-testid="schedule-save" disabled={!date || phase === 'saving'} onClick={() => void save(date)}>{phase === 'saving' ? 'Saving…' : 'Set the date'}</button>
          {saved && <button type="button" className="an-btn" data-testid="schedule-clear" disabled={phase === 'saving'} onClick={() => { setDate(''); void save('') }}>Open at once</button>}
          {phase === 'error' && <p role="alert" className="an-small">It could not be saved. Please try again.</p>}
        </div>
      )}
    </div>
  )
}
