/**
 * Build-time synthetic fixtures for the public /demo tour (04-ui-design §4.4).
 * Stable case IDs, template revisions, fictional merchants and example-only
 * state. Never a runtime service registry or real order creation; no real
 * scope, customer identifiers or protected order context belongs in these
 * datasets or in the ?context= URL.
 */
import { REVIEW_DEADLINE } from "./reviewDeadline";

type DemoImage = {
  src: string;
  title: string;
  note: string;
  alt: string;
};

export type DemoContext = {
  id: `SC-0${1 | 2 | 3 | 4 | 5 | 6 | 7}`;
  label: string;
  caseId: string;
  templateRevision: string;
  merchant: string;
  pack: string;
  scope: string;
  rights: string;
  deadline: string;
  amount: string;
  images: [DemoImage, DemoImage, DemoImage];
};

const TEMPLATE = "image-pack-v1 · template r3";

const sc01: DemoContext = {
  id: "SC-01",
  label: "Commerce imagery",
  caseId: "CASE-SC01-A",
  templateRevision: TEMPLATE,
  merchant: "North Studio",
  pack: "Three-image product pack",
  scope:
    "Listing-ready images of one ceramic vessel: a hero portrait, a material detail and a collection composition. Consistent dimensions for the buyer's storefront.",
  rights: "Website and organic social",
  deadline: `Review due ${REVIEW_DEADLINE} · sample clock`,
  amount: "$360 USD",
  images: [
    {
      src: "/images/hero.png",
      title: "The hero",
      note: "Product portrait · studio composition",
      alt: "Sample Still Studio photography: sculptural vessel on a warm studio plinth",
    },
    {
      src: "/images/detail.png",
      title: "The details",
      note: "Material study · close composition",
      alt: "Sample Still Studio photography: detail of an olive ceramic vessel",
    },
    {
      src: "/images/collection.png",
      title: "The collection",
      note: "Campaign composition · family portrait",
      alt: "Sample Still Studio photography: the three-piece collection arrangement",
    },
  ],
};

