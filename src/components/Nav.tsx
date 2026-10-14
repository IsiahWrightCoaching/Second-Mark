'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/today', label: 'Today', icon: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2" /></> },
  { href: '/log', label: 'Log', icon: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M12 8v8M8 12h8" /></> },
  { href: '/review', label: 'Review', icon: <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></> },
  { href: '/stats', label: 'Stats', icon: <><path d="M4 19h16" /><path d="M5 15l4-4 4 3 6-7" /></> },
  { href: '/strategy', label: 'Strategy', icon: <><path d="M6 4h9l3 3v13H6z" /><path d="M9 11h6M9 15h6M9 7h3" /></> },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main">
      <div className="in">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="tab" aria-current={path.startsWith(t.href) ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{t.icon}</svg>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
