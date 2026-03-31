import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create default tenant
  const tenant = await prisma.tenant.upsert({
    where: { id: 'default-tenant-id' },
    update: {},
    create: {
      id: 'default-tenant-id',
      name: 'Default Tenant',
    },
  });
  console.log('Tenant created:', tenant.name);

  // Create super admin user
  const hashed = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {
      password: hashed,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      campaignsEnabled: true,
      tenantId: tenant.id,
      accountExpiresAt: null,
    },
    create: {
      email: 'admin@example.com',
      password: hashed,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      campaignsEnabled: true,
      tenantId: tenant.id,
    },
  });
  console.log('Super admin user upserted:', admin.email);
  console.log('\nDefault credentials:');
  console.log('  Email: admin@example.com');
  console.log('  Password: admin123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
