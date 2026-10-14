/** Lock-up A: the two marks beside the name, tagline below. */
export function Brand() {
  return (
    <div className="lock" aria-label="Second Mark, the other side of the trade">
      <svg width="22" height="28" viewBox="0 0 34 44" aria-hidden="true">
        <rect x="0" y="0" width="12" height="44" rx="3" fill="currentColor" />
        <rect x="20" y="0" width="12" height="44" rx="3" style={{ fill: 'var(--amber)' }} />
      </svg>
      <div>
        <div className="w">Second Mark</div>
        <div className="t">THE OTHER SIDE OF THE TRADE</div>
      </div>
    </div>
  );
}
