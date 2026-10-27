/**
 * Neutral application-launcher mark: a generic 2×2 grid, not a company logo.
 * Also used for the favicon (scripts/generate-icons.mjs).
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="#334155" />
      <rect x="8" y="8" width="7" height="7" rx="1.5" fill="#fff" />
      <rect x="17" y="8" width="7" height="7" rx="1.5" fill="#fff" />
      <rect x="8" y="17" width="7" height="7" rx="1.5" fill="#fff" />
      <rect x="17" y="17" width="7" height="7" rx="1.5" fill="#fff" />
    </svg>
  );
}

export function Brand({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  return (
    <span className={`brand ${tone === 'light' ? 'brand-light' : ''}`}>
      <BrandMark /> Applications
    </span>
  );
}
