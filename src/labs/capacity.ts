export function missBudgetMs(databaseDelay: number): number {
  return 280 + Math.max(0, databaseDelay);
}

export function capacityHint(input: {
  rate: number;
  concurrency: number;
  queue: number;
  queueLimit: number;
  missMs: number;
}): { text: string; over: boolean } {
  const slots = Math.max(0, Math.floor(input.concurrency));
  const missMs = Math.max(1, input.missMs);
  const sustainable = slots === 0 ? 0 : slots / (missMs / 1000);
  const waiting = `Waiting ${input.queue} of ${input.queueLimit}.`;
  if (slots === 0)
    return { over: true, text: `No backend is accepting work. ${waiting}` };
  const pace = `About ${slots} in flight, ~${Math.round(missMs)} ms per cache miss.`;
  if (input.rate > sustainable + 0.05)
    return {
      over: true,
      text: `${pace} ${input.rate} req/s is faster than that, so the queue grows before anything fails. ${waiting}`,
    };
  return {
    over: false,
    text: `${pace} ${input.rate} req/s fits that pace. ${waiting}`,
  };
}
