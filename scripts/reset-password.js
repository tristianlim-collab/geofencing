const { readDb, writeDb } = require('../src/db');
const { hashPassword } = require('../src/utils');

const [, , loginId, newPassword] = process.argv;

if (!loginId || !newPassword) {
  // eslint-disable-next-line no-console
  console.log('Usage: node scripts/reset-password.js <username-or-studentId> <newPassword>');
  process.exit(1);
}

(async () => {
  const db = await readDb();
  const user = db.users.find(u => u.username === loginId || u.studentId === loginId);

  if (!user) {
    // eslint-disable-next-line no-console
    console.log(`No user found for "${loginId}".`);
    process.exit(1);
  }

  user.passwordHash = hashPassword(newPassword);
  db.sessions = db.sessions.filter(s => s.userId !== user.id);
  await writeDb(db);

  // eslint-disable-next-line no-console
  console.log(`Password reset success for ${user.role} account "${loginId}".`);
})().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err.message || err);
  process.exit(1);
});
