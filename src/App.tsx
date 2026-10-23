import { useCallback, useEffect, useRef } from 'react'
import NavBar from './components/NavBar'
import Hero from './components/Hero'
import MarqueeStrip from './components/MarqueeStrip'
import EmotionalResonance from './components/EmotionalResonance'
import ProcessDeclaration from './components/ProcessDeclaration'
import StoryInput from './components/StoryInput'
import Processing from './components/Processing'
import CandidateShowcase from './components/CandidateShowcase'
import ConfirmationCeremony from './components/ConfirmationCeremony'
import { useLanding } from './landing/useLanding'

const PROCESSING_MS = 3000

function App() {
  const advanceTimer = useRef<number | null>(null)
  const { copy, language } = useLanding()

  // Keep the tab title and meta description in the sender's language.
  useEffect(() => {
    document.title = copy.documentTitle
    document.querySelector('meta[name=description]')?.setAttribute('content', copy.documentDescription)
    document.documentElement.lang = language
  }, [copy, language])

  const handleStorySubmit = useCallback(() => {
    document
      .getElementById('processing')
      ?.scrollIntoView({ behavior: 'smooth' })
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current)
    advanceTimer.current = window.setTimeout(() => {
      document
        .getElementById('candidate-showcase')
        ?.scrollIntoView({ behavior: 'smooth' })
    }, PROCESSING_MS)
  }, [])

  return (
    <div className="bg-ink">
      <NavBar />
      <Hero />
      <MarqueeStrip />
      <EmotionalResonance />
      <ProcessDeclaration />
      <StoryInput onSubmit={handleStorySubmit} />
      <Processing />
      <CandidateShowcase />
      <ConfirmationCeremony />
    </div>
  )
}

export default App
