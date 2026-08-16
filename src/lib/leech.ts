// Anki's classic default leech threshold is 8. FSRS `lapses` counts the same
// thing (a Review -> Relearning transition), but 8 feels slow for exam-prep
// pacing — cards you're consistently missing are worth flagging well before
// then. Tune this single constant if 4 catches too much too early.
export const LEECH_THRESHOLD = 4;

export function isLeech(card: { lapses?: number | null }): boolean {
  return (card.lapses ?? 0) >= LEECH_THRESHOLD;
}