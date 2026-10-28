import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ORDER_WINDOWS_MS } from "../../../../packages/backend/src/order-windows";
import { checkSampleFiles, MISMATCH, sampleFiles } from "../assets";
import {
  ArrowRightIcon,
  CheckIcon,
  LoaderCircleIcon,
  XIcon,
} from "../components/icons";
import { mountFieldCanvas } from "../field-canvas";
import {
  PublicFooter,
  PublicHeader,
} from "../shells/public-chrome";

const rise = (i: number): CSSProperties => ({ ["--i" as string]: i });

const H = (ms: number) => ms / 3_600_000;

const STEPS = [
  [
    "Agree",
    `One fixed price, one deadline. Opening the link authorizes the card within ${H(ORDER_WINDOWS_MS.acceptance)} hour and reserves the terms.`,
    "1 hour",
    "/images/agree.webp",
  ],
  [
    "Deliver",
    "Three images, locked with each SHA-256 digest.",
    `${H(ORDER_WINDOWS_MS.delivery)} hours`,
    "/images/shoot.webp",
  ],
  [
    "Review",
    "Your browser hashes each file. Approve and capture, or dispute.",
    `${H(ORDER_WINDOWS_MS.review)} hours`,
    "/images/proof-review.webp",
  ],
  [
    "Done",
    "Approval asks Milo to capture the card. Capture is separate and can fail.",
    "on approval",
    "/images/packing.webp",
  ],
] as const;

const FAQ = [
  [
    "What does “private” mean?",
    "The ledger hides the price, brief and files. Not anonymous, and a proof does not judge the work.",
  ],
  ["Is approval payment?", "No. Capture is separate and can fail."],
  [
    "Wrong delivery?",
    `Do not approve. Open a dispute: the operator has ${H(ORDER_WINDOWS_MS.resolution)} hours and cannot change the terms.`,
  ],
  [
    "Lost your key?",
    "It lives in this browser; Milo cannot replace it. Keep the encrypted backup safe.",
  ],
] as const;

const LIMITS = [
  ["3", "images per order"],
  [`${H(ORDER_WINDOWS_MS.acceptance)} h`, "to accept"],
  [`${H(ORDER_WINDOWS_MS.delivery)} h`, "to deliver"],
  [`${H(ORDER_WINDOWS_MS.review)} h`, "to review"],
  ["0", "terms on the public ledger"],
] as const;

type RowState = "" | "checking" | "match" | "mismatch";

