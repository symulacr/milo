import {
  type PublicConfig,
  publicConfigSchema,
} from "../../../packages/backend/src/public-config";

let pending: Promise<PublicConfig> | null = null;

export function loadPublicConfig(): Promise<PublicConfig> {
  pending ??= fetch("/api/public-config", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("unavailable");
      return response.json();
    })
    .then((body) => publicConfigSchema.parse(body))
    .catch((cause) => {
      pending = null;
      throw cause;
    });
  return pending;
}
