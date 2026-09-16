import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  type DemoContext,
  demoContextById,
  demoContexts,
} from "../demo-fixtures";

/**
 * Public guided sample tour (04-ui-design §4.4). Explicit synthetic view
 * model only: no workspace simulator, no wallet/payment/chain provider
 * imports, no mutation callbacks. Direct navigation, reload and new tab
 * render this standalone page; the modal-over-landing variant never
 * triggers because the static landing holds no in-app background location.
 * The import boundary is enforced by demo-boundary.test.tsx.
 */

const stepNames = ["Scope", "Delivery", "Approval", "Outcome"] as const;

function DemoSummary({
  context,
  full = true,
}: {
  context: DemoContext;
  full?: boolean;
}) {
  return (
    <div className="demo-facts">
      <h3>{context.pack}</h3>
      <p className="demo-merchant">{context.merchant}</p>
      <p className="demo-scope">{context.scope}</p>
      {full && (
        <dl className="demo-detail">
          <div>
            <dt>Usage rights</dt>
            <dd>{context.rights}</dd>
          </div>
          <div>
            <dt>Review deadline</dt>
            <dd>{context.deadline}</dd>
          </div>
          <div>
            <dt>Fixed price</dt>
            <dd>{context.amount} · one pack</dd>
          </div>
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
  const [step, setStep] = useState(0);
  const [imageIndex, setImageIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [pendingExample, setPendingExample] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const titleHeading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const contextChanged = useRef(false);

  // New step headings receive deliberate focus (04 §4.4 dialog rules);
  // the first render lands on the page heading instead, and a context
  // switch keeps focus on the selector (04:153).
  // biome-ignore lint/correctness/useExhaustiveDependencies: step is the intentional focus trigger
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      titleHeading.current?.focus();
      return;
    }
    if (contextChanged.current) {
      contextChanged.current = false;
      return;
    }
    stepHeading.current?.focus();
  }, [step]);

  function chooseContext(id: string) {
    // Context changes reset step, image, evidence and outcome together;
    // replace the current history entry rather than trapping Back (04 §4.4).
    contextChanged.current = true;
    setSearchParams({ context: demoContextById(id).id }, { replace: true });
    setStep(0);
    setImageIndex(0);
    setZoomed(false);
    setPendingExample(false);
    setAnnouncement(
      `Showing the ${demoContextById(id).label} sample from ${demoContextById(id).merchant}.`,
    );
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

      <h1 tabIndex={-1} className="demo-title" ref={titleHeading}>
        Explore a sample order
      </h1>

      <ol className="demo-steps" aria-label="Sample progress">
        {stepNames.map((name, i) => (
          <li key={name} aria-current={i === step ? "step" : undefined}>
            {i + 1} {name}
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
            <p className="demo-note">
              Sample artwork, not protected customer assets.
            </p>
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
            <details>
              <summary>What approval means</summary>
              <p className="demo-detail-copy">
                Approval records the buyer's decision against the agreed scope
                and this exact delivery. It is not immediate payment: capture is
                a separate, independently observed result that can still fail.
              </p>
            </details>
            <details>
              <summary>What stays private?</summary>
              <p className="demo-detail-copy">
                Commercial terms stay off the public ledger. Milo, the merchant
                and the chosen proving path each see what they receive; this
                sample collects nothing.
              </p>
            </details>
            <details>
              <summary>What is shared?</summary>
              <p className="demo-detail-copy">
                A public record can show that an order exists, its phase and
                commitments — never the brief, files or price in this design. A
                proof is not a quality guarantee.
              </p>
            </details>
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
              <p className="demo-panel-copy">
                The buyer approved this exact delivery. Approval alone is not a
                paid invoice.
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
              <p className="demo-panel-copy">
                {pendingExample
                  ? "The hold is still unresolved; the order stays approved while payment is checked."
                  : "Payment captured separately from the approval, observed on its own track."}
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
          <p className="demo-note">
            No transaction ID, no paid receipt — this is an illustrated outcome,
            not executed evidence.
          </p>
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
        {step === 0 && (
          <button type="button" className="button" onClick={() => setStep(1)}>
            Explore the delivery
          </button>
        )}
        {step === 1 && (
          <button type="button" className="button" onClick={() => setStep(2)}>
            See how approval works
          </button>
        )}
        {step === 2 && (
          <button type="button" className="button" onClick={() => setStep(3)}>
            Show sample outcome
          </button>
        )}
        {step === 3 && (
          <>
            <Link className="button" to="/pilot">
              Discuss a merchant pilot
            </Link>
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
