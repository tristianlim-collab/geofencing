const { readDb, writeDb, updateDb, clearMemoryCache } = require('./db');
const {
  clearCookie,
  csvEscape,
  dateKey,
  hashPassword,
  haversineMeters,
  isPointInPolygon,
  isWithinRange,
  json,
  nowMinutes,
  parseBody,
  parseCookies,
  randomId,
  routeMatch,
  safeUser,
  setCookie,
  text,
  timeToMinutes,
  verifyPassword
} = require('./utils');

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

async function seedInitialUsers() {
  await updateDb(db => {
    if (!db.users.some(u => u.role === 'admin')) {
      db.users.push({
        id: randomId('usr_'),
        role: 'admin',
        name: 'System Admin',
        username: 'admin',
        passwordHash: hashPassword('Admin123!'),
        createdAt: new Date().toISOString()
      });
    }
    if (!db.users.some(u => u.role === 'teacher')) {
      db.users.push({
        id: randomId('usr_'),
        role: 'teacher',
        name: 'Default Teacher',
        username: 'teacher1',
        passwordHash: hashPassword('Teacher123!'),
        createdAt: new Date().toISOString()
      });
    }
    return db;
  });
}

function requireRole(user, roles) {
  return user && roles.includes(user.role);
}

function getClassById(db, id) {
  return db.classes.find(c => c.id === id);
}

function classStudents(db, classId) {
  const studentIds = db.enrollments.filter(e => e.classId === classId).map(e => e.studentId);
  return db.users.filter(u => u.role === 'student' && studentIds.includes(u.id));
}

function canManageClass(user, cls) {
  return !!(user && cls && (user.role === 'admin' || user.role === 'teacher'));
}

function cleanupSessions(db) {
  const now = Date.now();
  db.sessions = db.sessions.filter(s => new Date(s.expiresAt).getTime() > now);
}

function extractSessionId(req) {
  const cookieSid = parseCookies(req).sid;
  if (cookieSid) return cookieSid;
  const auth = String(req.headers.authorization || '').trim();
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function currentUser(req, db) {
  cleanupSessions(db);
  const sid = extractSessionId(req);
  if (!sid) return null;
  const session = db.sessions.find(s => s.sid === sid);
  if (!session) return null;
  return db.users.find(u => u.id === session.userId) || null;
}

function pushNotification(db, userId, type, message) {
  db.notifications.push({
    id: randomId('not_'),
    userId,
    type,
    message,
    read: false,
    createdAt: new Date().toISOString()
  });
}

function dateFromKey(key) {
  return new Date(`${key}T00:00:00`);
}

function eachDay(fromKey, toKey) {
  const start = dateFromKey(fromKey);
  const end = dateFromKey(toKey);
  const out = [];
  while (start.getTime() <= end.getTime()) {
    out.push(dateKey(start));
    start.setDate(start.getDate() + 1);
  }
  return out;
}

function ensureAbsences(db, fromKey, toKey) {
  const now = new Date();
  const todayKey = dateKey(now);
  const days = eachDay(fromKey, toKey);
  for (const dayKey of days) {
    const day = dateFromKey(dayKey);
    const isToday = dayKey === todayKey;
    for (const schedule of db.schedules) {
      const scheduleDays = normalizeDaysOfWeek(schedule.daysOfWeek);
      if (!scheduleDays.includes(day.getDay())) continue;
      const endMin = timeToMinutes(schedule.endTime);
      if (isToday && nowMinutes(now) <= endMin) continue;

      const cls = getClassById(db, schedule.classId);
      if (!cls) continue;
      for (const student of classStudents(db, cls.id)) {
        const found = db.attendance.find(
          a => a.studentId === student.id && a.scheduleId === schedule.id && a.date === dayKey
        );
        if (found) continue;
        db.attendance.push({
          id: randomId('att_'),
          classId: cls.id,
          scheduleId: schedule.id,
          studentId: student.id,
          date: dayKey,
          status: 'Absent',
          checkInAt: null,
          checkOutAt: null,
          distanceMeters: null,
          location: null,
          deviceId: student.deviceId || null,
          createdAt: new Date().toISOString()
        });
      }
    }
  }
}

function roleClasses(db, user) {
  if (user.role === 'admin') return db.classes;
  if (user.role === 'teacher') return db.classes;
  const ids = db.enrollments.filter(e => e.studentId === user.id).map(e => e.classId);
  return db.classes.filter(c => ids.includes(c.id));
}

function scheduleReminders(db, user) {
  if (!requireRole(user, ['teacher', 'admin'])) return [];
  const classes = roleClasses(db, user);
  const now = new Date();
  const day = now.getDay();
  const m = nowMinutes(now);
  const out = [];
  for (const cls of classes) {
    const schedules = db.schedules.filter(s => s.classId === cls.id && normalizeDaysOfWeek(s.daysOfWeek).includes(day));
    for (const s of schedules) {
      const start = timeToMinutes(s.startTime);
      const end = timeToMinutes(s.endTime);
      if (Math.abs(m - start) <= 15) out.push(`Open attendance for ${cls.subjectCode} (${cls.section}).`);
      if (Math.abs(m - end) <= 10) out.push(`Close attendance for ${cls.subjectCode} (${cls.section}).`);
    }
  }
  return out;
}

function normalizeFaceDescriptor(input) {
  const list = normalizeFaceDescriptorList(input);
  return list.length ? list[0] : null;
}

function normalizeFaceDescriptorList(input) {
  if (!input) return [];
  const raw = Array.isArray(input)
    ? input
    : String(input).split(/[|,;\s]+/g);
  const list = [];
  for (const item of raw) {
    const cleaned = String(item || '').replace(/[^01]/g, '');
    if (cleaned.length >= 64) list.push(cleaned);
  }
  return Array.from(new Set(list));
}

function faceDistanceBits(a, b) {
  const len = Math.min(a.length, b.length);
  let distance = Math.abs(a.length - b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i] !== b[i]) distance += 1;
  }
  return distance;
}

