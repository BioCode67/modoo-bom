import { Hero } from './Hero'
import { HowItWorks } from './HowItWorks'
import { Features } from './Features'
import { Faq } from './Faq'
import { Footer } from './Footer'

export function Home() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Features />
      <Faq />
      <Footer />
    </>
  )
}
