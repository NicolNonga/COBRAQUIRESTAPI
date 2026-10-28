import { MigrationInterface, QueryRunner } from "typeorm";

export class WidenOutboxRequestId1792961863295 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
      await queryRunner.query(
        `ALTER TABLE "outbox_messages" ALTER COLUMN "request_id" TYPE character varying(255)`,
      );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
      await queryRunner.query(
        `ALTER TABLE "outbox_messages" ALTER COLUMN "request_id" TYPE character varying(64)`,
      );
    }

}
