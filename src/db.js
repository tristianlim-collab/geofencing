const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

const DEFAULT_DB = {
  settings: {
    oneDevicePerStudent: true,
    lateGraceMinutes: 15,
    checkOutEnabled: true,
    faceVerificationRequired: true,
    maxFaceHammingDistance: 14
  },
  users: [],
  classes: [],
  schedules: [],
  enrollments: [],
  attendance: [],
  notifications: [],
  sessions: []
};

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n[FATAL ERROR] System is now locked to Supabase. You are missing a .env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY!');
  process.exit(1);
}

const USE_SUPABASE = true;

let supabaseClient = null;

function getSupabase() {
  if (!USE_SUPABASE) return null;
  if (supabaseClient) return supabaseClient;
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
  return supabaseClient;
}

function ensureDbFile() {
  if (!fs.existsSync(DB_FILE)) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
  }
}

function mergeDefaultDb(parsed) {
  return {
    ...DEFAULT_DB,
    ...parsed,
    settings: { ...DEFAULT_DB.settings, ...(parsed.settings || {}) }
  };
}

function toSupabaseRows(db) {
  return {
    settings: {
      id: 1,
      one_device_per_student: !!db.settings.oneDevicePerStudent,
      late_grace_minutes: Number(db.settings.lateGraceMinutes || 15),
      check_out_enabled: !!db.settings.checkOutEnabled,
      face_verification_required: !!db.settings.faceVerificationRequired,
      max_face_hamming_distance: Number(db.settings.maxFaceHammingDistance || 14)
    },
    users: db.users.map(user => ({
      id: user.id,
      role: user.role,
      name: user.name,
      username: user.username || null,
      student_id: user.studentId || null,
      password_hash: user.passwordHash,
      course: user.course || null,
      year_section: user.yearSection || null,
      device_id: user.deviceId || null,
      face_descriptor: user.faceDescriptor || null,
      face_enrolled_at: user.faceEnrolledAt || null,
      created_at: user.createdAt
    })),
    classes: db.classes.map(cls => ({
      id: cls.id,
      subject_code: cls.subjectCode,
      subject_name: cls.subjectName,
      section: cls.section,
      room: cls.room,
      location_name: cls.locationName || null,
      teacher_id: cls.teacherId,
      created_at: cls.createdAt
    })),
    schedules: db.schedules.map(schedule => ({
      id: schedule.id,
      class_id: schedule.classId,
      days_of_week: Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek : [],
      start_time: schedule.startTime,
      end_time: schedule.endTime,
      geofence: schedule.geofence || null,
      created_at: schedule.createdAt
    })),
    enrollments: db.enrollments.map(enrollment => ({
      id: enrollment.id,
      class_id: enrollment.classId,
      student_id: enrollment.studentId,
      created_at: enrollment.createdAt
    })),
    attendance: db.attendance.map(record => ({
      id: record.id,
      class_id: record.classId,
      schedule_id: record.scheduleId,
      student_id: record.studentId,
      date: record.date,
      status: record.status,
      check_in_at: record.checkInAt || null,
      check_out_at: record.checkOutAt || null,
      distance_meters: record.distanceMeters ?? null,
      location: record.location || null,
      device_id: record.deviceId || null,
      face_verified: record.faceVerified ?? null,
      face_distance: record.faceDistance ?? null,
        captured_image: record.capturedImage || null,
      created_at: record.createdAt
    })),
    notifications: db.notifications.map(notification => ({
      id: notification.id,
      user_id: notification.userId,
      type: notification.type,
      message: notification.message,
      read: !!notification.read,
      created_at: notification.createdAt
    })),
    sessions: db.sessions.map(session => ({
      sid: session.sid,
      user_id: session.userId,
      expires_at: session.expiresAt
    }))
  };
}

function fromSupabaseRows(rows) {
  const settingsRow = rows.settings || {};
  return mergeDefaultDb({
    settings: {
      oneDevicePerStudent: settingsRow.one_device_per_student,
      lateGraceMinutes: settingsRow.late_grace_minutes,
      checkOutEnabled: settingsRow.check_out_enabled,
      faceVerificationRequired: settingsRow.face_verification_required,
      maxFaceHammingDistance: settingsRow.max_face_hamming_distance
    },
    users: (rows.users || []).map(user => ({
      id: user.id,
      role: user.role,
      name: user.name,
      username: user.username || undefined,
      studentId: user.student_id || undefined,
      passwordHash: user.password_hash,
      course: user.course || undefined,
      yearSection: user.year_section || undefined,
      deviceId: user.device_id || null,
      faceDescriptor: user.face_descriptor || undefined,
      faceEnrolledAt: user.face_enrolled_at || undefined,
      createdAt: user.created_at
    })),
    classes: (rows.classes || []).map(cls => ({
      id: cls.id,
      subjectCode: cls.subject_code,
      subjectName: cls.subject_name,
      section: cls.section,
      room: cls.room,
      locationName: cls.location_name || '',
      teacherId: cls.teacher_id,
      createdAt: cls.created_at
    })),
    schedules: (rows.schedules || []).map(schedule => ({
      id: schedule.id,
      classId: schedule.class_id,
      daysOfWeek: (Array.isArray(schedule.days_of_week) ? schedule.days_of_week : [])
        .map(Number)
        .filter(n => Number.isInteger(n) && n >= 0 && n <= 6),
      startTime: schedule.start_time,
      endTime: schedule.end_time,
      geofence: schedule.geofence
        ? {
          lat: Number(schedule.geofence.lat),
          lng: Number(schedule.geofence.lng),
          radiusMeters: Number(schedule.geofence.radiusMeters)
        }
        : null,
      createdAt: schedule.created_at
    })),
    enrollments: (rows.enrollments || []).map(enrollment => ({
      id: enrollment.id,
      classId: enrollment.class_id,
      studentId: enrollment.student_id,
      createdAt: enrollment.created_at
    })),
    attendance: (rows.attendance || []).map(record => ({
      id: record.id,
      classId: record.class_id,
      scheduleId: record.schedule_id,
      studentId: record.student_id,
      date: record.date,
      status: record.status,
      checkInAt: record.check_in_at,
      checkOutAt: record.check_out_at,
      distanceMeters: record.distance_meters,
      location: record.location,
      deviceId: record.device_id,
      faceVerified: record.face_verified,
      faceDistance: record.face_distance,
      createdAt: record.created_at
    })),
    notifications: (rows.notifications || []).map(notification => ({
      id: notification.id,
      userId: notification.user_id,
      type: notification.type,
      message: notification.message,
      read: notification.read,
      createdAt: notification.created_at
    })),
    sessions: (rows.sessions || []).map(session => ({
      sid: session.sid,
      userId: session.user_id,
      expiresAt: session.expires_at
    }))
  });
}

