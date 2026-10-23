import { useState } from "react";
import { Link } from "react-router";
import { RoleRequired } from "../components/gates";
import { PageTitle } from "../components/PageTitle";
import { Panel } from "../components/ui";
import { REVIEW_DEADLINE } from "../reviewDeadline";
import { quoteSchema, useWorkspace } from "../workspace/model";

const FIXED = [
  ["Deliverables", "Exactly three final PNG images"],
  ["Usage", "Website and organic social"],
  ["Review deadline", REVIEW_DEADLINE],
  ["Resolution", "Pre-agreed operator · full approval or cancellation"],
];

export function NewQuote() {
  const { quote, reset, navigate } = useWorkspace();
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(() => ({
    ...quote,
    amount: String(quote.amount),
  }));
  const set = (field: "name" | "brief" | "amount") => (value: string) =>
    setDraft((prior) => ({ ...prior, [field]: value }));
  return (
    <RoleRequired requiredRole="merchant">
      <PageTitle title="New sample quote" />
      <Panel className="reading-panel">
        <form
          action={(data) => {
            const result = quoteSchema.safeParse(Object.fromEntries(data));
            if (!result.success) {
              setError(
                "Use a title of 5–80 characters, a brief of 20–500 characters, and a whole-dollar price from $1 to $5,000.",
              );
              return;
            }
            reset("fresh", result.data, "merchant");
            navigate("/quotes/sample-001");
          }}
        >
          <label className="field">
            Project title
            <input
              name="name"
              required
              minLength={5}
              maxLength={80}
              value={draft.name}
              onChange={(event) => set("name")(event.target.value)}
            />
            <span className="micro muted">
              {draft.name.trim().length}/80 characters (minimum 5)
            </span>
          </label>
          <label className="field">
            The agreed creative brief
            <textarea
              name="brief"
              required
              minLength={20}
              maxLength={500}
              rows={5}
              value={draft.brief}
              onChange={(event) => set("brief")(event.target.value)}
            />
            <span className="micro muted">
              {draft.brief.trim().length}/500 characters (minimum 20)
            </span>
          </label>
          <label className="field">
            Fixed price (USD)
            <input
              name="amount"
              type="number"
              required
              min={1}
              max={5000}
              step={1}
              value={draft.amount}
              onChange={(event) => set("amount")(event.target.value)}
            />
          </label>
          {FIXED.map(([label, value]) => (
            <div className="field" key={label}>
              {label}
              <strong className="fixed-field">{value}</strong>
            </div>
          ))}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button">
            Review the sample quote ↗
          </button>
          <Link to="/quotes/sample-001" className="button secondary">
            Cancel · keep current quote
          </Link>
        </form>
      </Panel>
    </RoleRequired>
  );
}
