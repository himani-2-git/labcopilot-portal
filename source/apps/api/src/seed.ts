import type { PrismaClient, Role } from '@prisma/client';
import { hashPassword } from './auth/crypto';
export const FACILITY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const FACILITY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const users: { id: string; username: string; displayName: string; role: Role; facilityId: string }[] = [
  { id: '11111111-1111-4111-8111-111111111111', username: 'clerk', displayName: 'Demo Registration Clerk', role: 'registration_clerk', facilityId: FACILITY_A },
  { id: '22222222-2222-4222-8222-222222222222', username: 'technician', displayName: 'Demo Technician', role: 'technician', facilityId: FACILITY_A },
  { id: '33333333-3333-4333-8333-333333333333', username: 'approver', displayName: 'Demo Qualified Approver', role: 'qualified_approver', facilityId: FACILITY_A },
  { id: '44444444-4444-4444-8444-444444444444', username: 'admin', displayName: 'Demo Administrator', role: 'administrator', facilityId: FACILITY_A },
  { id: '55555555-5555-4555-8555-555555555555', username: 'other-clerk', displayName: 'Demo Other Facility Clerk', role: 'registration_clerk', facilityId: FACILITY_B },
];
export async function seedDemoUsers(db: PrismaClient, password: string) {
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? '') || process.env.AUTH_MODE !== 'development') throw new Error('Demo seeding requires explicit development/test authentication mode.');
  if (password.length < 16) throw new Error('DEMO_PASSWORD must contain at least 16 characters. Generate it locally; never commit it.');
  await db.facility.upsert({ where: { id: FACILITY_A }, create: { id: FACILITY_A, name: 'Demo District Laboratory' }, update: { name: 'Demo District Laboratory' } });
  await db.facility.upsert({ where: { id: FACILITY_B }, create: { id: FACILITY_B, name: 'Demo Second Facility' }, update: { name: 'Demo Second Facility' } });
  for (const user of users) {
    await db.user.upsert({ where: { username: user.username }, create: { ...user, passwordHash: hashPassword(password) }, update: { displayName: user.displayName, role: user.role, facilityId: user.facilityId, passwordHash: hashPassword(password), active: true } });
  }
  // Re-seeding changes credentials and must invalidate previously issued sessions.
  await db.session.deleteMany({ where: { userId: { in: users.map(user => user.id) } } });
}
