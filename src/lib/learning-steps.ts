/**
 * Anki-style learning steps: a fixed, ordered list of short delays a card
 * cycles through before "graduating" into the normal long-interval FSRS
 * schedule. This is deliberately a SEPARATE mechanism from FSRS's own
 * Learning/Relearning math (ts-fsrs computes its own short intervals
 * too) — the person asked for the Anki mechanism specifically: a step
 * list you walk forward/backward through, not a memory-model estimate.
 *
 * Everything here is session-local. Nothing in this file touches the
 * database — the card's real `due`/`stability`/etc. only change at the
 * two commit points review-session.tsx calls out to FSRS for: a new
 * card graduating, or a review card's very first lapse. Every step in
 * between is pure in-memory bookkeeping for "when does this reappear in
 * the current session."
 */

// Anki's own historical defaults — "1m 10m" for new cards, "10m" for a
// lapsed review card being relearned.
export const LEARNING_STEPS_MIN = [1, 10];
export const RELEARNING_STEPS_MIN = [10];

export type LearningPhase = "learning" | "relearning";

export type LearningStepState = {
  phase: LearningPhase;
  stepIndex: number;
  /** epoch ms — when this card should reappear in the session queue. */
  dueAt: number;
};

function stepsFor(phase: LearningPhase): number[] {
  return phase === "learning" ? LEARNING_STEPS_MIN : RELEARNING_STEPS_MIN;
}

export function startLearningStep(phase: LearningPhase, now: number): LearningStepState {
  const steps = stepsFor(phase);
  return { phase, stepIndex: 0, dueAt: now + (steps[0] ?? 1) * 60_000 };
}

/**
 * Apply one grading (ts-fsrs Rating: 1=Again 2=Hard 3=Good 4=Easy) to a
 * card currently mid-steps. Returns the updated state to keep tracking
 * session-locally, or `null` if the card graduates — at which point the
 * caller is responsible for the one real FSRS commit (learning) or simply
 * lets the card go quiet until its already-set long-term due (relearning).
 */
export function advanceLearningStep(
  state: LearningStepState,
  rating: number,
  now: number,
): { next: LearningStepState | null; graduated: boolean } {
  const steps = stepsFor(state.phase);

  if (rating === 4) {
    // Easy graduates immediately, regardless of which step you're on.
    return { next: null, graduated: true };
  }
  if (rating === 1) {
    // Again always resets to the first step.
    return {
      next: { ...state, stepIndex: 0, dueAt: now + (steps[0] ?? 1) * 60_000 },
      graduated: false,
    };
  }
  if (rating === 2) {
    // Hard repeats the current step's delay.
    return {
      next: { ...state, dueAt: now + (steps[state.stepIndex] ?? 1) * 60_000 },
      graduated: false,
    };
  }
  // Good: move to the next step, or graduate if this was the last one.
  const nextIndex = state.stepIndex + 1;
  if (nextIndex >= steps.length) {
    return { next: null, graduated: true };
  }
  return {
    next: { ...state, stepIndex: nextIndex, dueAt: now + (steps[nextIndex] ?? 1) * 60_000 },
    graduated: false,
  };
}