import { useEffect } from 'react'
import NavBar from './components/NavBar'
import Hero from './components/Hero'
import MarqueeStrip from './components/MarqueeStrip'
import EmotionalResonance from './components/EmotionalResonance'
import ProcessDeclaration from './components/ProcessDeclaration'
import DemoApp from './demo/DemoApp'
import { useLanding } from './landing/useLanding'

/**
 * The customer site: the landing story (hero, marquee, emotional lines, process) followed by the
 * real flow — write, choose a character, order — which is the /demo engine without the test
 * controls (DemoApp in "customer" mode). /demo remains the internal harness.
 */
function App() {
  const { copy, language } = useLanding()

  // Keep the tab title and meta description in the sender's language.
  useEffect(() => {
    document.title = copy.documentTitle
    document.querySelector('meta[name=description]')?.setAttribute('content', copy.documentDescription)
    document.documentElement.lang = language
  }, [copy, language])

  return (
    <div className="bg-ink">
      <NavBar />
      <Hero />
      <MarqueeStrip />
      <EmotionalResonance />
      <ProcessDeclaration />
      <DemoApp mode="customer" />
    </div>
  )
}

export default App