async function readDbFromJson() {
  ensureDbFile();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const parsed = JSON.parse(raw || '{}');
  return mergeDefaultDb(parsed);
}

async function writeDbToJson(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

async function readDbFromSupabase() {
  const supabase = getSupabase();
  const [settingsRes, usersRes, classesRes, schedulesRes, enrollmentsRes, attendanceRes, notificationsRes, sessionsRes] = await Promise.all([
    supabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('users').select('*'),
    supabase.from('classes').select('*'),
    supabase.from('schedules').select('*'),
    supabase.from('enrollments').select('*'),
    supabase.from('attendance').select('*'),
    supabase.from('notifications').select('*'),
    supabase.from('sessions').select('*')
  ]);

  const errors = [settingsRes.error, usersRes.error, classesRes.error, schedulesRes.error, enrollmentsRes.error, attendanceRes.error, notificationsRes.error, sessionsRes.error].filter(Boolean);
  if (errors.length) {
    throw new Error(`Supabase read failed: ${errors[0].message}`);
  }

  return fromSupabaseRows({
    settings: settingsRes.data,
    users: usersRes.data,
    classes: classesRes.data,
    schedules: schedulesRes.data,
    enrollments: enrollmentsRes.data,
    attendance: attendanceRes.data,
    notifications: notificationsRes.data,
    sessions: sessionsRes.data
  });
}

async function clearTable(supabase, table, key) {
  const { error } = await supabase.from(table).delete().not(key, 'is', null);
  if (error) throw new Error(`Supabase clear failed for ${table}: ${error.message}`);
}

async function writeDbToSupabase(db) {
  const supabase = getSupabase();
  const rows = toSupabaseRows(db);

  await clearTable(supabase, 'sessions', 'sid');
  await clearTable(supabase, 'notifications', 'id');
  await clearTable(supabase, 'attendance', 'id');
  await clearTable(supabase, 'enrollments', 'id');
  await clearTable(supabase, 'schedules', 'id');
  await clearTable(supabase, 'classes', 'id');
  await clearTable(supabase, 'users', 'id');
  await supabase.from('app_settings').delete().eq('id', 1);

  const settingsRes = await supabase.from('app_settings').upsert(rows.settings, { onConflict: 'id' });
  if (settingsRes.error) throw new Error(`Supabase write failed for app_settings: ${settingsRes.error.message}`);

  const inserts = [
    ['users', rows.users],
    ['classes', rows.classes],
    ['schedules', rows.schedules],
    ['enrollments', rows.enrollments],
    ['attendance', rows.attendance],
    ['notifications', rows.notifications],
    ['sessions', rows.sessions]
  ];

  for (const [table, data] of inserts) {
    if (!data.length) continue;
    const result = await supabase.from(table).insert(data);
    if (result.error) throw new Error(`Supabase write failed for ${table}: ${result.error.message}`);
  }
}

let dbLock = Promise.resolve();
let memoryDb = null;
let isFlushing = false;
let needsFlush = false;

async function triggerSupabaseWrite() {
  if (isFlushing) {
    needsFlush = true;
    return;
  }
  isFlushing = true;
  try {
    const dbCopy = JSON.parse(JSON.stringify(memoryDb));
    await writeDbToSupabase(dbCopy);
  } catch (error) {
    console.error('Background DB sync failed:', error);
  } finally {
    isFlushing = false;
    if (needsFlush) {
      needsFlush = false;
      setTimeout(triggerSupabaseWrite, 2000);
    }
  }
}

async function withLock(fn) {
  let unlock;
  const nextLock = new Promise(r => unlock = r);
  const currentLock = dbLock;
  dbLock = dbLock.then(() => nextLock);
  await currentLock;
  try {
    return await fn();
  } finally {
    unlock();
  }
}

async function readDb() {
  return withLock(async () => {
    if (!memoryDb) {
      if (!USE_SUPABASE) {
        memoryDb = await readDbFromJson();
      } else {
        memoryDb = await readDbFromSupabase();
      }
    }
    return JSON.parse(JSON.stringify(memoryDb));
  });
}

async function writeDb(db) {
  return withLock(async () => {
    memoryDb = JSON.parse(JSON.stringify(db));
    if (!USE_SUPABASE) {
      writeDbToJson(memoryDb).catch(console.error);
    } else {
      triggerSupabaseWrite();
    }
  });
}

async function updateDb(mutator) {
  const db = await readDb();
  const result = (await mutator(db)) || db;
  await writeDb(result);
  return result;
}

async function clearMemoryCache() {
  return withLock(async () => {
    memoryDb = null;
  });
}

module.exports = {
  DB_FILE,
  USE_SUPABASE,
  readDb,
  writeDb,
  updateDb,
  clearMemoryCache
};
