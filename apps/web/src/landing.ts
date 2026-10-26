import { checkSampleFiles, MISMATCH, sampleFiles } from "./assets";

const rows = [...document.querySelectorAll<HTMLElement>("[data-row]")];
const button = document.querySelector<HTMLButtonElement>("[data-check]");
const status = document.querySelector("[data-check-status]");
const manifest = document.querySelector("[data-manifest]");

const show = (root: HTMLElement, state: string) => {
  root.dataset.state = state;
};

button?.addEventListener("click", async () => {
  button.disabled = true;
  if (status) status.textContent = "Your browser downloads the three files.";
  for (const row of rows) show(row, "checking");
  show(button, "checking");
  try {
    const result = await checkSampleFiles(new AbortController().signal);
    for (const [index, row] of rows.entries()) {
      const value = result.digests[index] ?? "";
      const digest = row.querySelector("[data-digest]");
      if (digest) digest.textContent = value || "not available";
      show(row, value === sampleFiles[index]?.hash ? "match" : "mismatch");
    }
    if (manifest) manifest.textContent = result.manifest;
    show(button, result.match ? "match" : "mismatch");
    if (status)
      status.textContent = result.match
        ? "All three files match the locked list. You can approve this delivery."
        : MISMATCH;
  } catch {
    for (const row of rows) show(row, "mismatch");
    show(button, "mismatch");
    if (status) status.textContent = "The file check did not finish. Reload.";
  } finally {
    button.disabled = false;
  }
});
