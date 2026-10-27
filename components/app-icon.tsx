/**
 * Application icons for the launcher, taken from each application's original
 * branding: the SAP logo from the supplied SAP.html (modules/sap-erp/source)
 * and the HR application's "d" mark. Unknown applications get a neutral glyph.
 */
function SapLogo({ size }: { size: number }) {
  return (
    // Decorative here: the card heading next to it already names the application.
    <svg height={size} viewBox="0 0 96 48" aria-hidden="true" focusable="false" className="app-icon app-logo">
      <defs>
        <linearGradient id="sap-logo-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#00b8f1" />
          <stop offset="1" stopColor="#1e5fb4" />
        </linearGradient>
      </defs>
      <path d="M0 0H96L48 48H0Z" fill="url(#sap-logo-gradient)" />
      <text x="6" y="35" fontFamily="Arial Black,Arial,sans-serif" fontWeight="900" fontSize="31" fill="#fff" textLength="62">
        SAP
      </text>
    </svg>
  );
}

const GLYPHS: Record<string, React.ReactNode> = {
  // The HR application's own "d" mark (modules/hr-remedy-hrms).
  'hr-remedy-hrms': (
    <text x="16" y="23" textAnchor="middle" fontFamily="Arial,sans-serif" fontWeight="800" fontSize="20" fill="#fff">
      d
    </text>
  ),
};

export function AppIcon({ slug, size = 40 }: { slug: string; size?: number }) {
  if (slug === 'sap-erp') return <SapLogo size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="app-icon">
      <rect width="32" height="32" rx="8" fill={slug === 'hr-remedy-hrms' ? '#0b4fcf' : '#334155'} />
      {GLYPHS[slug] ?? <rect x="10" y="10" width="12" height="12" rx="2" fill="#fff" />}
    </svg>
  );
}
