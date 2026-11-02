import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { Nav } from '@/components/Nav';
import { StartFlow } from '@/components/StartFlow';

export const metadata: Metadata = {
  title: 'Become a user · Atlas Rail',
  description: 'Tell us what your agents do. See what Atlas Rail does for them today, and join.',
  alternates: { canonical: '/start' },
};

export default function Start() {
  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-3xl px-5 pb-24 pt-28 sm:px-8 sm:pt-36">
        <p className="eyebrow">Become a user</p>
        <h1 className="mt-4 text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:text-[52px]">What do your AI agents do?</h1>
        <p className="mt-4 text-[17px] text-muted">Pick one or more.</p>
        <div className="mt-10">
          <StartFlow />
        </div>
      </main>
      <Footer />
    </>
  );
}