export const demoContexts: DemoContext[] = [
  sc01,
  {
    id: "SC-02",
    label: "Product visualization",
    caseId: "CASE-SC02-A",
    templateRevision: TEMPLATE,
    merchant: "Unison Objects",
    pack: "Three-image render study",
    scope:
      "Sample stills of an unreleased container design: overall form, a join detail and the colorway set. Each image is sample product photography, not a claim about a finished product.",
    rights: "Internal review and one approved announcement · sample terms",
    deadline: "Review due 12 Sep 2026, 09:30 UTC · sample clock",
    amount: "$420 USD",
    images: [
      {
        src: "/images/sc-02-01.png",
        title: "The form",
        note: "Overall composition · render",
        alt: "Sample Unison photography: stacked container forms on a plinth",
      },
      {
        src: "/images/sc-02-02.png",
        title: "The join",
        note: "Close detail · render",
        alt: "Sample Unison photography: close study of the container join",
      },
      {
        src: "/images/sc-02-03.png",
        title: "The colorways",
        note: "Set of three · render",
        alt: "Sample Unison photography: three colorway studies in a row",
      },
    ],
  },
  {
    id: "SC-03",
    label: "Campaign and launch creative",
    caseId: "CASE-SC03-A",
    templateRevision: TEMPLATE,
    merchant: "Basil Club",
    pack: "Three-image launch set",
    scope:
      "Launch artwork for one audience and one date: a hero poster, a crop for story format and a small series. Permitted claims are listed; no performance promises.",
    rights: "One launch window, named channels · sample terms",
    deadline: "Review due 14 Sep 2026, 12:00 UTC · sample clock",
    amount: "$510 USD",
    images: [
      {
        src: "/images/sc-03-01.png",
        title: "The poster",
        note: "Hero composition · launch",
        alt: "Sample Basil Club photography: sun and rays over a horizon line",
      },
      {
        src: "/images/sc-03-02.png",
        title: "The crop",
        note: "Story format · launch",
        alt: "Sample Basil Club photography: close crop of the launch motif",
      },
      {
        src: "/images/sc-03-03.png",
        title: "The series",
        note: "Set of three · launch",
        alt: "Sample Basil Club photography: three small launch motifs in a row",
      },
    ],
  },
  {
    id: "SC-04",
    label: "Property and hospitality imagery",
    caseId: "CASE-SC04-A",
    templateRevision: TEMPLATE,
    merchant: "Hotel Aria",
    pack: "Three-image arrival set",
    scope:
      "Listing imagery for one property: the arrival doorway, a material detail and the room set. Location and subject consent confirmed by the buyer's supplied material.",
    rights: "Booking listings and the property's own site · sample terms",
    deadline: "Review due 16 Sep 2026, 15:00 UTC · sample clock",
    amount: "$390 USD",
    images: [
      {
        src: "/images/sc-04-01.png",
        title: "The arrival",
        note: "Doorway composition",
        alt: "Sample Hotel Aria photography: arched doorway on a quiet facade",
      },
      {
        src: "/images/sc-04-02.png",
        title: "The threshold",
        note: "Close detail",
        alt: "Sample Hotel Aria photography: close study of the arched threshold",
      },
      {
        src: "/images/sc-04-03.png",
        title: "The set",
        note: "Set of three",
        alt: "Sample Hotel Aria photography: three small arrival studies in a row",
      },
    ],
  },
  {
    id: "SC-05",
    label: "Publishing and entertainment artwork",
    caseId: "CASE-SC05-A",
    templateRevision: TEMPLATE,
    merchant: "Chronicle House",
    pack: "Three-image cover proofs",
    scope:
      "Cover proofs for one release: the front composition, a spine detail and the series set. Release context supplied; no spoiler-bearing interior material.",
    rights: "One edition, print and digital storefronts · sample terms",
    deadline: "Review due 18 Sep 2026, 10:00 UTC · sample clock",
    amount: "$470 USD",
    images: [
      {
        src: "/images/sc-05-01.png",
        title: "The cover",
        note: "Front composition",
        alt: "Sample Chronicle House photography: standing book covers in ink tones",
      },
      {
        src: "/images/sc-05-02.png",
        title: "The spine",
        note: "Close detail",
        alt: "Sample Chronicle House photography: close study of a book spine",
      },
      {
        src: "/images/sc-05-03.png",
        title: "The series",
        note: "Set of three",
        alt: "Sample Chronicle House photography: three small cover studies in a row",
      },
    ],
  },
  {
    id: "SC-06",
    label: "Brand and market adaptation",
    caseId: "CASE-SC06-A",
    templateRevision: TEMPLATE,
    merchant: "Locale Supply",
    pack: "Three-image market edition",
    scope:
      "Adaptation of one approved mark for one target market: the badge, a label detail and the placement set. Brand constraints and language supplied as references.",
    rights: "One market, packaging and storefront · sample terms",
    deadline: "Review due 21 Sep 2026, 14:00 UTC · sample clock",
    amount: "$440 USD",
    images: [
      {
        src: "/images/sc-06-01.png",
        title: "The badge",
        note: "Adapted mark",
        alt: "Sample Locale Supply photography: circular badge with ribbon",
      },
      {
        src: "/images/sc-06-02.png",
        title: "The label",
        note: "Close detail",
        alt: "Sample Locale Supply photography: close study of the badge label",
      },
      {
        src: "/images/sc-06-03.png",
        title: "The placements",
        note: "Set of three",
        alt: "Sample Locale Supply photography: three small badge studies in a row",
      },
    ],
  },
  {
    id: "SC-07",
    label: "Business and sales communication",
    caseId: "CASE-SC07-A",
    templateRevision: TEMPLATE,
    merchant: "Quotient Office",
    pack: "Three-image deck figures",
    scope:
      "Figures for one confidential proposal: a headline chart, a detail crop and the summary set. Buyer supplies the audience and the underlying numbers.",
    rights: "One proposal, internal distribution · sample terms",
    deadline: "Review due 23 Sep 2026, 11:00 UTC · sample clock",
    amount: "$380 USD",
    images: [
      {
        src: "/images/sc-07-01.png",
        title: "The headline",
        note: "Chart composition",
        alt: "Sample Quotient Office photography: ascending chart bars on a baseline",
      },
      {
        src: "/images/sc-07-02.png",
        title: "The detail",
        note: "Close crop",
        alt: "Sample Quotient Office photography: close study of the chart bars",
      },
      {
        src: "/images/sc-07-03.png",
        title: "The set",
        note: "Set of three",
        alt: "Sample Quotient Office photography: three small chart studies in a row",
      },
    ],
  },
];

const fallback = sc01;

/** Accept only known synthetic context IDs; unknown input defaults to SC-01. */
export function demoContextById(id: string | null): DemoContext {
  return demoContexts.find((context) => context.id === id) ?? fallback;
}
