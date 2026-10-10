import { Footer } from '@/components/Footer';
import { Hero } from '@/components/Hero';
import { Nav } from '@/components/Nav';
import { ClosingCta, Developers, HowItWorks, Pricing, Proof, Roadmap, Team, WhoFor, WhyNow } from '@/components/Sections';

export default function Home() {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <WhyNow />
        <HowItWorks />
        <WhoFor />
        <Developers />
        <Proof />
        <Pricing />
        <Roadmap />
        <Team />
        <ClosingCta />
      </main>
      <Footer />
    </>
  );
}
