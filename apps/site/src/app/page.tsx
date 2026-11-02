import { Footer } from '@/components/Footer';
import { Hero } from '@/components/Hero';
import { Nav } from '@/components/Nav';
import { ClosingCta, Developers, HowItWorks, Pricing, Proof, ShippingNext, Team, UseCases, WhoFor, WhyNow } from '@/components/Sections';

export default function Home() {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <WhyNow />
        <HowItWorks />
        <UseCases />
        <WhoFor />
        <Developers />
        <Proof />
        <Pricing />
        <ShippingNext />
        <Team />
        <ClosingCta />
      </main>
      <Footer />
    </>
  );
}
