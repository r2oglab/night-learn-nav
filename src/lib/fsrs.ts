import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Grade,
  type Card,
} from "ts-fsrs";

export const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

/**
 * Convert an instant to the calendar date it falls on IN THE GIVEN
 * TIMEZONE, expressed as the offset `Date.prototype.getTimezoneOffset()`
 * returns in the browser (minutes to add to local time to reach UTC).
 *
 * `Date#toISOString()` always reads UTC digits. Calling that directly on a
 * freshly-scheduled card's `due` — as this codebase used to — reports
 * "tomorrow" for anyone west of UTC (Brazil included) once the server's UTC
 * clock has already rolled over, even though it's still today locally. A
 * card created at 22:00 in São Paulo landed with due date = tomorrow.
 */
export function toLocalDateString(date: Date, tzOffsetMinutes: number): string {
  const shifted = new Date(date.getTime() - tzOffsetMinutes * 60000);
  return shifted.toISOString().slice(0, 10);
}

export type CardRow = {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
};

export type DeckRow = CardRow;

export type CardFields = {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
};

export function rowToCard(row: CardRow): Card {
  const empty = createEmptyCard();
  return {
    ...empty,
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  } as Card;
}

export function cardToFields(card: Card, tzOffsetMinutes: number): CardFields {
  return {
    due: toLocalDateString(card.due, tzOffsetMinutes),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as number,
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

export function newCardFields(tzOffsetMinutes: number): CardFields {
  return cardToFields(createEmptyCard(), tzOffsetMinutes);
}

export function reviewCard(
  row: CardRow,
  rating: number,
  now: Date,
  tzOffsetMinutes: number,
  request_retention?: number,
): CardFields {
  const params: any = { enable_fuzz: true };
  if (typeof request_retention === "number") params.request_retention = request_retention;
  const localScheduler = fsrs(generatorParameters(params));
  // FSRS's own interval math runs on the true instant (`now`) — that part
  // was never wrong, elapsed time is elapsed time regardless of timezone.
  // Only the resulting due DATE needs the caller's local calendar.
  const result = localScheduler.next(rowToCard(row), now, rating as Grade);
  return cardToFields(result.card, tzOffsetMinutes);
}

export function previewIntervals(row: CardRow, now = new Date()) {
  const log = scheduler.repeat(rowToCard(row), now);
  return {
    [Rating.Again]: log[Rating.Again].card.due,
    [Rating.Hard]: log[Rating.Hard].card.due,
    [Rating.Good]: log[Rating.Good].card.due,
    [Rating.Easy]: log[Rating.Easy].card.due,
  } as Record<number, Date>;
}

export const stateLabels: Record<number, string> = {
  [State.New]: "Novo",
  [State.Learning]: "Aprendendo",
  [State.Review]: "Revisão",
  [State.Relearning]: "Reaprendendo",
};

export const ratingOptions = [
  { value: Rating.Again as number, label: "Errei", tone: "overdue" },
  { value: Rating.Hard as number, label: "Difícil", tone: "pending" },
  { value: Rating.Good as number, label: "Bom", tone: "primary" },
  { value: Rating.Easy as number, label: "Fácil", tone: "success" },
];
