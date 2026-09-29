# HANDOFF.md

## State
- Stage: PROTOTYPE. D1a done (37 functions). D1b done (webhook 400/413/200).
- Live: https://tremendous-rooster-473.convex.cloud
- Webhook secret matches local. HMAC WebCrypto verified RFC vector live.
- Unit 493/0/0. http.test 13/13.

## Next 5 IDs
1. D1c real Stripe test-mode PaymentIntent event
2. D1d stripeSettlement:run rebuild
3. D2a local Midnight happy path
4. D2b SPEND-LEDGER
5. D2c Preprod happy path

## Evidence
E-D1A-01 function-spec 37
E-D1B-01 rejects 400/413
E-D1B-02 accept 200 isNew
E-HMAC-01 live RFC vector match

CONTINUE: D1c
