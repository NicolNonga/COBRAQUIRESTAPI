import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VisibilityChecker, VisibleResource } from '@/shared/application/visibility.port';
import { VisibilityScope } from '@/shared/domain/criteria';
import { invoiceVisibleSql, negotiationVisibleSql, processVisibleSql, scopeValue, userInScopeSql } from './visibility.sql';

const SQL: Record<VisibleResource, (scope: VisibilityScope) => string> = {
  process: (s) => processVisibleSql('t.id', s, '$1'),
  invoice: (s) => invoiceVisibleSql('t.id', '(SELECT v.created_by_id FROM invoices v WHERE v.id = t.id)', s, '$1'),
  negotiation: (s) => negotiationVisibleSql('t.id', '(SELECT v.created_by_id FROM negotiations v WHERE v.id = t.id)', s, '$1'),
  agent: (s) => userInScopeSql('t.id', s, '$1'),
};

@Injectable()
export class TypeOrmVisibilityChecker extends VisibilityChecker {
  constructor(@InjectDataSource() private readonly ds: DataSource) {
    super();
  }

  async allVisible(resource: VisibleResource, scope: VisibilityScope, ids: number[]): Promise<boolean> {
    const unique = [...new Set(ids)];
    if (scope.kind === 'ALL' || !unique.length) return true;
    const [r]: Array<{ n: number }> = await this.ds.query(
      `SELECT count(*)::int AS n FROM unnest($2::int[]) AS t(id) WHERE ${SQL[resource](scope)}`,
      [scopeValue(scope), unique],
    );
    return r.n === unique.length;
  }
}
