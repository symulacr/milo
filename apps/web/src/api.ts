import type { FunctionReturnType } from "convex/server";
import { api as generated } from "../../../convex/_generated/api";

export type OrderDetail = NonNullable<
  FunctionReturnType<typeof generated.orders.order>
>;
export type OrderSummary = FunctionReturnType<
  typeof generated.orders.list
>[number];
export type Me = FunctionReturnType<typeof generated.auth.me>;
export type Stage = OrderDetail["stage"];
export type Role = OrderDetail["role"];
export type QuoteTerms = OrderDetail["terms"];

export const api = {
  me: generated.auth.me,
  orders: generated.orders.list,
  order: generated.orders.order,
  invite: generated.orders.invite,
  createQuote: generated.stripeProvisioning.createQuote,
  createStudioAndQuote: generated.stripeProvisioning.createStudioAndQuote,
  acceptInvite: generated.trustedProvisioning.acceptInvite,
  holdPayment: generated.stripeProvisioning.holdPayment,
  attachContract: generated.stripeProvisioning.attachContract,
  refreshOrder: generated.chainObserver.refreshOrder,
  operatorSecret: generated.stripeProvisioning.operatorSecret,
  requestUpload: generated.files.requestUploadMutation,
  attachUpload: generated.files.attachUploadMutation,
  freezeFiles: generated.files.freezeMutation,
  serveFile: generated.files.serveFileAction,
  putDisputeNote: generated.disputeNotes.put,
  disputeNote: generated.disputeNotes.get,
};
