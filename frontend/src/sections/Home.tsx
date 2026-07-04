import { Hero } from './Hero'
import { HowItWorks } from './HowItWorks'
import { Features } from './Features'
import { Faq } from './Faq'
import { Footer } from './Footer'
import { EmergencyHelp } from '@/components/EmergencyHelp'
import { RpaShowcase } from '@/components/RpaShowcase'

export function Home() {
  return (
    <>
      <Hero />
      <EmergencyHelp />
      <HowItWorks />
      <Features />
      <RpaShowcase />
      <Faq />
      <Footer />
    </>
  )
}