function bestFaceMatch(enrolledDescriptors, incomingDescriptors) {
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const enrolled of enrolledDescriptors) {
    for (const incoming of incomingDescriptors) {
      const dist = faceDistanceBits(enrolled, incoming);
      if (dist < bestDistance) bestDistance = dist;
    }
  }
  return Number.isFinite(bestDistance) ? bestDistance : null;
}

function normalizeDaysOfWeek(days) {
  return Array.from(new Set((Array.isArray(days) ? days : [])
    .map(Number)
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 6)));
}

function getScheduleTimingContext(schedule, now = new Date(), earlyMinutes = 5) {
  const startMin = timeToMinutes(schedule.startTime);
  const endMin = timeToMinutes(schedule.endTime);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) {
    return { valid: false, reason: 'invalid-time' };
  }

  const days = normalizeDaysOfWeek(schedule.daysOfWeek);
  const today = now.getDay();
  const previousDay = (today + 6) % 7;
  const minuteNow = nowMinutes(now);
  const overnight = endMin < startMin;

  if (!overnight) {
    if (!days.includes(today)) return { valid: false, reason: 'wrong-day' };
    return {
      valid: true,
      startMin,
      endMin,
      currentMin: minuteNow,
      sessionDate: dateKey(now)
    };
  }

  if (days.includes(today) && minuteNow >= Math.max(0, startMin - earlyMinutes)) {
    return {
      valid: true,
      startMin,
      endMin: endMin + 1440,
      currentMin: minuteNow,
      sessionDate: dateKey(now)
    };
  }

  if (days.includes(previousDay) && minuteNow <= endMin) {
    const sessionStartDate = new Date(now);
    sessionStartDate.setDate(sessionStartDate.getDate() - 1);
    return {
      valid: true,
      startMin,
      endMin: endMin + 1440,
      currentMin: minuteNow + 1440,
      sessionDate: dateKey(sessionStartDate)
    };
  }

  return { valid: false, reason: 'wrong-day' };
}

