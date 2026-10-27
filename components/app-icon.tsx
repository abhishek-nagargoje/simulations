/**
 * Neutral application icons. These are generic glyphs, not vendor logos: no
 * approved SAP or Zoho logo assets have been supplied. To use an approved
 * original asset, place it in /public and render it here for that slug.
 */
const GLYPHS: Record<string, React.ReactNode> = {
  // Ledger: rows of a document table.
  'sap-erp': <path d="M10 11h12M10 16h12M10 21h8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />,
  // Person.
  'hr-remedy-hrms': (
    <>
      <circle cx="16" cy="12.5" r="3.6" fill="#fff" />
      <path d="M9.5 23c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none" />
    </>
  ),
};

export function AppIcon({ slug, size = 40 }: { slug: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="app-icon">
      <rect width="32" height="32" rx="8" fill="#334155" />
      {GLYPHS[slug] ?? <rect x="10" y="10" width="12" height="12" rx="2" fill="#fff" />}
    </svg>
  );
}
