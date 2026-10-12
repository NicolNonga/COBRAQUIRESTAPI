import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './typeorm-config';

// DataSource usado pela CLI do TypeORM (migrações). `dotenv` vem com @nestjs/config.
config();
export default new DataSource(buildDataSourceOptions({ get: (k: string) => process.env[k] } as never));