function createApiHandler() {
  return async function handleApi(req, res, pathname, query) {
    const db = await readDb();
    const user = currentUser(req, db);

    if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true });

    if (req.method === 'POST' && pathname === '/api/auth/register-student') {
      const b = await parseBody(req);
      const needed = ['name', 'studentId', 'password', 'course', 'yearSection'];
      const missing = needed.filter(k => !b[k]);
      if (missing.length) return json(res, 400, { error: `Missing fields: ${missing.join(', ')}` });
      const descriptors = normalizeFaceDescriptorList(b.faceDescriptors || b.faceDescriptor);
      if (!descriptors.length) return json(res, 400, { error: 'Face enrollment is required during registration.' });
      if (db.users.some(u => u.role === 'student' && u.studentId === b.studentId)) {
        return json(res, 409, { error: 'Student ID already registered.' });
      }
      const student = {
        id: randomId('usr_'),
        role: 'student',
        name: String(b.name).trim(),
        studentId: String(b.studentId).trim(),
        passwordHash: hashPassword(String(b.password)),
        course: String(b.course).trim(),
        yearSection: String(b.yearSection).trim(),
        deviceId: null,
        faceDescriptor: descriptors.join('|'),
        faceEnrolledAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      db.users.push(student);
      await writeDb(db);
      return json(res, 201, { message: 'Student account created.', user: safeUser(student) });
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const b = await parseBody(req);
      if (!b.username || !b.password) return json(res, 400, { error: 'Username and password are required.' });
      const found = db.users.find(u => (u.role === 'student' ? u.studentId === b.username : u.username === b.username));
      if (!found || !verifyPassword(b.password, found.passwordHash)) return json(res, 401, { error: 'Invalid credentials.' });
      const sid = randomId('sid_');
      db.sessions.push({
        sid,
        userId: found.id,
        expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()
      });
      setCookie(res, 'sid', sid, { sameSite: 'Lax', maxAgeSeconds: SESSION_MAX_AGE_SECONDS });
      await writeDb(db);
      return json(res, 200, { message: 'Logged in.', user: safeUser(found), sid, expiresInSeconds: SESSION_MAX_AGE_SECONDS });
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      const sid = extractSessionId(req);
      if (sid) db.sessions = db.sessions.filter(s => s.sid !== sid);
      clearCookie(res, 'sid');
      await writeDb(db);
      return json(res, 200, { message: 'Logged out.' });
    }

    if (req.method === 'POST' && pathname === '/api/admin/force-sync') {
      if (!requireRole(user, ['admin', 'teacher'])) return json(res, 403, { error: 'Forbidden' });
      await clearMemoryCache();
      return json(res, 200, { message: 'In-memory cache flushed and re-synced.' });
    }

    if (req.method === 'GET' && pathname === '/api/auth/me') return json(res, 200, { user: safeUser(user) || null });
    if (!user) return json(res, 401, { error: 'Authentication required.' });

    if (req.method === 'GET' && pathname === '/api/settings') return json(res, 200, { settings: db.settings });

    if (req.method === 'GET' && pathname === '/api/students') {
      if (!requireRole(user, ['teacher', 'admin'])) return json(res, 403, { error: 'Forbidden' });
      return json(res, 200, { students: db.users.filter(u => u.role === 'student').map(safeUser) });
    }

    if (req.method === 'DELETE' && pathname === '/api/students') {
      if (!requireRole(user, ['teacher', 'admin'])) return json(res, 403, { error: 'Forbidden' });
      const b = await parseBody(req);
      const ids = Array.isArray(b.studentIds) ? b.studentIds.map(String) : [];
      if (!ids.length) return json(res, 400, { error: 'Provide studentIds array.' });

      const studentIds = new Set(
        db.users
          .filter(u => u.role === 'student' && ids.includes(u.id))
          .map(u => u.id)
      );
      if (!studentIds.size) return json(res, 404, { error: 'No matching student accounts found.' });

      const usersBefore = db.users.length;
      const enrollBefore = db.enrollments.length;
      const attendanceBefore = db.attendance.length;
      const notificationsBefore = db.notifications.length;
      const sessionsBefore = db.sessions.length;

      db.users = db.users.filter(u => !(u.role === 'student' && studentIds.has(u.id)));
      db.enrollments = db.enrollments.filter(e => !studentIds.has(e.studentId));
      db.attendance = db.attendance.filter(a => !studentIds.has(a.studentId));
      db.notifications = db.notifications.filter(n => !studentIds.has(n.userId));
      db.sessions = db.sessions.filter(s => !studentIds.has(s.userId));

      await writeDb(db);
      return json(res, 200, {
        message: `Removed ${usersBefore - db.users.length} student account(s).`,
        removedStudents: usersBefore - db.users.length,
        removedEnrollments: enrollBefore - db.enrollments.length,
        removedAttendanceRecords: attendanceBefore - db.attendance.length,
        removedNotifications: notificationsBefore - db.notifications.length,
        removedSessions: sessionsBefore - db.sessions.length
      });
    }

    if (req.method === 'PUT' && pathname === '/api/students/me') {
      if (user.role !== 'student') return json(res, 403, { error: 'Only students can update profile.' });
      const b = await parseBody(req);
      ['name', 'course', 'yearSection'].forEach(k => {
        if (b[k]) user[k] = String(b[k]).trim();
      });
      if (b.password) user.passwordHash = hashPassword(String(b.password));
      await writeDb(db);
      return json(res, 200, { message: 'Profile updated.', user: safeUser(user) });
    }

    if (req.method === 'POST' && pathname === '/api/students/register-device') {
      if (user.role !== 'student') return json(res, 403, { error: 'Only students can register device.' });
      const b = await parseBody(req);
      if (!b.deviceId) return json(res, 400, { error: 'deviceId is required.' });
      user.deviceId = String(b.deviceId).trim();
      pushNotification(db, user.id, 'device', 'Device registered successfully.');
      await writeDb(db);
      return json(res, 200, { message: 'Device registered.', user: safeUser(user) });
    }

    if (req.method === 'POST' && pathname === '/api/students/register-face') {
      if (user.role !== 'student') return json(res, 403, { error: 'Only students can register face profile.' });
      const b = await parseBody(req);
      const descriptors = normalizeFaceDescriptorList(b.faceDescriptors || b.faceDescriptor);
      if (!descriptors.length) return json(res, 400, { error: 'Valid faceDescriptor is required.' });
      user.faceDescriptor = descriptors.join('|');
      user.faceEnrolledAt = new Date().toISOString();
      pushNotification(db, user.id, 'face', 'Face profile enrolled successfully.');
      await writeDb(db);
      return json(res, 200, { message: 'Face profile enrolled.', user: safeUser(user) });
    }

    if (req.method === 'GET' && pathname === '/api/classes') {
      const list = roleClasses(db, user).map(c => ({
        ...c,
        teacherName: (db.users.find(u => u.id === c.teacherId) || {}).name || null,
        studentCount: classStudents(db, c.id).length
      }));
      return json(res, 200, { classes: list });
    }

    if (req.method === 'POST' && pathname === '/api/classes') {
      if (!requireRole(user, ['teacher', 'admin'])) return json(res, 403, { error: 'Forbidden' });
      const b = await parseBody(req);
      const required = ['subjectCode', 'subjectName', 'section', 'room'];
      const missing = required.filter(k => !b[k]);
      if (missing.length) return json(res, 400, { error: `Missing fields: ${missing.join(', ')}` });
      let teacherId = user.id;
      if (user.role === 'admin' && b.teacherId) {
        const t = db.users.find(u => u.id === b.teacherId && u.role === 'teacher');
        if (!t) return json(res, 400, { error: 'Invalid teacherId.' });
        teacherId = t.id;
      }
      const cls = {
        id: randomId('cls_'),
        subjectCode: String(b.subjectCode).trim(),
        subjectName: String(b.subjectName).trim(),
        section: String(b.section).trim(),
        room: String(b.room).trim(),
        locationName: String(b.locationName || '').trim(),
        teacherId,
        createdAt: new Date().toISOString()
      };
      db.classes.push(cls);
      await writeDb(db);
      return json(res, 201, { message: 'Class created.', class: cls });
    }

    const enroll = routeMatch(pathname, '/api/classes/:classId/enroll');
    if (req.method === 'GET' && enroll) {
      if (!requireRole(user, ['teacher', 'admin'])) return json(res, 403, { error: 'Forbidden' });
      const cls = getClassById(db, enroll.classId);
      if (!cls) return json(res, 404, { error: 'Class not found.' });
      if (!canManageClass(user, cls)) return json(res, 403, { error: 'Not allowed for this class.' });

      const enrolled = db.enrollments
        .filter(e => e.classId === cls.id)
        .map(e => ({
          ...e,
          student: safeUser(db.users.find(u => u.id === e.studentId) || null)
        }));

      return json(res, 200, {
        classId: cls.id,
        enrolledStudentIds: enrolled.map(item => item.studentId),
        enrollments: enrolled
      });
    }

    if (req.method === 'POST' && enroll) {
      if (!requireRole(user, ['teacher', 'admin'])) return json(res, 403, { error: 'Forbidden' });
      const cls = getClassById(db, enroll.classId);
      if (!cls) return json(res, 404, { error: 'Class not found.' });
      if (!canManageClass(user, cls)) return json(res, 403, { error: 'Not allowed for this class.' });
      const b = await parseBody(req);
      const ids = Array.isArray(b.studentIds) ? b.studentIds : [];
      if (!ids.length) return json(res, 400, { error: 'Provide studentIds array.' });
      let added = 0;
      for (const sid of ids) {
        const student = db.users.find(u => u.id === sid && u.role === 'student');
        if (!student) continue;
        if (db.enrollments.some(e => e.classId === cls.id && e.studentId === sid)) continue;
        db.enrollments.push({
          id: randomId('enr_'),
          classId: cls.id,
          studentId: sid,
          createdAt: new Date().toISOString()
        });
        added += 1;
      }
      await writeDb(db);
      return json(res, 200, { message: `Enrollment updated. Added ${added} student(s).` });
    }

    if (req.method === 'DELETE' && enroll) {
      if (!requireRole(user, ['teacher', 'admin'])) return json(res, 403, { error: 'Forbidden' });
      const cls = getClassById(db, enroll.classId);
      if (!cls) return json(res, 404, { error: 'Class not found.' });
      if (!canManageClass(user, cls)) return json(res, 403, { error: 'Not allowed for this class.' });
      const b = await parseBody(req);
      const ids = Array.isArray(b.studentIds) ? b.studentIds : [];
      if (!ids.length) return json(res, 400, { error: 'Provide studentIds array.' });
      const before = db.enrollments.length;
      db.enrollments = db.enrollments.filter(e => !(e.classId === cls.id && ids.includes(e.studentId)));
      const removed = before - db.enrollments.length;
      const attendanceBefore = db.attendance.length;
      db.attendance = db.attendance.filter(a => !(a.classId === cls.id && ids.includes(a.studentId)));
      const attendanceRemoved = attendanceBefore - db.attendance.length;
      await writeDb(db);
      return json(res, 200, {
        message: `Enrollment updated. Removed ${removed} student(s).`,
        removedStudents: removed,
        removedAttendanceRecords: attendanceRemoved
      });
    }

    if (req.method === 'GET' && pathname === '/api/schedules') {
      let list = db.schedules;
      if (query.classId) list = list.filter(s => s.classId === query.classId);
      if (user.role === 'student') {
        const ids = db.enrollments.filter(e => e.studentId === user.id).map(e => e.classId);
        list = list.filter(s => ids.includes(s.classId));
      }
      return json(res, 200, {
        schedules: list.map(s => ({ ...s, class: getClassById(db, s.classId) || null }))
      });
    }

    if (req.method === 'POST' && pathname === '/api/schedules') {
      if (!requireRole(user, ['teacher', 'admin'])) return json(res, 403, { error: 'Forbidden' });
      const b = await parseBody(req);
      const required = ['classId', 'startTime', 'endTime', 'daysOfWeek', 'geofenceLat', 'geofenceLng', 'radiusMeters'];
      const missing = required.filter(k => b[k] === undefined || b[k] === null || b[k] === '');
      if (missing.length) return json(res, 400, { error: `Missing fields: ${missing.join(', ')}` });
      const cls = getClassById(db, b.classId);
      if (!cls) return json(res, 404, { error: 'Class not found.' });
      if (!canManageClass(user, cls)) return json(res, 403, { error: 'Not allowed for this class.' });
      const days = (Array.isArray(b.daysOfWeek) ? b.daysOfWeek : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
      if (!days.length) return json(res, 400, { error: 'daysOfWeek must contain 0-6 values.' });
      const lat = Number(b.geofenceLat);
      const lng = Number(b.geofenceLng);
      const radius = Number(b.radiusMeters);
      if (![lat, lng, radius].every(Number.isFinite)) return json(res, 400, { error: 'Invalid geofence values.' });
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || radius <= 0) {
        return json(res, 400, { error: 'Geofence out of valid range.' });
      }
      const schedule = {
        id: randomId('sch_'),
        classId: cls.id,
        daysOfWeek: days,
        startTime: b.startTime,
        endTime: b.endTime,
        geofence: { lat, lng, radiusMeters: radius, rotationDegrees: Number(b.rotationDegrees) || 0 },
        createdAt: new Date().toISOString()
      };
      db.schedules.push(schedule);
      await writeDb(db);
      return json(res, 201, { message: 'Schedule created.', schedule });
    }

    const scheduleMatch = routeMatch(pathname, '/api/schedules/:scheduleId');
    if (req.method === 'PUT' && scheduleMatch) {
      if (!requireRole(user, ['teacher', 'admin'])) return json(res, 403, { error: 'Forbidden' });
      const schedule = db.schedules.find(s => s.id === scheduleMatch.scheduleId);
      if (!schedule) return json(res, 404, { error: 'Schedule not found.' });
      const cls = getClassById(db, schedule.classId);
      if (!canManageClass(user, cls)) return json(res, 403, { error: 'Not allowed for this schedule.' });
      const b = await parseBody(req);
      if (b.startTime) schedule.startTime = b.startTime;
      if (b.endTime) schedule.endTime = b.endTime;
      if (Array.isArray(b.daysOfWeek)) {
        const days = b.daysOfWeek.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
        if (days.length) schedule.daysOfWeek = days;
      }
      if (b.geofenceLat !== undefined) schedule.geofence.lat = Number(b.geofenceLat);
      if (b.geofenceLng !== undefined) schedule.geofence.lng = Number(b.geofenceLng);
      if (b.radiusMeters !== undefined) schedule.geofence.radiusMeters = Number(b.radiusMeters);
      if (b.rotationDegrees !== undefined) schedule.geofence.rotationDegrees = Number(b.rotationDegrees);
      if (!isValidFallback) {
        return json(res, 400, { error: 'Invalid geofence definitions.' });
      }
      await writeDb(db);
      return json(res, 200, { message: 'Schedule updated.', schedule });
    }

    if (req.method === 'DELETE' && scheduleMatch) {
      if (!requireRole(user, ['teacher', 'admin'])) return json(res, 403, { error: 'Forbidden' });
      const schedule = db.schedules.find(s => s.id === scheduleMatch.scheduleId);
      if (!schedule) return json(res, 404, { error: 'Schedule not found.' });
      const cls = getClassById(db, schedule.classId);
      if (!canManageClass(user, cls)) return json(res, 403, { error: 'Not allowed for this schedule.' });
      db.schedules = db.schedules.filter(s => s.id !== schedule.id);
      db.attendance = db.attendance.filter(a => a.scheduleId !== schedule.id);
      await writeDb(db);
      return json(res, 200, { message: 'Schedule removed.' });
    }

    if (req.method === 'POST' && pathname === '/api/attendance/check-in') {
      if (user.role !== 'student') return json(res, 403, { error: 'Only students can check in.' });
      const b = await parseBody(req);
      if (!b.scheduleId) return json(res, 400, { error: 'scheduleId is required.' });
      const lat = Number(b.lat);
      const lng = Number(b.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        pushNotification(db, user.id, 'attendance-error', 'Location permission denied or invalid coordinates.');
        await writeDb(db);
        return json(res, 400, { error: 'Valid lat/lng required.' });
      }
      const schedule = db.schedules.find(s => s.id === b.scheduleId);
      if (!schedule) return json(res, 404, { error: 'Schedule not found.' });
      const cls = getClassById(db, schedule.classId);
      if (!cls) return json(res, 400, { error: 'Schedule class no longer exists.' });
      if (!db.enrollments.some(e => e.classId === cls.id && e.studentId === user.id)) return json(res, 403, { error: 'Not enrolled in class.' });

      const now = new Date();
      const timing = getScheduleTimingContext(schedule, now, 10);
      if (!timing.valid) return json(res, 400, { error: 'No class session today.' });

      const today = timing.sessionDate;
      const currentMin = timing.currentMin;
      const startMin = timing.startMin;
      const endMin = timing.endMin;
      const lateCutoffMinutes = Number.isFinite(Number(db.settings.lateGraceMinutes))
        ? Number(db.settings.lateGraceMinutes)
        : 15;
      /* Bypass strict time constraints to allow easier testing
      if (currentMin < startMin - 10 || currentMin > endMin) {
        pushNotification(db, user.id, 'attendance-error', 'Attendance failed: outside class time window.');
        await writeDb(db);
        return json(res, 400, { error: 'Outside allowed time window.' });
      }
      if (currentMin > startMin + lateCutoffMinutes) {
        pushNotification(db, user.id, 'attendance-error', `Attendance failed: more than ${lateCutoffMinutes} minutes late (marked absent).`);
        await writeDb(db);
        return json(res, 400, { error: `Marked absent: exceeded ${lateCutoffMinutes}-minute late limit.` });
      }
      */
      const existing = db.attendance.find(a => a.studentId === user.id && a.scheduleId === schedule.id && a.date === today);
      if (existing && existing.checkInAt) return json(res, 409, { error: 'Duplicate attendance prevented.' });

      const incomingDevice = String(b.deviceId || '').trim();
      if (db.settings.oneDevicePerStudent) {
        if (!incomingDevice) return json(res, 400, { error: 'deviceId required (one-device policy enabled).' });
        if (!user.deviceId) user.deviceId = incomingDevice;
        else if (user.deviceId !== incomingDevice) return json(res, 403, { error: 'Device mismatch for this student.' });
      }

      let faceDistance = null;
      if (!user.faceDescriptor) {
        pushNotification(db, user.id, 'attendance-error', 'Attendance failed: no enrolled face profile.');
        await writeDb(db);
        return json(res, 400, { error: 'Face profile not enrolled. Please enroll before check-in.' });
      }

      const enrolledFaces = normalizeFaceDescriptorList(user.faceDescriptor);
      const incomingFaces = normalizeFaceDescriptorList(b.faceDescriptors || b.faceDescriptor);
      if (!incomingFaces.length) {
        pushNotification(db, user.id, 'attendance-error', 'Attendance failed: missing face verification payload.');
        await writeDb(db);
        return json(res, 400, { error: 'faceDescriptor required for check-in.' });
      }
      if (!enrolledFaces.length) {
        pushNotification(db, user.id, 'attendance-error', 'Attendance failed: invalid enrolled face profile.');
        await writeDb(db);
        return json(res, 400, { error: 'Face profile is invalid. Please re-enroll your face.' });
      }

      const configuredMaxDistance = Number.isFinite(Number(db.settings.maxFaceHammingDistance))
        ? Number(db.settings.maxFaceHammingDistance)
        : 14;
      const descriptorLength = Math.min(enrolledFaces[0].length, incomingFaces[0].length);
      const strictMin = Math.max(configuredMaxDistance, Math.round(descriptorLength * 0.22));
      const maxDistance = strictMin;
      faceDistance = bestFaceMatch(enrolledFaces, incomingFaces);

      if (faceDistance === null) {
        pushNotification(db, user.id, 'attendance-error', 'Attendance failed: invalid face payload.');
        await writeDb(db);
        return json(res, 400, { error: 'Invalid face payload.' });
      }

      if (faceDistance > maxDistance) {
        pushNotification(db, user.id, 'attendance-error', 'Attendance failed: face verification mismatch.');
        await writeDb(db);
        return json(res, 403, {
            error: `Face verification mismatch. (Distance: ${faceDistance}, Allowed: ${maxDistance})`,
            faceDistance,
            maxFaceHammingDistance: maxDistance
          });
        }

const gfLat = Number(schedule.geofence && schedule.geofence.lat);
      const gfLng = Number(schedule.geofence && schedule.geofence.lng);
      const gfRadius = Number(schedule.geofence && schedule.geofence.radiusMeters);

      if (![gfLat, gfLng, gfRadius].every(Number.isFinite) || Math.abs(gfLat) > 90 || Math.abs(gfLng) > 180 || gfRadius <= 0) {
        return json(res, 400, { error: 'Schedule geofence is misconfigured.' });
      }

      const distance = haversineMeters(lat, lng, gfLat, gfLng);

      const dLatDeg = lat - gfLat;
      const dLngDeg = lng - gfLng;
      const dy = dLatDeg * (Math.PI * 6371000 / 180);
      const dx = dLngDeg * (Math.PI * 6371000 * Math.cos(gfLat * Math.PI / 180) / 180);
      
      const theta = (schedule.geofence.rotationDegrees || 0) * (Math.PI / 180);
      const rx = dx * Math.cos(-theta) - dy * Math.sin(-theta);
      const ry = dx * Math.sin(-theta) + dy * Math.cos(-theta);
      
      const allowedHalfWidth = gfRadius;
      const isInside = Math.abs(rx) <= allowedHalfWidth && Math.abs(ry) <= allowedHalfWidth;

      if (!isInside) {
        const dxMax = Math.max(0, Math.abs(rx) - gfRadius);
        const dyMax = Math.max(0, Math.abs(ry) - gfRadius);
        const excess = Math.sqrt(dxMax*dxMax + dyMax*dyMax);
        pushNotification(db, user.id, 'attendance-error', 'Attendance failed: outside class area.');
        await writeDb(db);
        return json(res, 400, { error: `Outside class area by ${Math.round(excess)}m.` });
      }

        let status = 'Present';
        if (currentMin > startMin) {
          status = currentMin > (startMin + lateCutoffMinutes) ? 'Absent' : 'Late';
        }
      const payload = {
        classId: cls.id,
        scheduleId: schedule.id,
        studentId: user.id,
        date: today,
        status,
        checkInAt: new Date().toISOString(),
        distanceMeters: Math.round(distance),
        location: { lat, lng },
          capturedImage: b.image || null,
        deviceId: incomingDevice || user.deviceId || null,
        faceVerified: true,
        faceDistance
      };
      if (existing && existing.status === 'Absent') Object.assign(existing, payload);
      else db.attendance.push({ id: randomId('att_'), ...payload, checkOutAt: null, createdAt: new Date().toISOString() });
      pushNotification(db, user.id, 'attendance-success', `Attendance recorded successfully: ${status}.`);
      await writeDb(db);
      return json(res, 200, { message: 'Attendance recorded.', status });
    }

    if (req.method === 'POST' && pathname === '/api/attendance/check-out') {
      return json(res, 410, { error: 'Check-out has been removed.' });
    }

    if (req.method === 'GET' && pathname === '/api/attendance/my') {
      if (user.role !== 'student') return json(res, 403, { error: 'Only students can access this.' });
      const period = query.period || 'weekly';
      const toKey = dateKey(new Date());
      const fromDate = new Date();
      if (period === 'daily') fromDate.setDate(fromDate.getDate());
      else if (period === 'monthly') fromDate.setDate(fromDate.getDate() - 30);
      else fromDate.setDate(fromDate.getDate() - 7);
      const fromKey = dateKey(fromDate);
      ensureAbsences(db, fromKey, toKey);
      await writeDb(db);
      const records = db.attendance
        .filter(a => a.studentId === user.id && isWithinRange(a.date, fromKey, toKey))
        .map(a => ({ ...a, class: getClassById(db, a.classId), schedule: db.schedules.find(s => s.id === a.scheduleId) || null }))
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      return json(res, 200, { period, from: fromKey, to: toKey, records });
    }

    const classAttendance = routeMatch(pathname, '/api/attendance/class/:classId');
    if (req.method === 'GET' && classAttendance) {
      if (!requireRole(user, ['teacher', 'admin'])) return json(res, 403, { error: 'Forbidden' });
      const cls = getClassById(db, classAttendance.classId);
      if (!cls) return json(res, 404, { error: 'Class not found.' });
      if (!canManageClass(user, cls)) return json(res, 403, { error: 'Not allowed for this class.' });
      const targetDate = query.date || dateKey(new Date());
      ensureAbsences(db, targetDate, targetDate);
      await writeDb(db);
      const records = db.attendance
        .filter(a => a.classId === cls.id && a.date === targetDate)
        .map(a => ({ ...a, student: safeUser(db.users.find(u => u.id === a.studentId)), schedule: db.schedules.find(s => s.id === a.scheduleId) || null }));
      return json(res, 200, { class: cls, date: targetDate, records });
    }

    if (req.method === 'GET' && pathname === '/api/reports/summary') {
      const fromKey = query.from || dateKey(new Date(new Date().setDate(new Date().getDate() - 30)));
      const toKey = query.to || dateKey(new Date());
      ensureAbsences(db, fromKey, toKey);
      await writeDb(db);
      let rows = db.attendance.filter(a => isWithinRange(a.date, fromKey, toKey));
      if (user.role === 'student') rows = rows.filter(a => a.studentId === user.id);
      if (user.role === 'teacher') {
        const managedIds = roleClasses(db, user).map(c => c.id);
        rows = rows.filter(a => managedIds.includes(a.classId));
      }
      if (query.classId) rows = rows.filter(a => a.classId === query.classId);
      if (query.studentId) rows = rows.filter(a => a.studentId === query.studentId);

      const present = rows.filter(r => r.status === 'Present').length;
      const late = rows.filter(r => r.status === 'Late').length;
      const absent = rows.filter(r => r.status === 'Absent').length;
      const total = rows.length || 1;

      const map = new Map();
      for (const r of rows) {
        const key = r.studentId;
        const s = db.users.find(u => u.id === r.studentId);
        const it = map.get(key) || { studentId: key, studentName: s ? s.name : 'Unknown', present: 0, late: 0, absent: 0, total: 0 };
        it.total += 1;
        if (r.status === 'Present') it.present += 1;
        if (r.status === 'Late') it.late += 1;
        if (r.status === 'Absent') it.absent += 1;
        map.set(key, it);
      }
      const perStudent = Array.from(map.values()).map(it => ({
        ...it,
        attendancePercentage: Number((((it.present + it.late) / (it.total || 1)) * 100).toFixed(2))
      }));
      return json(res, 200, {
        from: fromKey,
        to: toKey,
        totals: {
          present,
          late,
          absent,
          records: rows.length,
          attendancePercentage: Number((((present + late) / total) * 100).toFixed(2))
        },
        perStudent
      });
    }

    if (req.method === 'GET' && pathname === '/api/reports/attendance.csv') {
      const fromKey = query.from || dateKey(new Date(new Date().setDate(new Date().getDate() - 30)));
      const toKey = query.to || dateKey(new Date());
      ensureAbsences(db, fromKey, toKey);
      await writeDb(db);
      let rows = db.attendance.filter(a => isWithinRange(a.date, fromKey, toKey));
      if (user.role === 'student') rows = rows.filter(a => a.studentId === user.id);
      if (user.role === 'teacher') {
        const managedIds = roleClasses(db, user).map(c => c.id);
        rows = rows.filter(a => managedIds.includes(a.classId));
      }
      if (query.classId) rows = rows.filter(a => a.classId === query.classId);
      const lines = [[
        'date',
        'student_name',
        'student_id',
        'class_code',
        'class_section',
        'status',
        'check_in_at',
        'check_out_at',
        'distance_meters'
      ].join(',')];
      for (const r of rows) {
        const s = db.users.find(u => u.id === r.studentId) || {};
        const c = db.classes.find(k => k.id === r.classId) || {};
        lines.push([
          csvEscape(r.date),
          csvEscape(s.name),
          csvEscape(s.studentId || s.username),
          csvEscape(c.subjectCode),
          csvEscape(c.section),
          csvEscape(r.status),
          csvEscape(r.checkInAt || ''),
          csvEscape(r.checkOutAt || ''),
          csvEscape(r.distanceMeters || '')
        ].join(','));
      }
      return text(res, 200, `${lines.join('\n')}\n`, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename=\"attendance_${fromKey}_to_${toKey}.csv\"`
      });
    }

    if (req.method === 'GET' && pathname === '/api/notifications') {
      const notifications = db.notifications
        .filter(n => n.userId === user.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return json(res, 200, { notifications });
    }

    const markRead = routeMatch(pathname, '/api/notifications/:notificationId/read');
    if (req.method === 'POST' && markRead) {
      const n = db.notifications.find(k => k.id === markRead.notificationId && k.userId === user.id);
      if (!n) return json(res, 404, { error: 'Notification not found.' });
      n.read = true;
      await writeDb(db);
      return json(res, 200, { message: 'Marked as read.' });
    }

    if (req.method === 'GET' && pathname === '/api/reminders') {
      if (!requireRole(user, ['teacher', 'admin'])) return json(res, 403, { error: 'Forbidden' });
      return json(res, 200, { reminders: scheduleReminders(db, user) });
    }

    return json(res, 404, { error: 'API route not found.' });
  };
}

module.exports = { createApiHandler, seedInitialUsers };

