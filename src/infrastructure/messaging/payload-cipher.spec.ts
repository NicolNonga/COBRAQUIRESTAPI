import { PayloadCipher } from './payload-cipher';

describe('PayloadCipher', () => {
  const cipher = new PayloadCipher({ getOrThrow: () => 'a'.repeat(64) } as never);
  it('cifra e decifra (AES-256-GCM)', () => {
    const box = cipher.encrypt({ to: 'x@y.ao', text: 'palavra-passe: Abc123' });
    expect(box.data).not.toContain('Abc123');
    expect(cipher.decrypt(box)).toEqual({ to: 'x@y.ao', text: 'palavra-passe: Abc123' });
  });
  it('detecta adulteração', () => {
    const box = cipher.encrypt({ a: 1 });
    const raw = Buffer.from(box.data, 'base64');
    raw[raw.length - 1] ^= 1;
    expect(() => cipher.decrypt({ data: raw.toString('base64') })).toThrow();
  });
});
