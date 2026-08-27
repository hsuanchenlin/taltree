import { pointsLabel } from "./format";

interface BudgetBarProps {
  budget: number;
  spent: number;
  remaining: number;
  onBudgetChange: (value: number) => void;
}

export function BudgetBar({
  budget,
  spent,
  remaining,
  onBudgetChange,
}: BudgetBarProps) {
  const filled = Math.min(spent, budget);
  const over = Math.max(0, spent - budget);
  const ticks = Array.from({ length: budget }, (_, index) => index < filled);

  return (
    <div className="budget">
      <div className="budget-copy">
        <p className="budget-lede" aria-live="polite">
          {pointsLabel(remaining)} remaining of {pointsLabel(budget)}
          {spent > 0 ? ` · ${pointsLabel(spent)} spent` : ""}
          {over > 0 ? ` · ${pointsLabel(over)} over` : ""}
        </p>
        <label className="budget-field">
          Daily budget
          <input
            type="number"
            min={0}
            max={99}
            step={1}
            value={budget}
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              if (Number.isInteger(next)) onBudgetChange(next);
            }}
          />
        </label>
      </div>
      {budget > 0 ? (
        <ol className="budget-ticks" aria-hidden="true">
          {ticks.map((isSpent, index) => (
            <li key={index} className={isSpent ? "tick spent" : "tick open"} />
          ))}
        </ol>
      ) : (
        <p className="budget-zero">Budget is 0 today. Eligible work still appears; completing it will go over.</p>
      )}
    </div>
  );
}
