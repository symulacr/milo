export function WordmarkStar() {
  return (
    <svg className="wordmark-star" viewBox="0 0 32 32" aria-hidden="true">
      <g fill="currentColor">
        {[0, 60, 120].map((angle) => (
          <rect
            key={angle}
            x="14.2"
            y="6"
            width="3.6"
            height="20"
            rx="1.8"
            transform={angle ? `rotate(${angle} 16 16)` : undefined}
          />
        ))}
      </g>
    </svg>
  );
}

export function Wordmark() {
  return (
    <a href="/" className="wordmark" aria-label="Milo home">
      milo
      <WordmarkStar />
    </a>
  );
}
