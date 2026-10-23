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

type ImageSeed = readonly [
  src: string,
  title: string,
  note: string,
  alt: string,
];

type ContextSeed = {
  id: DemoContext["id"];
  label: string;
  merchant: string;
  pack: string;
  scope: string;
  rights: string;
  deadline: string;
  amount: string;
  images: readonly [ImageSeed, ImageSeed, ImageSeed];
};

function context(seed: ContextSeed): DemoContext {
  return {
    ...seed,
    caseId: `CASE-${seed.id.replace("-", "")}-A`,
    templateRevision: TEMPLATE,
    images: seed.images.map(([src, title, note, alt]) => ({
      src,
      title,
      note,
      alt,
    })) as [DemoImage, DemoImage, DemoImage],
  };
}

const SEEDS: readonly ContextSeed[] = [
  {
    id: "SC-01",
    label: "Commerce imagery",
    merchant: "North Studio",
    pack: "Three-image product pack",
    scope:
      "Listing-ready images of one ceramic vessel: a hero portrait, a material detail and a collection composition. Consistent dimensions for the buyer's storefront.",
    rights: "Website and organic social",
    deadline: `Review due ${REVIEW_DEADLINE} · sample clock`,
    amount: "$360 USD",
    images: [
      [
        "/images/hero.webp",
        "The hero",
        "Product portrait · studio composition",
        "Sample Still Studio photography: sculptural vessel on a warm studio plinth",
      ],
      [
        "/images/detail.webp",
        "The details",
        "Material study · close composition",
        "Sample Still Studio photography: detail of an olive ceramic vessel",
      ],
      [
        "/images/collection.webp",
        "The collection",
        "Campaign composition · family portrait",
        "Sample Still Studio photography: the three-piece collection arrangement",
      ],
    ],
  },
  {
    id: "SC-02",
    label: "Product visualization",
    merchant: "Unison Objects",
    pack: "Three-image render study",
    scope:
      "Sample stills of an unreleased container design: overall form, a join detail and the colorway set. Each image is sample product photography, not a claim about a finished product.",
    rights: "Internal review and one approved announcement · sample terms",
    deadline: "Review due 12 Sep 2026, 09:30 UTC · sample clock",
    amount: "$420 USD",
    images: [
      [
        "/images/sc-02-01.webp",
        "The form",
        "Overall composition · render",
        "Sample Unison photography: stacked container forms on a plinth",
      ],
      [
        "/images/sc-02-02.webp",
        "The join",
        "Close detail · render",
        "Sample Unison photography: close study of the container join",
      ],
      [
        "/images/sc-02-03.webp",
        "The colorways",
        "Set of three · render",
        "Sample Unison photography: three colorway studies in a row",
      ],
    ],
  },
  {
    id: "SC-03",
    label: "Campaign and launch creative",
    merchant: "Basil Club",
    pack: "Three-image launch set",
    scope:
      "Launch artwork for one audience and one date: a hero poster, a crop for story format and a small series. Permitted claims are listed; no performance promises.",
    rights: "One launch window, named channels · sample terms",
    deadline: "Review due 14 Sep 2026, 12:00 UTC · sample clock",
    amount: "$510 USD",
    images: [
      [
        "/images/sc-03-01.webp",
        "The poster",
        "Hero composition · launch",
        "Sample Basil Club photography: sun and rays over a horizon line",
      ],
      [
        "/images/sc-03-02.webp",
        "The crop",
        "Story format · launch",
        "Sample Basil Club photography: close crop of the launch motif",
      ],
      [
        "/images/sc-03-03.webp",
        "The series",
        "Set of three · launch",
        "Sample Basil Club photography: three small launch motifs in a row",
      ],
    ],
  },
  {
    id: "SC-04",
    label: "Property and hospitality imagery",
    merchant: "Hotel Aria",
    pack: "Three-image arrival set",
    scope:
      "Listing imagery for one property: the arrival doorway, a material detail and the room set. Location and subject consent confirmed by the buyer's supplied material.",
    rights: "Booking listings and the property's own site · sample terms",
    deadline: "Review due 16 Sep 2026, 15:00 UTC · sample clock",
    amount: "$390 USD",
    images: [
      [
        "/images/sc-04-01.webp",
        "The arrival",
        "Doorway composition",
        "Sample Hotel Aria photography: arched doorway on a quiet facade",
      ],
      [
        "/images/sc-04-02.webp",
        "The threshold",
        "Close detail",
        "Sample Hotel Aria photography: close study of the arched threshold",
      ],
      [
        "/images/sc-04-03.webp",
        "The set",
        "Set of three",
        "Sample Hotel Aria photography: three small arrival studies in a row",
      ],
    ],
  },
  {
    id: "SC-05",
    label: "Publishing and entertainment artwork",
    merchant: "Chronicle House",
    pack: "Three-image cover proofs",
    scope:
      "Cover proofs for one release: the front composition, a spine detail and the series set. Release context supplied; no spoiler-bearing interior material.",
    rights: "One edition, print and digital storefronts · sample terms",
    deadline: "Review due 18 Sep 2026, 10:00 UTC · sample clock",
    amount: "$470 USD",
    images: [
      [
        "/images/sc-05-01.webp",
        "The cover",
        "Front composition",
        "Sample Chronicle House photography: standing book covers in ink tones",
      ],
      [
        "/images/sc-05-02.webp",
        "The spine",
        "Close detail",
        "Sample Chronicle House photography: close study of a book spine",
      ],
      [
        "/images/sc-05-03.webp",
        "The series",
        "Set of three",
        "Sample Chronicle House photography: three small cover studies in a row",
      ],
    ],
  },
  {
    id: "SC-06",
    label: "Brand and market adaptation",
    merchant: "Locale Supply",
    pack: "Three-image market edition",
    scope:
      "Adaptation of one approved mark for one target market: the badge, a label detail and the placement set. Brand constraints and language supplied as references.",
    rights: "One market, packaging and storefront · sample terms",
    deadline: "Review due 21 Sep 2026, 14:00 UTC · sample clock",
    amount: "$440 USD",
    images: [
      [
        "/images/sc-06-01.webp",
        "The badge",
        "Adapted mark",
        "Sample Locale Supply photography: circular badge with ribbon",
      ],
      [
        "/images/sc-06-02.webp",
        "The label",
        "Close detail",
        "Sample Locale Supply photography: close study of the badge label",
      ],
      [
        "/images/sc-06-03.webp",
        "The placements",
        "Set of three",
        "Sample Locale Supply photography: three small badge studies in a row",
      ],
    ],
  },
  {
    id: "SC-07",
    label: "Business and sales communication",
    merchant: "Quotient Office",
    pack: "Three-image deck figures",
    scope:
      "Figures for one confidential proposal: a headline chart, a detail crop and the summary set. Buyer supplies the audience and the underlying numbers.",
    rights: "One proposal, internal distribution · sample terms",
    deadline: "Review due 23 Sep 2026, 11:00 UTC · sample clock",
    amount: "$380 USD",
    images: [
      [
        "/images/sc-07-01.webp",
        "The headline",
        "Chart composition",
        "Sample Quotient Office photography: ascending chart bars on a baseline",
      ],
      [
        "/images/sc-07-02.webp",
        "The detail",
        "Close crop",
        "Sample Quotient Office photography: close study of the chart bars",
      ],
      [
        "/images/sc-07-03.webp",
        "The set",
        "Set of three",
        "Sample Quotient Office photography: three small chart studies in a row",
      ],
    ],
  },
];

export const demoContexts: DemoContext[] = SEEDS.map(context);

const fallback = demoContexts[0];

export function demoContextById(id: string | null): DemoContext {
  return demoContexts.find((context) => context.id === id) ?? fallback;
}
