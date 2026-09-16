export type Provenance = {
  operatorId: string;
  sourceId: string;
  evidenceFingerprint: string;
};

// Internal-call authority comes from Convex, not from these audit labels.
// The caller must verify source evidence before invoking; a digest is not attestation.
export function validateProvenance(
  provenance: Provenance,
  requestId: string,
  configuredAuthorities: string | undefined,
) {
  validateProvisioningAuthority(provenance, requestId, configuredAuthorities);
  if (!/^[a-f0-9]{64}$/.test(provenance.evidenceFingerprint))
    throw new Error(
      "Allowlisted operator/source and evidence fingerprint required",
    );
}

export function validateProvisioningAuthority(
  provenance: Pick<Provenance, "operatorId" | "sourceId">,
  requestId: string,
  configuredAuthorities: string | undefined,
) {
  // Missing and malformed configuration are distinct operator failures.
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
    ![requestId, provenance.operatorId, provenance.sourceId].every(
      (value) =>
        typeof value === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value),
    )
  )
    throw new Error(
      "Allowlisted operator/source and evidence fingerprint required",
    );
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
