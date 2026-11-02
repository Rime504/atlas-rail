'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Wordmark } from './Logo';
import { GITHUB, PLAYGROUND, START } from '@/content';

// Absolute paths, so the links also work from /start.
const LINKS = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#use-cases', label: 'Use cases' },
  { href: '/#developers', label: 'Developers' },
  { href: '/#proof', label: 'Proof' },
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
        <Link href="/" aria-label="Atlas Rail, home" className="rounded-md">
          <Wordmark />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.label}>
              {l.external ? (
                <a href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-[14px] text-muted transition-colors hover:text-white">
                  {l.label}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : (
                <Link href={l.href} className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-[14px] text-muted transition-colors hover:text-white">
                  {l.label}
                </Link>
              )}
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <Link href={START} className="btn-accent h-9 px-4 text-[14px]">
            Become a user
          </Link>
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
                {l.external ? (
                  <a href={l.href} onClick={() => setOpen(false)} target="_blank" rel="noreferrer" className="flex items-center justify-between border-b border-line py-4 text-[17px] text-white">
                    {l.label}
                    <ArrowUpRight className="h-4 w-4 text-muted" aria-hidden="true" />
                  </a>
                ) : (
                  <Link href={l.href} onClick={() => setOpen(false)} className="flex items-center justify-between border-b border-line py-4 text-[17px] text-white">
                    {l.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <Link href={START} onClick={() => setOpen(false)} className="btn-accent mt-6 w-full">
            Become a user
          </Link>
          <a href={PLAYGROUND} target="_blank" rel="noreferrer" className="btn-secondary mt-3 w-full">
            Try it live
          </a>
        </div>
      )}
    </header>
  );
}
