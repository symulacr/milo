/** Brand mark: the ✳ seal asterisk as inline SVG (emoji rendering varies). */
export function WordmarkStar() {
  return (
    <svg className="wordmark-star" viewBox="0 0 32 32" aria-hidden="true">
      <g fill="currentColor">
        <rect x="14.2" y="6" width="3.6" height="20" rx="1.8" />
        <rect
          x="14.2"
          y="6"
          width="3.6"
          height="20"
          rx="1.8"
          transform="rotate(60 16 16)"
        />
        <rect
          x="14.2"
          y="6"
          width="3.6"
          height="20"
          rx="1.8"
          transform="rotate(120 16 16)"
        />
      </g>
    </svg>
  );
}
