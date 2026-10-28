/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admission from "../admission.js";
import type * as admissionContext from "../admissionContext.js";
import type * as admissionValidators from "../admissionValidators.js";
import type * as auth from "../auth.js";
import type * as auth_identity from "../auth/identity.js";
import type * as auth_session from "../auth/session.js";
import type * as auth_walletPlugin from "../auth/walletPlugin.js";
import type * as canonicalAdmission from "../canonicalAdmission.js";
import type * as chainObserver from "../chainObserver.js";
import type * as crons from "../crons.js";
import type * as diagnostics from "../diagnostics.js";
import type * as disputeNotes from "../disputeNotes.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as observationIngest from "../observationIngest.js";
import type * as orderProjection from "../orderProjection.js";
import type * as orders from "../orders.js";
import type * as paymentMonitor from "../paymentMonitor.js";
import type * as paymentMonitoring from "../paymentMonitoring.js";
import type * as provisioning from "../provisioning.js";
import type * as settlement from "../settlement.js";
import type * as stripeCustomerProvisioning from "../stripeCustomerProvisioning.js";
import type * as stripeMonitoring from "../stripeMonitoring.js";
import type * as stripeProvisioning from "../stripeProvisioning.js";
import type * as stripeSettlement from "../stripeSettlement.js";
import type * as trustedProvisioning from "../trustedProvisioning.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admission: typeof admission;
  admissionContext: typeof admissionContext;
  admissionValidators: typeof admissionValidators;
  auth: typeof auth;
  "auth/identity": typeof auth_identity;
  "auth/session": typeof auth_session;
  "auth/walletPlugin": typeof auth_walletPlugin;
  canonicalAdmission: typeof canonicalAdmission;
  chainObserver: typeof chainObserver;
  crons: typeof crons;
  diagnostics: typeof diagnostics;
  disputeNotes: typeof disputeNotes;
  files: typeof files;
  http: typeof http;
  observationIngest: typeof observationIngest;
  orderProjection: typeof orderProjection;
  orders: typeof orders;
  paymentMonitor: typeof paymentMonitor;
  paymentMonitoring: typeof paymentMonitoring;
  provisioning: typeof provisioning;
  settlement: typeof settlement;
  stripeCustomerProvisioning: typeof stripeCustomerProvisioning;
  stripeMonitoring: typeof stripeMonitoring;
  stripeProvisioning: typeof stripeProvisioning;
  stripeSettlement: typeof stripeSettlement;
  trustedProvisioning: typeof trustedProvisioning;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
