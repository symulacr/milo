# E-PR2 auth inventory

Evidence: `obs_pr2_auth_inventory_1`

signatureSha256 `7b10f894a6cd801772a7ea3e06dc88cff3941621817a53bc4423c60d9eaa60c5`

```
public_exports=14
read queryGeneric
read queryGeneric
requestUploadMutation mutationGeneric
attachUploadMutation mutationGeneric
freezeMutation mutationGeneric
bind mutationGeneric
freeze mutationGeneric
requestPayment mutationGeneric
requestObservation mutationGeneric
stripeWebhook httpActionGeneric
filesGet httpActionGeneric
status queryGeneric
start mutationGeneric
stop mutationGeneric

routes=
/webhooks/stripe
/files
/debug-hmac
/debug-verify
```
