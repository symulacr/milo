import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
} from "convex/server";
import type schema from "./schema";

export type AdmissionContext = GenericMutationCtx<
  DataModelFromSchemaDefinition<typeof schema>
>;
