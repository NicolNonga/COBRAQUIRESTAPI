import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let now = 0;
  const make = () => new CircuitBreaker('smtp', { failureThreshold: 3, openMs: 1000, maxOpenMs: 4000, now: () => now });
  const boom = () => Promise.reject(new Error('ECONNREFUSED'));
  const ok = () => Promise.resolve('ok');

  beforeEach(() => (now = 0));

  it('abre após N falhas seguidas e recusa sem chamar a dependência', async () => {
    const b = make();
    for (let i = 0; i < 3; i++) await expect(b.execute(boom)).rejects.toThrow('ECONNREFUSED');
    const fn = jest.fn(ok);
    await expect(b.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
    expect(b.snapshot().state).toBe('OPEN');
  });

  it('um sucesso pelo meio repõe o contador', async () => {
    const b = make();
    await expect(b.execute(boom)).rejects.toThrow();
    await expect(b.execute(boom)).rejects.toThrow();
    await b.execute(ok);
    await expect(b.execute(boom)).rejects.toThrow();
    expect(b.snapshot().state).toBe('CLOSED');
  });

  it('half-open: teste com sucesso fecha; com falha reabre com espera a dobrar', async () => {
    const b = make();
    for (let i = 0; i < 3; i++) await expect(b.execute(boom)).rejects.toThrow();
    now = 1000;
    expect(b.snapshot().state).toBe('HALF_OPEN');
    await expect(b.execute(boom)).rejects.toThrow('ECONNREFUSED');
    expect(b.snapshot().state).toBe('OPEN');
    expect(b.snapshot().retryAt!.getTime()).toBe(1000 + 2000);
    now = 3000;
    await expect(b.execute(ok)).resolves.toBe('ok');
    expect(b.snapshot().state).toBe('CLOSED');
  });

  it('half-open deixa passar só UMA chamada de teste em simultâneo', async () => {
    const b = make();
    for (let i = 0; i < 3; i++) await expect(b.execute(boom)).rejects.toThrow();
    now = 1000;
    let release!: () => void;
    const slow = b.execute(() => new Promise<void>((r) => (release = r)));
    await expect(b.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
    release();
    await slow;
    expect(b.snapshot().state).toBe('CLOSED');
  });

  it('erros do pedido (não da dependência) não abrem o circuito', async () => {
    const b = make();
    for (let i = 0; i < 5; i++) await expect(b.execute(boom, () => false)).rejects.toThrow();
    expect(b.snapshot().state).toBe('CLOSED');
  });
});
