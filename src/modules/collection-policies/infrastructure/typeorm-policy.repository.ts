import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { CollectionPolicy, PolicyInput, PolicyStepRule } from '../domain/policy';
import { PolicyRepository, ProcessLimits } from '../domain/policy.repository';

@Injectable()
export class TypeOrmPolicyRepository extends BaseTypeOrmRepository implements PolicyRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  get(): Promise<CollectionPolicy | null> {
    return this.load(false);
  }

  getForUpdate(): Promise<CollectionPolicy | null> {
    return this.load(true);
  }

  private async load(lock: boolean): Promise<CollectionPolicy | null> {
    const [p] = await this.manager.query(
      `SELECT name, description, version, grace_days AS "graceDays", max_collection_days AS "maxCollectionDays", max_steps AS "maxSteps",
              max_contacts_per_process AS "maxContactsPerProcess", allowed_debtor_channels AS "allowedDebtorChannels",
              min_days_between_debtor_messages AS "minDaysBetweenDebtorMessages", updated_at AS "updatedAt"
         FROM collection_policies WHERE id = 1 ${lock ? 'FOR UPDATE' : ''}`,
    );
    if (!p) return null;
    const rules: PolicyStepRule[] = await this.manager.query(
      `SELECT action_type AS "actionType", min_day AS "minDay", max_day AS "maxDay",
              max_fulfillment_days AS "maxFulfillmentDays", is_required AS "required"
         FROM collection_policy_step_rules WHERE policy_id = 1 ORDER BY action_type`,
    );
    return { ...p, rules };
  }

  async save(input: PolicyInput, updatedById: number): Promise<CollectionPolicy> {
    await this.manager.query(
      `INSERT INTO collection_policies (id, name, description, grace_days, max_collection_days, max_steps, max_contacts_per_process,
                                        allowed_debtor_channels, min_days_between_debtor_messages, updated_by_id)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, grace_days = EXCLUDED.grace_days,
         max_collection_days = EXCLUDED.max_collection_days, max_steps = EXCLUDED.max_steps,
         max_contacts_per_process = EXCLUDED.max_contacts_per_process, allowed_debtor_channels = EXCLUDED.allowed_debtor_channels,
         min_days_between_debtor_messages = EXCLUDED.min_days_between_debtor_messages, updated_by_id = EXCLUDED.updated_by_id,
         version = collection_policies.version + 1, updated_at = now()`,
      [input.name, input.description, input.graceDays, input.maxCollectionDays, input.maxSteps, input.maxContactsPerProcess,
        input.allowedDebtorChannels, input.minDaysBetweenDebtorMessages, updatedById],
    );
    await this.manager.query('DELETE FROM collection_policy_step_rules WHERE policy_id = 1');
    await this.manager.query(
      `INSERT INTO collection_policy_step_rules (policy_id, action_type, min_day, max_day, max_fulfillment_days, is_required)
       SELECT 1, a, mn, mx, f, r FROM unnest($1::text[], $2::int[], $3::int[], $4::int[], $5::boolean[]) AS x(a, mn, mx, f, r)`,
      [input.rules.map((r) => r.actionType), input.rules.map((r) => r.minDay), input.rules.map((r) => r.maxDay),
        input.rules.map((r) => r.maxFulfillmentDays), input.rules.map((r) => r.required)],
    );
    return (await this.load(false))!;
  }

  async limitsForProcess(processId: number): Promise<ProcessLimits | null> {
    const [r] = await this.manager.query(
      `SELECT p.contacts_count AS "contactsCount", cp.max_contacts_per_process AS "maxContactsPerProcess"
         FROM processes p LEFT JOIN collection_policies cp ON cp.id = 1
        WHERE p.id = $1 FOR UPDATE OF p`,
      [processId],
    );
    return r ?? null;
  }
}
