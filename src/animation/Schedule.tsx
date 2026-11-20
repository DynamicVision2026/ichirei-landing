import { useMemo, useState } from 'react'
import { trackUs } from '../demo/analytics.ts'
import ZoneSelect from '../demo/ZoneSelect.tsx'
import { SIZE_COPY } from '../demo/sizes-copy.ts'
import { availableChoices, christmasTarget, pickTarget, thanksgivingTarget, CHOICE_COPY, type ChoiceId } from '../order/opening-choices.ts'
import { isValidZone, marketZone, openingLabelAt, openingLabelFromRecord, todayIn } from '../order/opens-at.ts'
import { CAL_BUTTON, googleCalendarUrl, icsText, type CalendarEvent } from '../order/calendar.ts'
import { CEREMONY_COPY } from './ceremony-copy.ts'
import type { PageLang } from './copy.ts'

// "When it opens" (2026-11-14, gift ceremony part 2) and "Add to calendar" (part 3), on the sender's page after the gift is collected. Four choices — now · Christmas morning (only Dec 1–24) · Thanksgiving dinner (English only,
// only until it has passed) · pick a date and time — read in the zone where the receiver will open it (the browser's by default). The moment is stored as a UTC instant with the zone, as for A8. Nothing is sent by us:
// the calendar event carries the receiver's link and the sender's own page, and the sender can check there.

/** The sender's page on the host the server named for the receiver's link (both come from publicUrl()), never the host this page happens to be open on. */
const sameHostAs = (url: string, path: string): string => {
  try {
    return `${new URL(url).origin}${path}`
  } catch {
    return ''
  }
}

export default function Schedule({ animationId, lang, quiet, to, giftUrl, senderUrl, opensOn, opensAt, opensTz }: { animationId: string; lang: PageLang; quiet: boolean; to: string; giftUrl: string; /** the sender's own page, as the server built it (publicUrl()) */ senderUrl?: string; opensOn: string | null; opensAt?: string | null; opensTz?: string | null }) {
  const c = CEREMONY_COPY[lang]
  const cc = CHOICE_COPY[lang]
  const cal = CAL_BUTTON[lang]
  const sc = SIZE_COPY[lang]
  const [open, setOpen] = useState(false)
  const [tz, setTz] = useState(opensTz && isValidZone(opensTz) ? opensTz : marketZone(lang))
  const [choice, setChoice] = useState<ChoiceId>('now')
  const [date, setDate] = useState(opensOn ?? '')
  const [time, setTime] = useState('07:00')
  const [saved, setSaved] = useState<{ at: string; tz: string } | null>(opensAt && opensTz ? { at: opensAt, tz: opensTz } : null)
  const [phase, setPhase] = useState<'idle' | 'saving' | 'error'>('idle')
  const [calOpen, setCalOpen] = useState(false)
  const now = useMemo(() => new Date(), [])
  const zone = isValidZone(tz) ? tz : marketZone(lang)
  const choices = availableChoices(now, zone, lang === 'zh-Hant' ? 'zh-Hant' : lang, quiet)
  const target =
    choice === 'christmas' ? christmasTarget(now, zone) : choice === 'thanksgiving' ? thanksgivingTarget(now, zone) : choice === 'pick' && date ? pickTarget(date, time, zone) : null
  const today = todayIn(zone, now)
  const savedLabel = saved ? openingLabelFromRecord(lang, saved.at, saved.tz) : null

  const save = async (value: { date: string; time?: string } | null) => {
    setPhase('saving')
    try {
      const res = await fetch(`/api/animation/${animationId}/schedule`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value ? { open_date: value.date, open_tz: zone, ...(value.time ? { open_time: value.time } : {}) } : { open_date: null }) })
      if (!res.ok) throw new Error('failed')
      const j = (await res.json()) as { opens_on: string | null; opens_at?: string | null; opens_tz?: string | null }
      setSaved(j.opens_at && j.opens_tz ? { at: j.opens_at, tz: j.opens_tz } : null)
      setPhase('idle')
      if (j.opens_on) trackUs('egift_scheduled')
    } catch {
      setPhase('error')
    }
  }
  const go = () => {
    if (choice === 'now') return void save(null)
    if (!target) return
    void save({ date: target.date, time: `${String(target.hour).padStart(2, '0')}:${String(target.minute).padStart(2, '0')}` })
  }
  const event: CalendarEvent | null = saved ? { lang, to, start: saved.at, giftUrl, senderUrl: senderUrl || sameHostAs(giftUrl, `/a/${animationId}`) } : null
  const google = event ? googleCalendarUrl(event) : null
  const downloadIcs = () => {
    if (!event) return
    const text = icsText(event, animationId)
    if (!text) return
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'ichirei.ics'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1500)
  }
  const label = (id: ChoiceId) => (id === 'now' ? cc.now : id === 'christmas' ? cc.christmas : id === 'thanksgiving' ? cc.thanksgiving : cc.pick)
  return (
    <div className="by-schedule" data-testid="schedule">
      <button type="button" className="an-btn" data-testid="give-schedule" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{c.toggle}</button>
      {saved && <p className="an-small" data-testid="schedule-saved">{savedLabel ? c.saved(savedLabel) : ''}</p>}
      {open && (
        <div className="by-schedule-form">
          <p className="an-small" data-testid="schedule-title">{c.whenTitle}</p>
          <div className="by-choice" role="radiogroup" aria-label={c.whenTitle}>
            {choices.map((id) => (
              <label key={id}><input type="radio" name="open_choice" value={id} checked={choice === id} onChange={() => setChoice(id)} data-testid={`choice-${id}`} /> <span>{label(id)}</span></label>
            ))}
          </div>
          {choice !== 'now' && <ZoneSelect id="schedule-zone" tz={tz} onTz={setTz} lang={lang} label={cc.zone} otherLabel={sc.openZoneOther} otherPlaceholder={sc.openZoneOtherPlaceholder} />}
          {choice === 'pick' && (
            <p className="by-pick">
              <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} data-testid="schedule-date" aria-label={c.dateLabel} />{' '}
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="schedule-time" aria-label={c.timeLabel} />
            </p>
          )}
          {target && isValidZone(zone) && <p className="an-small" data-testid="schedule-label">{openingLabelAt(lang, target.date, target.hour, target.minute, zone)}</p>}
          <button type="button" className="an-btn an-btn-hot" data-testid="schedule-save" disabled={phase === 'saving' || (choice !== 'now' && !target) || !isValidZone(tz)} onClick={go}>{phase === 'saving' ? c.saving : c.set}</button>
          {saved && <button type="button" className="an-btn" data-testid="schedule-clear" disabled={phase === 'saving'} onClick={() => { setChoice('now'); void save(null) }}>{c.clear}</button>}
          {phase === 'error' && <p role="alert" className="an-small">{c.error}</p>}
        </div>
      )}
      {event && (
        <div className="by-calendar-wrap" data-testid="calendar">
          <button type="button" className="an-btn" data-testid="calendar-add" aria-expanded={calOpen} onClick={() => setCalOpen((v) => !v)}>{cal.add}</button>
          {calOpen && (
            <p className="by-calendar">
              {google && <a className="an-btn" data-testid="calendar-google" href={google} target="_blank" rel="noopener noreferrer">{cal.google}</a>}
              <button type="button" className="an-btn" data-testid="calendar-ics" onClick={downloadIcs}>{cal.ics}</button>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
