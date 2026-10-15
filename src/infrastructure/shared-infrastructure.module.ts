import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from '@/shared/application/clock.port';
import { FileStorage } from '@/shared/application/file-storage.port';
import { Mailer } from '@/shared/application/mailer.port';
import { PasswordHasher } from '@/shared/application/password-hasher.port';
import { VisibilityChecker } from '@/shared/application/visibility.port';
import { ContactRestrictions } from '@/shared/application/contact-restrictions.port';
import { TypeOrmContactRestrictions } from './database/typeorm-contact-restrictions';
import { TypeOrmVisibilityChecker } from './database/typeorm-visibility.checker';
import { LocalFileStorage } from './storage/local-file-storage';
import { NodemailerMailer } from './mail/nodemailer-mailer';
import { SendEmailHandler } from './mail/send-email.handler';
import { DebtorEmailHandler, DebtorSmsHandler } from './messaging/debtor-messages.handlers';
import { BcryptPasswordHasher } from './security/bcrypt-password-hasher';

/** Liga as portas transversais às suas implementações concretas (DIP). */
@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    { provide: FileStorage, useClass: LocalFileStorage },
    { provide: Mailer, useClass: NodemailerMailer },
    { provide: PasswordHasher, useClass: BcryptPasswordHasher },
    { provide: VisibilityChecker, useClass: TypeOrmVisibilityChecker },
    { provide: ContactRestrictions, useClass: TypeOrmContactRestrictions },
    SendEmailHandler,
    DebtorEmailHandler,
    DebtorSmsHandler,
  ],
  exports: [Clock, FileStorage, Mailer, PasswordHasher, VisibilityChecker, ContactRestrictions],
})
export class SharedInfrastructureModule {}
