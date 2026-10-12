import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';
/** Exige que o perfil do utilizador tenha TODAS as permissões (slugs) indicadas. */
export const RequirePermissions = (...slugs: string[]) => SetMetadata(PERMISSIONS_KEY, slugs);
