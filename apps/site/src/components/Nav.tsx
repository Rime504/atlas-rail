'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Wordmark } from './Logo';
import { GITHUB, PLAYGROUND } from '@/content';

const LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#developers', label: 'Developers' },
  { href: '#proof', label: 'Proof' },
  { href: '#pricing', label: 'Pricing' },
  { href: GITHUB, label: 'Docs', external: true },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${
        scrolled || open ? 'border-line bg-ink/80 backdrop-blur-xl' : 'border-transparent bg-transparent'
      }`}
    >
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-page items-center justify-between px-5 sm:px-8">
        <a href="#top" aria-label="Atlas Rail, back to top" className="rounded-md">
          <Wordmark />
        </a>

        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.label}>
              <a
                href={l.href}
                {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-[14px] text-muted transition-colors hover:text-white"
              >
                {l.label}
                {l.external && <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <a href={PLAYGROUND} target="_blank" rel="noreferrer" className="btn-primary hidden h-9 px-4 text-[14px] sm:inline-flex">
            Try it live
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white md:hidden"
          >
            {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      {open && (
        <div id="mobile-menu" className="border-t border-line px-5 pb-6 pt-2 md:hidden">
          <ul className="flex flex-col">
            {LINKS.map((l) => (
              <li key={l.label}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                  className="flex items-center justify-between border-b border-line py-4 text-[17px] text-white"
                >
                  {l.label}
                  {l.external && <ArrowUpRight className="h-4 w-4 text-muted" aria-hidden="true" />}
                </a>
              </li>
            ))}
          </ul>
          <a href={PLAYGROUND} target="_blank" rel="noreferrer" className="btn-primary mt-6 w-full">
            Try it live
          </a>
        </div>
      )}
    </header>
  );
}
