import { BusinessRuleError, ValidationError } from '@/shared/domain/errors';
import { DisputePolicy } from './invoice-dispute';

describe('DisputePolicy', () => {
  it('só facturas em aberto podem ser disputadas', () => {
    expect(() => DisputePolicy.assertDisputable('OVERDUE')).not.toThrow();
    expect(() => DisputePolicy.assertDisputable('IN_DISPUTE')).toThrow(BusinessRuleError);
    expect(() => DisputePolicy.assertDisputable('PAID')).toThrow(BusinessRuleError);
    expect(() => DisputePolicy.assertDisputable('CANCELLED')).toThrow(BusinessRuleError);
  });

  it('procedente: volta a Vencida (ou Em curso se ainda não venceu)', () => {
    expect(DisputePolicy.resolve('UPHELD', '100.00', undefined, '2026-09-01', '2026-10-06')).toEqual({ stateAfter: 'OVERDUE', newAmount: null });
    expect(DisputePolicy.resolve('UPHELD', '100.00', undefined, '2026-12-01', '2026-10-06')).toEqual({ stateAfter: 'IN_PROGRESS', newAmount: null });
  });

  it('anulada: Cancelada', () => {
    expect(DisputePolicy.resolve('CANCELLED', '100.00', undefined, '2026-09-01', '2026-10-06').stateAfter).toBe('CANCELLED');
  });

  it('valor corrigido: exige novo valor positivo e diferente', () => {
    expect(DisputePolicy.resolve('ADJUSTED', '100.00', '80', '2026-09-01', '2026-10-06')).toEqual({ stateAfter: 'OVERDUE', newAmount: '80.00' });
    expect(() => DisputePolicy.resolve('ADJUSTED', '100.00', undefined, '2026-09-01', '2026-10-06')).toThrow(ValidationError);
    expect(() => DisputePolicy.resolve('ADJUSTED', '100.00', '100.00', '2026-09-01', '2026-10-06')).toThrow(ValidationError);
    expect(() => DisputePolicy.resolve('ADJUSTED', '100.00', '0', '2026-09-01', '2026-10-06')).toThrow(ValidationError);
    expect(() => DisputePolicy.resolve('UPHELD', '100.00', '50', '2026-09-01', '2026-10-06')).toThrow(ValidationError);
  });
});
