import { mutationGeneric } from "convex/server";
import { admissionArgs, admissionResult } from "./admissionValidators";
import { admitCanonical } from "./canonicalAdmission";

export const bind = mutationGeneric({
  args: admissionArgs,
  returns: admissionResult,
  handler: admitCanonical,
});
