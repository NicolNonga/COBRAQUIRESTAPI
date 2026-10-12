export interface AuthenticatedUser {
  id: number;
  email: string;
  roleId: number | null;
  organizationId: number | null;
  isManager: boolean;
  permissions: string[];
}
