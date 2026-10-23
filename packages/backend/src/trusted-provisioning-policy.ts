import { HEX64 } from "./encoding.ts";

export type Provenance = {
  operatorId: string;
  sourceId: string;
  evidenceFingerprint: string;
};

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;
const AUTHORITY_ERROR =
  "Allowlisted operator/source and evidence fingerprint required";

const isId = (value: unknown): boolean =>
  typeof value === "string" && ID_PATTERN.test(value);

export function validateProvenance(
  provenance: Provenance,
  requestId: string,
  configuredAuthorities: string | undefined,
) {
  validateProvisioningAuthority(provenance, requestId, configuredAuthorities);
  if (!HEX64.test(provenance.evidenceFingerprint))
    throw new Error(AUTHORITY_ERROR);
}

export function validateProvisioningAuthority(
  provenance: Pick<Provenance, "operatorId" | "sourceId">,
  requestId: string,
  configuredAuthorities: string | undefined,
) {
  if (configuredAuthorities === undefined)
    throw new Error("Trusted provisioning authority configuration required");
  let authorities: unknown;
  try {
    authorities = JSON.parse(configuredAuthorities);
  } catch {
    throw new Error("Trusted provisioning authority configuration malformed");
  }
  if (
    !Array.isArray(authorities) ||
    !authorities.some(
      (entry) =>
        entry?.operatorId === provenance.operatorId &&
        entry?.sourceId === provenance.sourceId,
    ) ||
    ![requestId, provenance.operatorId, provenance.sourceId].every(isId)
  )
    throw new Error(AUTHORITY_ERROR);
}

export function canonicalPayload(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalPayload(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