export function Landing() {
  const fieldRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "Hashes three example files in your browser.",
  );
  const [digests, setDigests] = useState<string[]>(
    sampleFiles.map(() => "not checked"),
  );
  const [manifest, setManifest] = useState("not checked");
  const [rowState, setRowState] = useState<RowState[]>(
    sampleFiles.map(() => ""),
  );

  useEffect(() => {
    if (!fieldRef.current) return;
    return mountFieldCanvas(fieldRef.current);
  }, []);

  const runCheck = async () => {
    setBusy(true);
    setStatus("Your browser downloads the three files.");
    setRowState(sampleFiles.map(() => "checking"));
    try {
      const result = await checkSampleFiles(new AbortController().signal);
      setDigests(result.digests.map((d) => d || "not available"));
      setRowState(
        result.digests.map((value, i) =>
          value === sampleFiles[i]?.hash ? "match" : "mismatch",
        ),
      );
      setManifest(result.manifest);
      setStatus(
        result.match
          ? "All three files match the locked list. You can approve this delivery."
          : MISMATCH,
      );
    } catch {
      setRowState(sampleFiles.map(() => "mismatch"));
      setStatus("The file check did not finish. Reload.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-brand text-white">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <PublicHeader
        className="bg-brand"
        howHover="hover:text-yellow"
        ctaClass="cta h-9 px-4 text-sm"
      />
      <main id="main">
        <section
          aria-labelledby="hero-title"
          className="px-4 pt-8 pb-16 sm:px-8 lg:pt-12 lg:pb-20"
        >
          <div className="mx-auto grid max-w-7xl items-center gap-8 lg:grid-cols-2 lg:gap-16">
            <div className="grid content-center gap-6">
              <h1 id="hero-title" className="display-xl rise" style={rise(0)}>
                Approve the exact files.
              </h1>
              <p className="lead rise max-w-[38ch]" style={rise(1)}>
                A private order between a studio and its client. Your browser
                checks the images before you approve.
              </p>
              <a className="cta rise" href="/orders/new" style={rise(2)}>
                Start an order{" "}
                <ArrowRightIcon size={20} className="arrow" aria-hidden="true" />
              </a>
            </div>
            <aside
              ref={fieldRef}
              className="registration-sheet rise w-full max-w-[min(100%,28rem)] justify-self-center lg:max-w-none"
              style={rise(2)}
              aria-label="Registration sheet"
            >
              <p className="relative z-1 text-sm font-semibold tracking-wide uppercase">
                Proof sheet · 3 wells
              </p>
              <ol aria-label="The three final images">
                {sampleFiles.map((file, i) => (
                  <li key={file.src}>
                    <img
                      src={file.src}
                      alt=""
                      width={600}
                      height={720}
                      fetchPriority={i === 0 ? "high" : undefined}
                      loading={i === 0 ? undefined : "lazy"}
                      decoding="async"
                    />
                    <span>{String(i + 1).padStart(2, "0")}</span>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
          <div className="mx-auto mt-24 grid max-w-7xl gap-6 lg:grid-cols-[minmax(0,12rem)_1fr] lg:gap-12">
            <h2 className="heading">Time limits</h2>
            <dl
              className="rise grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4"
              style={rise(3)}
            >
              {LIMITS.map(([value, label]) => (
                <div key={label} className="grid gap-1">
                  <dt className="order-2 max-w-[18ch] text-[17px] text-white/80">
                    {label}
                  </dt>
                  <dd className="display">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section
          id="how"
          className="mark-yellow bg-white px-4 py-20 text-black sm:px-8 lg:py-28"
          aria-labelledby="how-title"
        >
          <div className="mx-auto max-w-7xl">
            <h2 id="how-title" className="display max-w-[16ch]">
              One order, four steps
            </h2>
          </div>
          <ol className="mx-auto mt-14 grid max-w-7xl gap-12">
            {STEPS.map(([title, body, time, src], i) => (
              <li
                key={title}
                className="rise grid items-center gap-x-8 gap-y-4 sm:grid-cols-[minmax(0,12rem)_1fr_auto]"
                style={rise(i)}
              >
                <h3 className="heading">{title}</h3>
                <div className="grid gap-3">
                  <p className="max-w-[52ch] text-[17px] leading-relaxed">
                    {body}
                  </p>
                  <img
                    className="aspect-[16/10] w-full max-w-[28rem] object-cover"
                    src={src}
                    alt=""
                    width={896}
                    height={560}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <p className="text-[17px] font-semibold sm:self-start sm:text-right">
                  {time}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="grid bg-white text-black lg:grid-cols-2"
          aria-labelledby="check-title"
        >
          <div className="flex flex-col justify-center gap-8 px-4 py-16 sm:px-8 lg:py-24">
            <h2 id="check-title" className="display max-w-[12ch]">
              Check the files yourself
            </h2>
            <p className="lead max-w-[34ch]">
              The same check runs before every approval: your browser hashes each
              file and compares the three digests with the locked list.
            </p>
            <div className="grid gap-4">
              <button
                type="button"
                className="cta cursor-pointer disabled:cursor-progress disabled:opacity-60"
                disabled={busy}
                onClick={() => void runCheck()}
              >
                {busy ? (
                  <LoaderCircleIcon
                    size={20}
                    className="motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <CheckIcon size={20} aria-hidden="true" />
                )}
                <span>Check the files</span>
              </button>
              <p className="max-w-[40ch] text-[15px] empty:hidden" role="status">
                {status}
              </p>
            </div>
          </div>
          <div className="flex items-center px-4 pb-16 sm:px-8 lg:py-24">
            <article className="w-full max-w-[520px] rounded-md bg-muted p-6">
              <h3 className="text-[17px] font-bold">An example delivery</h3>
              <ul
                className="mt-5 grid gap-4"
                aria-label="Files and SHA-256 digests"
              >
                {sampleFiles.map((file, i) => (
                  <li
                    key={file.src}
                    data-state={rowState[i] || undefined}
                    className="grid grid-cols-[44px_1fr_auto] items-center gap-x-3"
                  >
                    <img
                      className="aspect-[4/5] w-11 rounded object-cover"
                      src={file.src}
                      alt=""
                      width={44}
                      height={55}
                      loading="lazy"
                    />
                    <span className="grid">
                      <span className="font-semibold">{file.title}</span>
                      <code className="font-mono text-sm break-all text-muted-foreground">
                        {digests[i]}
                      </code>
                    </span>
                    <span className="state grid size-5 place-items-center [li[data-state=match]_&]:text-positive [li[data-state=mismatch]_&]:text-destructive">
                      {rowState[i] === "match" ? (
                        <CheckIcon size={20} aria-hidden="true" />
                      ) : rowState[i] === "mismatch" ? (
                        <XIcon size={20} aria-hidden="true" />
                      ) : rowState[i] === "checking" ? (
                        <LoaderCircleIcon
                          size={20}
                          className="motion-safe:animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <LoaderCircleIcon size={20} aria-hidden="true" />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 grid gap-1 text-sm text-muted-foreground">
                <span>One commitment</span>
                <code className="font-mono text-sm break-all text-foreground">
                  {manifest}
                </code>
              </p>
            </article>
          </div>
        </section>

        <section
          id="faq"
          className="px-4 py-20 sm:px-8 lg:py-28"
          aria-labelledby="faq-title"
        >
          <h2 id="faq-title" className="display mx-auto max-w-7xl">
            Plain answers
          </h2>
          <dl className="mx-auto mt-14 grid max-w-7xl gap-y-12 lg:gap-y-16">
            {FAQ.map(([q, a]) => (
              <div
                key={q}
                className="grid gap-3 lg:grid-cols-2 lg:gap-16"
              >
                <dt className="heading">{q}</dt>
                <dd className="max-w-[44ch] text-[17px] leading-relaxed text-white/85">
                  {a}
                </dd>
              </div>
            ))}
            <div className="grid gap-3 lg:grid-cols-2 lg:gap-16">
              <dt className="heading">What do I need?</dt>
              <dd className="max-w-[44ch] text-[17px] leading-relaxed text-white/85">
                Chromium and the{" "}
                <a
                  className="underline underline-offset-4 hover:text-yellow"
                  href="https://www.lace.io"
                  rel="noopener"
                >
                  Lace wallet
                </a>{" "}
                on Preprod, with tDUST for fees.{" "}
                <a
                  className="underline underline-offset-4 hover:text-yellow"
                  href="https://docs.midnight.network/guides/networks-and-environments"
                  rel="noopener"
                >
                  Get tNIGHT
                </a>
                , then “Generate tDUST”.
              </dd>
            </div>
          </dl>
        </section>

        <section
          aria-labelledby="close-title"
          className="grid lg:grid-cols-2"
        >
          <img
            className="aspect-[4/3] w-full object-cover lg:aspect-auto lg:h-full"
            src="/images/studio-shelf.webp"
            alt="A shelf of finished handmade vessels in a ceramics studio"
            width={1200}
            height={900}
            loading="lazy"
          />
          <div className="mark-yellow grid content-end gap-6 bg-white px-4 py-16 text-black sm:px-8 lg:py-20">
            <h2 id="close-title" className="display">
              <a
                className="inline-flex flex-wrap items-baseline gap-x-4 underline decoration-4 underline-offset-[6px] hover:text-brand"
                href="/orders/new"
              >
                Start an order{" "}
                <ArrowRightIcon size={28} className="arrow" aria-hidden="true" />
              </a>
            </h2>
            <p className="lead max-w-[34ch]">
              Studios start here. Everyone else signs in.
            </p>
          </div>
        </section>
      </main>
      <PublicFooter
        privacy={<a href="/privacy">Privacy</a>}
        terms={<a href="/terms">Terms</a>}
      />
    </div>
  );
}
