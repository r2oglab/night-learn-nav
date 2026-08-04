import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
} from "ts-fsrs";

export const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export type ThemeRow = {
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

export const ratings = [
  { value: Rating.Again, label: "Errei" },
  { value: Rating.Hard: 0 as never, label: "" },
] as const;

export function rowToCard(row: ThemeRow): Card {
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

export function cardToFields(card: Card): CardFields {
  return {
    due: card.due.toISOString().slice(0, 10),
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

export function newCardFields(): CardFields {
  return cardToFields(createEmptyCard());
}

export function reviewCard(row: ThemeRow, rating: number, now = new Date()): CardFields {
  const result = scheduler.next(rowToCard(row), now, rating as Rating);
  return cardToFields(result.card);
}

export function previewIntervals(row: ThemeRow, now = new Date()) {
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
