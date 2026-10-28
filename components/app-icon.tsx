/**
 * Application icons for the launcher, taken from each application's original
 * branding: the SAP logo from the supplied SAP.html (modules/sap-erp/source),
 * the HR application's "d" mark, the Zoho CRM product mark and the Amazon
 * brand colours of the S/4HANA application (their sources under modules/*).
 * Unknown applications get a neutral glyph.
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

// The Zoho CRM product mark (LOGO_SVG in modules/zoho-crm/source).
function CrmLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false" className="app-icon">
      <defs>
        <linearGradient id="crm-logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7584ff" />
          <stop offset=".55" stopColor="#4d5ff0" />
          <stop offset="1" stopColor="#3a46d6" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="url(#crm-logo-gradient)" />
      <rect x="7.5" y="12.5" width="16" height="15" rx="7.5" fill="none" stroke="#fff" strokeWidth="3" />
      <rect x="16.5" y="12.5" width="16" height="15" rx="7.5" fill="none" stroke="#fff" strokeWidth="3" opacity=".92" />
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
  // The S/4HANA application's "amazon" badge: white on #232f3e with an orange rule.
  'amazon-s4hana': (
    <>
      <text x="16" y="20" textAnchor="middle" fontFamily="Arial,sans-serif" fontWeight="800" fontSize="17" fill="#fff">
        a
      </text>
      <rect x="8" y="23" width="16" height="2.5" rx="1.25" fill="#ff9900" />
    </>
  ),
};

const BACKGROUNDS: Record<string, string> = { 'hr-remedy-hrms': '#0b4fcf', 'amazon-s4hana': '#232f3e' };

export function AppIcon({ slug, size = 40 }: { slug: string; size?: number }) {
  if (slug === 'sap-erp') return <SapLogo size={size} />;
  if (slug === 'zoho-crm') return <CrmLogo size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="app-icon">
      <rect width="32" height="32" rx="8" fill={BACKGROUNDS[slug] ?? '#334155'} />
      {GLYPHS[slug] ?? <rect x="10" y="10" width="12" height="12" rx="2" fill="#fff" />}
    </svg>
  );
}
