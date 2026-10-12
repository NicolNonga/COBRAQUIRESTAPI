import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CollectionLaddersController } from '../src/modules/collection-ladders/presentation/collection-ladders.controller';
import { InvoicesController } from '../src/modules/invoices/presentation/invoices.controller';
import { DebtorsController } from '../src/modules/debtors/presentation/debtors.controller';
import { ContactsController, ProcessesController } from '../src/modules/processes/presentation/processes.controller';
import { NegotiationsController } from '../src/modules/negotiations/presentation/negotiations.controller';
import { UsersController } from '../src/modules/users/presentation/users.controller';
import { OrganizationsController } from '../src/modules/organizations/presentation/organizations.controller';

(async () => {
  const mod = await Test.createTestingModule({
    controllers: [CollectionLaddersController, ContactsController, InvoicesController, DebtorsController, ProcessesController, NegotiationsController, UsersController, OrganizationsController],
  }).useMocker(() => ({})).compile();
  const app = mod.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  for (const p of ['/api/contacts', '/api/contacts/process/{processId}', '/api/invoices', '/api/invoices/overdue', '/api/debtors', '/api/process', '/api/negotiations', '/api/users', '/api/organization']) {
    const params = (doc.paths[p]?.get?.parameters ?? []) as Array<{ name: string }>;
    console.log(p); for (const x of params as any[]) console.log('   ', x.name.padEnd(15), JSON.stringify({ ...x.schema, ...(x.description ? { d: x.description.slice(0, 70) } : {}) }));
  }
  await app.close();
})();
