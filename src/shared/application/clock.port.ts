/** Abstracção de tempo para tornar as regras dependentes de data testáveis. */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
