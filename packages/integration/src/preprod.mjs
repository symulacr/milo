import { checkPreprodProfile } from "./preprod-profile.mjs";

try {
  console.log(JSON.stringify(await checkPreprodProfile(process.env)));
} catch {
  console.error(
    JSON.stringify({
      scope: "preprod-profile-check-failed",
      deploymentVerified: false,
      admissionVerified: false,
    }),
  );
  process.exitCode = 1;
}
