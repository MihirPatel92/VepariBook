// Logo — Vrunda Infotech mark. Inlined SVG matches public/favicon.svg so offline/first-paint renders work.
interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Vrunda Infotech"
      role="img"
    >
      <defs>
        <linearGradient id="vi-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1e3a8a" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id="vi-cyan" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0284c7" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#vi-bg)" />
      <path d="M7.5 8.5 L16 23.5" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M16 23.5 L24.5 8.5" stroke="url(#vi-cyan)" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="24.5" cy="8.5" r="2" fill="#e0f2fe" />
    </svg>
  );
}
