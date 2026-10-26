/**
 * The one invite link. The client signs in and lands on the order in one hop,
 * so the link is both the sign-in callback and the invite.
 */
export const invitePath = (quoteId: string, token: string): string =>
  `/orders/${quoteId}?invite=${token}`;

export const inviteUrl = (quoteId: string, token: string): string =>
  `${process.env.SITE_URL ?? "http://localhost:5173"}${invitePath(quoteId, token)}`;
