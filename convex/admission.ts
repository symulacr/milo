import { mutationGeneric } from "convex/server";
import { admitCanonical } from "./canonicalAdmission";
import { admissionArgs, admissionResult } from "./admissionValidators";

export const bind = mutationGeneric({
  args: admissionArgs,
  returns: admissionResult,
  handler: admitCanonical,
});
