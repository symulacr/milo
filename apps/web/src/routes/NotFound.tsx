import { ArrowRightIcon } from "../components/icons";
import { PublicTitle } from "../components/PageTitle";

export function NotFound() {
  return (
    <article className="grid gap-7 lg:grid-cols-12 lg:gap-8">
      <PublicTitle title="Page not found" />
      <p className="lead max-w-[36ch] lg:col-span-5 lg:col-start-8 lg:self-end">
        This address has no page. Make sure that the link is correct.
      </p>
      <a className="cta lg:col-span-5 lg:col-start-8" href="/">
        Go to the Milo home page{" "}
        <ArrowRightIcon size={20} className="arrow" aria-hidden="true" />
      </a>
    </article>
  );
}
