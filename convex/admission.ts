import { mutationGeneric } from "convex/server";
import { admitCanonical } from "../packages/backend/src/convex-admission";
import { admissionArgs, admissionResult } from "./admissionValidators";

export const bind = mutationGeneric({
  args: admissionArgs,
  returns: admissionResult,
  handler: admitCanonical,
});
