import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  type DemoContext,
  demoContextById,
  demoContexts,
} from "../demo-fixtures";

const stepNames = ["Scope", "Delivery", "Approval", "Outcome"] as const;

const STEP_PARAMS: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3 };

const stepFromParam = (value: string | null): number =>
  (value !== null ? STEP_PARAMS[value] : undefined) ?? 0;

const NEXT_LABELS = [
  "Explore the delivery",
  "See how approval works",
  "Show sample outcome",
] as const;

const APPROVAL_FACTS: readonly (readonly [string, string])[] = [
  [
    "What approval means",
    "Approval records the buyer's decision against the agreed scope and this exact delivery. It is not immediate payment: capture is a separate, independently observed result that can still fail.",
  ],
  [
    "What stays private?",
    "Commercial terms stay off the public ledger. Milo, the merchant and the chosen proving path each see what they receive; this sample collects nothing.",
  ],
  [
    "What is shared?",
    "A public record can show that an order exists, its phase and commitments — never the brief, files or price in this design. A proof is not a quality guarantee.",
  ],
];

function DemoSummary({
  context,
  full = true,
}: {
  context: DemoContext;
  full?: boolean;
}) {
  const rows = [
    ["Usage rights", context.rights],
    ["Review deadline", context.deadline],
    ["Fixed price", `${context.amount} · one pack`],
  ] as const;
  return (
    <div className="demo-facts">
      <h3>{context.pack}</h3>
      <p className="demo-merchant">{context.merchant}</p>
      <p className="demo-scope">{context.scope}</p>
      {full && (
        <dl className="demo-detail">
          {rows.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <details className="demo-case">
        <summary>Sample case</summary>
        <p className="demo-detail-copy">
          {context.caseId} · {context.templateRevision} · build-time fixture
        </p>
      </details>
    </div>
  );
}

export function DemoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const context = demoContextById(searchParams.get("context"));
  const [step, setStep] = useState(() =>
    stepFromParam(searchParams.get("step")),
  );
  const [imageIndex, setImageIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [pendingExample, setPendingExample] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const contextChanged = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (contextChanged.current) {
      contextChanged.current = false;
      return;
    }
    if (step >= 0) stepHeading.current?.focus();
  }, [step]);

  function chooseContext(id: string) {
    const next = demoContextById(id);
    contextChanged.current = true;
    setSearchParams({ context: next.id }, { replace: true });
    setStep(0);
    setImageIndex(0);
    setZoomed(false);
    setPendingExample(false);
    setAnnouncement(`Showing the ${next.label} sample from ${next.merchant}.`);
  }

  const image = context.images[imageIndex] ?? context.images[0];

  return (
    <div className="demo-window">
      <div className="demo-banner">
        <p className="demo-label">
          Synthetic sample · no wallet, payment or transaction
        </p>
        <label className="demo-context">
          Sample context
          <select
            value={context.id}
            onChange={(event) => chooseContext(event.target.value)}
          >
            {demoContexts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <p className="demo-sr" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>

      <h1 tabIndex={-1} className="demo-title">
        Explore a sample order
      </h1>

      <ol className="demo-steps" aria-label="Sample progress">
        {stepNames.map((name, i) => (
          <li
            key={name}
            aria-current={i === step ? "step" : undefined}
            className={i < step ? "reached" : undefined}
          >
            {i < step ? `✓ ${name}` : `${i + 1} ${name}`}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="demo-grid">
          <div className="demo-stage">
            <img
              src={context.images[0].src}
              alt={context.images[0].alt}
              width="600"
              height="720"
            />
          </div>
          <div>
            <h2 tabIndex={-1} ref={stepHeading}>
              One fixed quote, three final images
            </h2>
            <DemoSummary context={context} />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="demo-grid">
          <div className="demo-stage">
            <div className={`demo-image ${zoomed ? "zoomed" : ""}`}>
              <img src={image.src} alt={image.alt} width="600" height="720" />
            </div>
            <p className="demo-caption">
              {image.title} · {image.note}
            </p>
            <div className="demo-thumbs">
              {context.images.map((item, i) => (
                <button
                  key={item.src}
                  type="button"
                  className={i === imageIndex ? "active" : ""}
                  aria-pressed={i === imageIndex}
                  onClick={() => {
                    setImageIndex(i);
                    setZoomed(false);
                  }}
                >
                  <img
                    className="demo-thumb-img"
                    src={item.src}
                    alt=""
                    width="600"
                    height="720"
                  />
                  <span className="demo-sr">Show {item.title}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="text-link"
              aria-pressed={zoomed}
              onClick={() => setZoomed((value) => !value)}
            >
              {zoomed ? "Zoom out" : "Zoom in"}
            </button>
          </div>
          <div>
            <h2 tabIndex={-1} ref={stepHeading}>
              Inspect the exact delivery
            </h2>
            <DemoSummary context={context} full={false} />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="demo-grid">
          <div className="demo-stage">
            <img src={image.src} alt={image.alt} width="600" height="720" />
          </div>
          <div>
            <h2 tabIndex={-1} ref={stepHeading}>
              Approval is deliberate
            </h2>
            {APPROVAL_FACTS.map(([summary, copy], i) => (
              <details key={summary} open={i === 0}>
                <summary>{summary}</summary>
                <p className="demo-detail-copy">{copy}</p>
              </details>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2 tabIndex={-1} ref={stepHeading}>
            Two independent outcomes
          </h2>
          <div className="demo-outcome">
            <section className="demo-panel">
              <h3>Order approval</h3>
              <p>
                <span className="tag success">✓ Approved example</span>
              </p>
            </section>
            <section className="demo-panel">
              <h3>Payment observation</h3>
              <p className="demo-panel-copy">
                {pendingExample ? (
                  <span className="tag warning">! Payment pending example</span>
                ) : (
                  <span className="tag">○ Captured example</span>
                )}
              </p>
              <label className="demo-toggle">
                <input
                  type="checkbox"
                  checked={pendingExample}
                  onChange={(event) => setPendingExample(event.target.checked)}
                />
                Show the payment-pending example
              </label>
            </section>
          </div>
        </div>
      )}

      <div className="demo-actions">
        {step > 0 ? (
          <button
            type="button"
            className="button secondary"
            onClick={() => setStep(step - 1)}
          >
            Previous
          </button>
        ) : (
          <span />
        )}
        {step < 3 && (
          <button
            type="button"
            className="button"
            onClick={() => setStep(step + 1)}
          >
            {NEXT_LABELS[step]}
          </button>
        )}
        {step === 3 && (
          <>
            <Link className="button" to="/pilot">
              Discuss a merchant pilot
            </Link>
            <a className="button secondary" href="/orders/sample-001">
              Open interactive workspace ↗
            </a>
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                setStep(0);
                setImageIndex(0);
                setZoomed(false);
                setPendingExample(false);
              }}
            >
              Replay sample
            </button>
          </>
        )}
      </div>
    </div>
  );
}
