/** Data de calendário em Luanda (YYYY-MM-DD), independentemente do fuso do servidor. */
export const luandaToday = (now: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Luanda', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
