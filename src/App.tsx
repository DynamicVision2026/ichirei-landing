import { useCallback, useRef } from 'react'
import NavBar from './components/NavBar'
import Hero from './components/Hero'
import MarqueeStrip from './components/MarqueeStrip'
import EmotionalResonance from './components/EmotionalResonance'
import ProcessDeclaration from './components/ProcessDeclaration'
import StoryInput from './components/StoryInput'
import AIProcessing from './components/AIProcessing'
import CandidateShowcase from './components/CandidateShowcase'
import ConfirmationCeremony from './components/ConfirmationCeremony'

const PROCESSING_MS = 3000

function App() {
  const advanceTimer = useRef<number | null>(null)

  const handleStorySubmit = useCallback(() => {
    document
      .getElementById('ai-processing')
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
      <AIProcessing />
      <CandidateShowcase />
      <ConfirmationCeremony />
    </div>
  )
}

export default App
