export default function Loading() {
  return (
    <div className="stack" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="skeleton" style={{ height: 32, width: 220 }} />
      <div className="stats">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 84 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 260 }} />
    </div>
  );
}
