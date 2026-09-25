import type { ReactNode } from "react";

const LINKS = {
  landing: [["/#how", "How it works"], ["/#recurring", "Recurring"], ["/#agents", "For agents"], ["/#proof", "Onchain proof"]],
  app: [["/", "Home"], ["/app#send", "Send"], ["/app#open", "Open a gift"]],
} as const;

export function SiteHeader({ children, variant = "landing" }: { children?: ReactNode; variant?: keyof typeof LINKS }) {
  return (
    <header className="site-header">
      <a className="wordmark" href="/" aria-label="Convey home">
        <span className="wordmark-mark" aria-hidden="true" />
        convey<span className="wordmark-dot">.</span>
      </a>
      <nav className="site-links" aria-label="Sections">
        {LINKS[variant].map(([href, label]) => <a key={href} href={href}>{label}</a>)}
      </nav>
      <div className="site-actions">{children}</div>
    </header>
  );
}
