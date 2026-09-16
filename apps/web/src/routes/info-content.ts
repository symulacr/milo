export type InfoKind =
  | "privacy"
  | "terms"
  | "pilot"
  | "how-it-works"
  | "sign-in";

export const infoContent: Record<
  InfoKind,
  { title: string; intro: string; items: [string, string][] }
> = {
  privacy: {
    title: "Privacy",
    intro:
      "This prototype uses synthetic files and in-memory state. No sign-in, payment, wallet or customer data is collected.",
    items: [
      [
        "In the planned product",
        "Milo and authorized participants can access protected records and files. A chosen remote prover receives private proof inputs. Public ledger fields can reveal timing and commitments.",
      ],
      [
        "In this prototype",
        "Sample images are public static assets. Interactions reset on refresh; nothing is written to local storage.",
      ],
      [
        "Not a production privacy policy",
        "Retention, deletion and real-user disclosures require review before any live pilot.",
      ],
    ],
  },
  terms: {
    title: "Terms",
    intro:
      "You can explore the sample order flow. No purchase, commission, contract deployment or payment occurs.",
    items: [
      [
        "Fixed scope",
        "The proposed MVP is one fixed-price agreement and one delivery of three final images. No revisions, partial payouts or marketplace.",
      ],
      [
        "Two independent outcomes",
        "A valid approval would not guarantee successful payment, quality, ownership or lasting file availability.",
      ],
      [
        "Before real orders",
        "Reviewed terms, consent, merchant arrangements, safe recovery and operational readiness come first.",
      ],
    ],
  },
  pilot: {
    title: "Pilot status",
    intro:
      "The merchant pilot is not accepting enquiries or orders through this prototype.",
    items: [
      [
        "The first service",
        "One invited studio, one buyer, one pre-agreed operator and a three-image product pack.",
      ],
      [
        "What comes first",
        "A compiling contract, safe wallet/recovery path, private-file access, payment reconciliation and usability evidence.",
      ],
      [
        "Explore without committing",
        "Use the sample to inspect the proposed experience. Nothing guarantees future access or a delivery date.",
      ],
    ],
  },
  "how-it-works": {
    title: "How it works",
    intro:
      "Agree a bounded scope, review the exact delivery and make a deliberate decision. The protocol and the payment provider have different jobs.",
    items: [
      [
        "Agree before committing",
        "Read the merchant, amount, scope, rights and deadlines. Readiness must precede a payment hold, then checked deployment and reservation.",
      ],
      [
        "Review the actual files",
        "The merchant submits one fixed delivery. The buyer checks the downloaded bytes against the agreement.",
      ],
      [
        "Approve or dispute",
        "Approval is a contract action, not immediate payment. Capture is reconciled separately; disputes go to the pre-agreed operator.",
      ],
    ],
  },
  "sign-in": {
    title: "Sign in",
    intro:
      "Sign in with your email to reach an authorized quote or order. In this prototype the live Privy sign-in is wired as a bounded diagnostic under Connections; the sample workspace never requires an email, OTP, wallet seed or card details.",
    items: [
      [
        "One sign-in, no extra accounts",
        "Privy handles the email challenge. A verified session permits only authorized app access — independent order capabilities still control protocol actions, and there is no separate wallet login or second account.",
      ],
      [
        "Explore with a sample identity",
        "Choose a buyer, merchant or operator in the sample controls. This does not authenticate anyone.",
      ],
      [
        "No secret collection",
        "Never paste real credentials into prototypes. The sample needs none.",
      ],
    ],
  },
};
