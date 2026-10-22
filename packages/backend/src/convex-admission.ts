/**
 * The package-side name for the deployed admission adapter.
 *
 * `convex/canonicalAdmission.ts` is the only implementation and the only path
 * `admission.bind` reaches. This module used to carry a second, drifting copy
 * that hardcoded the payment window and never created the order projection, so
 * a package test could pass while the deployed path behaved differently. It now
 * re-exports, and `packages/backend/test/admission-single-implementation.test.ts`
 * fails if a second implementation reappears.
 */
export type { AdmissionContext } from "../../../convex/admissionContext";
export {
  type AdmissionInput,
  admitCanonical,
} from "../../../convex/canonicalAdmission";
