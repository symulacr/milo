import { Link } from "react-router";
import { PageTitle } from "../components/PageTitle";
import { Button } from "../components/ui/button";

export function WorkspaceNotFound() {
  return (
    <>
      <PageTitle title="Page not found">
        <p className="text-muted-foreground">
          This address has no page in your workspace.
        </p>
      </PageTitle>
      <Button asChild variant="outline" className="w-fit">
        <Link to="/orders">Back to your orders</Link>
      </Button>
    </>
  );
}
