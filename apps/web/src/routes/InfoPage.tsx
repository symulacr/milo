import { ORDER_WINDOWS_MS as W } from "../../../../packages/backend/src/order-windows";
import { PublicTitle } from "../components/PageTitle";

const CONTACT_EMAIL = "pajiton@atomicmail.io";
const EFFECTIVE = "2026-10-26";

/** Hours, from the one place the windows are defined. */
const H = (ms: number) => ms / 3_600_000;
const TOTAL = H(W.acceptance + W.delivery + W.review + W.resolution);

export const PAGES = {
  privacy: {
    title: "Privacy",
    intro: `Effective ${EFFECTIVE}. What Milo collects, who else sees it, and how long it stays.`,
    items: {
      "What we collect":
        "Your email address, your Midnight wallet address, the order brief and files, and the card payment reference. Milo never stores the card number.",
      "Who processes it":
        "Convex stores the order database and files. Stripe processes the card. Vercel serves the site. Resend delivers sign-in email. Midnight Preprod records the order's public commitments.",
      "On the chain":
        "The order contract writes its phase, a commitment to the terms and the three party commitments to Midnight Preprod. That record is permanent. It does not contain the brief, the files or the price, and it cannot be deleted.",
      Cookies:
        "One session cookie keeps you signed in. It is strictly necessary, so there is no consent banner. Milo sets no analytics or advertising cookie.",
      "Your choices":
        "Ask us to export or delete your order data. The retention table lists the two exceptions.",
      Contact: `Questions or a data request: ${CONTACT_EMAIL}.`,
    },
  },
  terms: {
    title: "Terms",
    intro: `Effective ${EFFECTIVE}. The rules for a Milo order on Midnight Preprod.`,
    items: {
      Orders:
        "One fixed price for one delivery of three final images. No revision rounds and no partial payments.",
      Payment:
        "Milo authorizes your card when you accept the quote. Milo captures it only when you approve the delivery. If the order does not reach approval, the authorization is released. The pilot runs in Stripe test mode, so no real money moves.",
      "Time limits": `Each window counts from the finalised quote: ${H(W.acceptance)} hour to accept, ${H(W.delivery)} hours to deliver, ${H(W.review)} hours to review, ${H(W.resolution)} hours for the operator to decide a dispute. Together that is ${TOTAL} hours, inside the card authorization window.`,
      Files:
        "Exactly three images, each PNG, JPEG or WebP, up to 5 MiB. Milo stores them server-side and records each SHA-256 digest.",
      Disputes:
        "The named operator decides a dispute in full: approve or cancel. The operator cannot change the agreed terms. When you open a dispute you give a reason; it is encrypted to the operator in your browser, so only the operator can read it — not the studio, and not Milo's servers, which store only the ciphertext. The ledger keeps a hash of that reason, so what the operator reads can be checked against what you signed.",
      Network:
        "Orders run on Midnight Preprod and your wallet pays the network fee in tDUST. Mainnet comes after the pilot.",
      Contact: `Questions about an order: ${CONTACT_EMAIL}.`,
    },
  },
} as const;

/** How long each category stays. One row per category, so it is auditable. */
const RETENTION = [
  ["Order and payment records", "7 years, for tax"],
  ["Order brief and delivered files", "90 days after the order ends"],
  ["Session cookie", "7 days, then you sign in again"],
  ["On-chain commitments", "Permanent; not deletable"],
] as const;

export function InfoPage({ kind }: { kind: keyof typeof PAGES }) {
  const page = PAGES[kind];
  const rows = [
    ...Object.entries(page.items),
    ...(kind === "privacy" ? RETENTION : []),
  ];
  const slug = (heading: string) =>
    heading.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <article className="grid gap-12 lg:gap-16">
      <PublicTitle title={page.title} />
      <p className="lead max-w-[52ch]">{page.intro}</p>
      <nav aria-label="On this page" className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap gap-x-4 gap-y-1">
          {rows.map(([heading]) => (
            <li key={heading}>
              <a
                className="underline underline-offset-4"
                href={`#${slug(heading)}`}
              >
                {heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <dl className="grid gap-y-10">
        {rows.map(([heading, body]) => (
          <div
            key={heading}
            id={slug(heading)}
            className="grid gap-2 scroll-mt-24"
          >
            <dt className="heading">{heading}</dt>
            <dd className="max-w-[52ch] text-[17px] leading-relaxed">{body}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
