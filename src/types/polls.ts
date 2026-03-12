/** Shared form types used by poll creation and editing screens. */

export type DateRange = { start: Date; end: Date };

export type BudgetRange = {
  id: string;
  label: string;
  /** Upper bound in dollars; null = "above X" (last tier). */
  max: number | null;
  selected: boolean;
  /** True when the user has manually edited the label. */
  labelOverridden: boolean;
};

export type CustomPoll = {
  id: string;
  /** Set when loaded from the DB (existing draft). */
  pollId?: string;
  /** undefined = brand-new, not yet saved. */
  status?: 'draft' | 'live' | 'decided';
  question: string;
  options: string[];
  allowMulti: boolean;
};
