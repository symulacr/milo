import { useState } from "react";
import { RoleRequired } from "../components/gates";
import { PageTitle } from "../components/PageTitle";
import { Panel } from "../components/ui";
import { REVIEW_DEADLINE } from "../reviewDeadline";
import { quoteSchema, useWorkspace } from "../workspace/model";

export function NewQuote() {
  const { quote, reset, navigate } = useWorkspace();
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(() => ({
    ...quote,
    amount: String(quote.amount),
  }));
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
            reset("fresh", result.data);
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
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
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
              onChange={(event) =>
                setDraft({ ...draft, brief: event.target.value })
              }
            />
          </label>
          <div className="form-pair">
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
                onChange={(event) =>
                  setDraft({ ...draft, amount: event.target.value })
                }
              />
            </label>
            <div className="field">
              Deliverables
              <strong className="fixed-field">
                Exactly three final PNG images
              </strong>
            </div>
          </div>
          <div className="form-pair">
            <div className="field">
              Usage
              <strong className="fixed-field">
                Website and organic social
              </strong>
            </div>
            <div className="field">
              Review deadline
              <strong className="fixed-field">{REVIEW_DEADLINE}</strong>
            </div>
          </div>
          <div className="field">
            Resolution
            <strong className="fixed-field">
              Pre-agreed operator · full approval or cancellation
            </strong>
          </div>
          <p className="soft-note">
            Replaces the current sample order; nothing is sent.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button">
            Review the sample quote ↗
          </button>
        </form>
      </Panel>
    </RoleRequired>
  );
}
