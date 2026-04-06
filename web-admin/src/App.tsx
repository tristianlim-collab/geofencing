import { FormEvent, useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import type { LeafletMouseEvent } from 'leaflet';
import { Polygon, Marker, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { api, getToken, setToken, User } from './api';

type ClassItem = {
  id: string;
  subjectCode: string;
  subjectName: string;
  section: string;
  room: string;
  studentCount: number;
};

type ScheduleItem = {
  id: string;
  classId: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
  geofence: { lat: number; lng: number; radiusMeters: number; rotationDegrees?: number };
  class?: ClassItem;
};

type StudentItem = {
  id: string;
  name: string;
  studentId?: string;
  course?: string;
  yearSection?: string;
};

type SummaryTotals = {
  present: number;
  late: number;
  absent: number;
  records: number;
  attendancePercentage: number;
};

type SummaryStudent = {
  studentId: string;
  studentName: string;
  present: number;
  late: number;
  absent: number;
  total: number;
  attendancePercentage: number;
};

type RecordItem = {
  id: string;
  studentId: string;
  checkInAt: string;
  status: string;
  capturedImage?: string;
};

type SummaryResponse = {
  from: string;
  to: string;
  totals: SummaryTotals;
  perStudent: SummaryStudent[];
  records: RecordItem[];
};

const dotIcon = L.divIcon({
  className: 'rotation-handle',
  html: '<div style="width: 16px; height: 16px; background: #0b7f69; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.5);"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

const dayLabelMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayLabels(days: number[]) {
  return days
    .map(day => dayLabelMap[day] || '?')
    .join(', ');
}

function GeofenceMapClick({
  onPick
}: {
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(event: LeafletMouseEvent) {
      onPick(event.latlng.lat, event.latlng.lng);
    }
  });
  return null;
}

function GeofenceMapView({ center }: { center: [number, number] }) {
  const map = useMap();

  useEffect(() => {
    map.setView(center);
  }, [map, center]);

  return null;
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [token, setTokenState] = useState<string | null>(getToken());
  const [user, setUser] = useState<User | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryFrom, setSummaryFrom] = useState('');
  const [summaryTo, setSummaryTo] = useState('');

  const [classSubjectCode, setClassSubjectCode] = useState('');
  const [classSubjectName, setClassSubjectName] = useState('');
  const [classSection, setClassSection] = useState('');
  const [classRoom, setClassRoom] = useState('');
  const [classLocationName, setClassLocationName] = useState('');
  const [creatingClass, setCreatingClass] = useState(false);

  const [notice, setNotice] = useState('');

  const [scheduleClassId, setScheduleClassId] = useState('');
  const [scheduleStartTime, setScheduleStartTime] = useState('08:00');
  const [scheduleEndTime, setScheduleEndTime] = useState('09:00');
  const [scheduleDays, setScheduleDays] = useState<number[]>([]);
  const [scheduleLat, setScheduleLat] = useState('');
  const [scheduleLng, setScheduleLng] = useState('');
  const [scheduleRadius, setScheduleRadius] = useState('50');
  const [scheduleRotation, setScheduleRotation] = useState<number>(0);
  const [creatingSchedule, setCreatingSchedule] = useState(false);
  const [detectingGeofence, setDetectingGeofence] = useState(false);

  const [enrollClassId, setEnrollClassId] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [enrolledStudentIds, setEnrolledStudentIds] = useState<string[]>([]);
  const [enrollingStudents, setEnrollingStudents] = useState(false);
  const [removingStudents, setRemovingStudents] = useState(false);
  const [deletingStudents, setDeletingStudents] = useState(false);
  const [deletingScheduleId, setDeletingScheduleId] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const title = useMemo(() => {
    if (!user) return 'Teacher Web Portal';
    return `${user.role.toUpperCase()} - ${user.name}`;
  }, [user]);

  async function loadDashboard(nextToken: string) {
    const me = await api<{ user: User | null }>('/auth/me', { method: 'GET' }, nextToken);
    if (!me.user) throw new Error('Session expired. Please log in again.');
    if (me.user.role !== 'teacher') throw new Error('Only teacher accounts are allowed on web portal.');

    setUser(me.user);
    const [cls, sch, report, stu] = await Promise.all([
      api<{ classes: ClassItem[] }>('/classes', { method: 'GET' }, nextToken),
      api<{ schedules: ScheduleItem[] }>('/schedules', { method: 'GET' }, nextToken),
      api<SummaryResponse>('/reports/summary', { method: 'GET' }, nextToken),
      api<{ students: StudentItem[] }>('/students', { method: 'GET' }, nextToken)
    ]);

    setClasses(cls.classes || []);
    setSchedules(sch.schedules || []);
    setStudents(stu.students || []);
    setSummary(report || null);
  }

  async function refreshDashboard() {
    if (!token) return;
    await loadDashboard(token);
    if (enrollClassId) {
      await loadClassEnrollments(enrollClassId, token);
    }
  }

  async function loadFilteredSummary() {
    if (!token) return;
    try {
      const q = new URLSearchParams();
      if (summaryFrom) q.append('from', summaryFrom);
      if (summaryTo) q.append('to', summaryTo);
      const url = `/reports/summary${q.toString() ? `?${q.toString()}` : ''}`;
      const report = await api<SummaryResponse>(url, { method: 'GET' }, token);
      setSummary(report || null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function exportSummaryCsv() {
    if (!summary || summary.perStudent.length === 0) return;
    
    const headers = ['Student', 'Present', 'Late', 'Absent', 'Rate'];
    const rows = summary.perStudent.map(item => [
      item.studentName,
      item.present,
      item.late,
      item.absent,
      item.attendancePercentage + '%'
    ]);
    
    let csvContent = headers.join(',') + '\n';
    rows.forEach(row => {
      csvContent += row.map(cell => `"${cell}"`).join(',') + '\n';
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `attendance_summary_${summary.from}_to_${summary.to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function exportSummaryPdf() {
    if (!summary || summary.perStudent.length === 0) return;

    const doc = new jsPDF();
    doc.text(`Attendance Summary (${summary.from} to ${summary.to})`, 14, 15);
    
    doc.setFontSize(10);
    doc.text(`Present: ${summary.totals.present} | Late: ${summary.totals.late} | Absent: ${summary.totals.absent}`, 14, 23);

    const tableData = summary.perStudent.map(item => [
      item.studentName,
      item.present.toString(),
      item.late.toString(),
      item.absent.toString(),
      item.attendancePercentage.toString() + '%'
    ]);

    autoTable(doc, {
      startY: 28,
      head: [['Student', 'Present', 'Late', 'Absent', 'Rate']],
      body: tableData,
    });

    doc.save(`attendance_summary_${summary.from}_to_${summary.to}.pdf`);
  }

  async function loadClassEnrollments(classId: string, sessionToken: string) {
    if (!classId) {
      setEnrolledStudentIds([]);
      return;
    }
    const data = await api<{ enrolledStudentIds: string[] }>(`/classes/${classId}/enroll`, { method: 'GET' }, sessionToken);
    setEnrolledStudentIds(data.enrolledStudentIds || []);
  }

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        await loadDashboard(token);
      } catch (err) {
        setError((err as Error).message);
        setToken(null);
        setTokenState(null);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [token]);

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const auth = await api<{ sid: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      if (auth.user.role !== 'teacher') throw new Error('Only teacher accounts are allowed on web portal.');
      setToken(auth.sid);
      setTokenState(auth.sid);
      await loadDashboard(auth.sid);
      setPassword('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onLogout() {
    try {
      if (token) await api('/auth/logout', { method: 'POST' }, token);
    } catch {
      // ignore
    }
    setToken(null);
    setTokenState(null);
    setUser(null);
    setClasses([]);
    setSchedules([]);
    setStudents([]);
    setSummary(null);
  }

  function toggleEnrollStudent(studentId: string) {
    setSelectedStudentIds(prev => {
      if (prev.includes(studentId)) return prev.filter(id => id !== studentId);
      return [...prev, studentId];
    });
  }

  function toggleScheduleDay(day: number) {
    setScheduleDays(prev => {
      if (prev.includes(day)) return prev.filter(item => item !== day);
      return [...prev, day].sort((a, b) => a - b);
    });
  }

  const enrolledSet = useMemo(() => new Set(enrolledStudentIds), [enrolledStudentIds]);
  const selectedEnrolledCount = useMemo(
    () => selectedStudentIds.filter(id => enrolledSet.has(id)).length,
    [selectedStudentIds, enrolledSet]
  );
  const selectedNotEnrolledCount = useMemo(
    () => selectedStudentIds.filter(id => !enrolledSet.has(id)).length,
    [selectedStudentIds, enrolledSet]
  );

  const parsedScheduleLat = Number(scheduleLat);
  const parsedScheduleLng = Number(scheduleLng);
  const hasScheduleCoords = Number.isFinite(parsedScheduleLat) && Number.isFinite(parsedScheduleLng);
  const geofenceRadiusMeters = Math.max(1, Number(scheduleRadius) || 50);

  const rotationRad = (scheduleRotation) * (Math.PI / 180);
  const R = 6371000;

  const geofencePolygon: [number, number][] = hasScheduleCoords ? 
    [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([kx, ky]) => {
      const x = kx * geofenceRadiusMeters;
      const y = ky * geofenceRadiusMeters;
      const rx = x * Math.cos(rotationRad) - y * Math.sin(rotationRad);
      const ry = x * Math.sin(rotationRad) + y * Math.cos(rotationRad);
      return [
        parsedScheduleLat + (ry * (180 / (Math.PI * R))),
        parsedScheduleLng + (rx * (180 / (Math.PI * R * Math.cos(parsedScheduleLat * Math.PI / 180))))
      ];
    }) : [];

  const handleLat = hasScheduleCoords ? parsedScheduleLat + (geofenceRadiusMeters * Math.cos(rotationRad)) * (180 / (Math.PI * R)) : 0;
  const handleLng = hasScheduleCoords ? parsedScheduleLng + (geofenceRadiusMeters * Math.sin(rotationRad)) * (180 / (Math.PI * R * Math.cos(parsedScheduleLat * Math.PI / 180))) : 0;

  const mapCenter: [number, number] = hasScheduleCoords
    ? [parsedScheduleLat, parsedScheduleLng]
    : [10.7424, 122.9700];

  async function onCreateClass(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError('');
    setNotice('');
    setCreatingClass(true);
    try {
      await api('/classes', {
        method: 'POST',
        body: JSON.stringify({
          subjectCode: classSubjectCode,
          subjectName: classSubjectName,
          section: classSection,
          room: classRoom,
          locationName: classLocationName
        })
      }, token);
      setClassSubjectCode('');
      setClassSubjectName('');
      setClassSection('');
      setClassRoom('');
      setClassLocationName('');
      await refreshDashboard();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreatingClass(false);
    }
  }

  async function onCreateSchedule(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError('');
    setNotice('');
    setCreatingSchedule(true);
    try {
      await api('/schedules', {
        method: 'POST',
        body: JSON.stringify({
          classId: scheduleClassId,
          startTime: scheduleStartTime,
          endTime: scheduleEndTime,
          daysOfWeek: scheduleDays,
          geofenceLat: Number(scheduleLat),
          geofenceLng: Number(scheduleLng),
          radiusMeters: Number(scheduleRadius),
          rotationDegrees: scheduleRotation
        })
      }, token);
      setScheduleClassId('');
      setScheduleStartTime('08:00');
      setScheduleEndTime('09:00');
      setScheduleDays([]);
      setScheduleLat('');
      setScheduleLng('');
      setScheduleRadius('50');
      setScheduleRotation(0);
      await refreshDashboard();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreatingSchedule(false);
    }
  }

  async function onAutoDetectGeofence() {
    setError('');
    setNotice('');

    if (!navigator.geolocation) {
      setError('This browser does not support location detection for geofence.');
      return;
    }

    setDetectingGeofence(true);
    setNotice('Scanning for high-precision satellites... (Please wait)');
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        let bestPos: GeolocationPosition | null = null;
        
        const timeoutId = setTimeout(() => {
          navigator.geolocation.clearWatch(watchId);
          if (bestPos) resolve(bestPos);
          else reject(new Error('Timeout'));
        }, 12000);

        const watchId = navigator.geolocation.watchPosition(
          (pos) => {
            if (!bestPos || pos.coords.accuracy < bestPos.coords.accuracy) {
              bestPos = pos;
            }
            if (bestPos.coords.accuracy <= 10.0) {
              clearTimeout(timeoutId);
              navigator.geolocation.clearWatch(watchId);
              resolve(bestPos);
            }
          },
          (err) => {
            if (!bestPos) {
              clearTimeout(timeoutId);
              navigator.geolocation.clearWatch(watchId);
              reject(err);
            }
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 6000 }
        );
      });

      setScheduleLat(position.coords.latitude.toFixed(6));
      setScheduleLng(position.coords.longitude.toFixed(6));
      setNotice(`Geofence captured securely (${position.coords.accuracy.toFixed(1)}m precision)`);
    } catch {
      setError('Unable to detect high-precision location. Ensure Wi-Fi/GPS is on.');
    } finally {
      setDetectingGeofence(false);
    }
  }

  async function onEnrollStudents(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError('');
    setNotice('');
    setEnrollingStudents(true);
    try {
      const idsToEnroll = selectedStudentIds.filter(id => !enrolledSet.has(id));
      if (!idsToEnroll.length) {
        throw new Error('Select students not yet enrolled in this class.');
      }
      await api(`/classes/${enrollClassId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ studentIds: idsToEnroll })
      }, token);
      setSelectedStudentIds([]);
      setNotice('Students enrolled successfully.');
      await refreshDashboard();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnrollingStudents(false);
    }
  }

  async function onRemoveStudents() {
    if (!token) return;
    if (!enrollClassId) {
      setError('Select a class first before removing students.');
      return;
    }
    setError('');
    setNotice('');
    setRemovingStudents(true);
    try {
      const idsToRemove = selectedStudentIds.filter(id => enrolledSet.has(id));
      if (!idsToRemove.length) {
        throw new Error('Select enrolled students to remove from this class.');
      }
      await api(`/classes/${enrollClassId}/enroll`, {
        method: 'DELETE',
        body: JSON.stringify({ studentIds: idsToRemove })
      }, token);
      setSelectedStudentIds([]);
      setNotice('Selected students removed from class.');
      await refreshDashboard();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemovingStudents(false);
    }
  }

  async function onDeleteSchedule(scheduleId: string) {
    if (!token) return;
    setError('');
    setNotice('');
    setDeletingScheduleId(scheduleId);
    try {
      await api(`/schedules/${scheduleId}`, { method: 'DELETE' }, token);
      setNotice('Schedule removed.');
      await refreshDashboard();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingScheduleId(null);
    }
  }

  async function onDeleteStudents() {
    if (!token) return;
    if (!selectedStudentIds.length) {
      setError('Select students first.');
      return;
    }
    setError('');
    setNotice('');
    setDeletingStudents(true);
    try {
      await api('/students', {
        method: 'DELETE',
        body: JSON.stringify({ studentIds: selectedStudentIds })
      }, token);
      setSelectedStudentIds([]);
      setNotice('Selected student accounts removed from dashboard.');
      await refreshDashboard();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingStudents(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    if (!enrollClassId) {
      setEnrolledStudentIds([]);
      setSelectedStudentIds([]);
      return;
    }
    void loadClassEnrollments(enrollClassId, token).catch(err => {
      setError((err as Error).message);
    });
  }, [enrollClassId, token]);

  if (!token || !user) {
    return (
      <div className="page center">
        <div className="panel login-panel">
          <h1>{title}</h1>
          <p className="muted">Web is restricted to admin/teacher accounts.</p>
          <form onSubmit={onLogin}>
            <label>Username</label>
            <input value={username} onChange={e => setUsername(e.target.value)} required />
            <label>Password</label>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" required />
            <button disabled={loading} type="submit">
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
          {error ? <p className="error">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="topbar panel">
        <div>
          <h1>{title}</h1>
          <p className="muted">Teacher Dashboard - Geofence Attendance</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="ghost-btn" onClick={onLogout}>Logout</button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      <section className="metric-grid">
        <article className="metric-card">
          <p className="metric-label">Classes</p>
          <p className="metric-value">{classes.length}</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">Schedules</p>
          <p className="metric-value">{schedules.length}</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">Attendance Rate</p>
          <p className="metric-value">{summary?.totals?.attendancePercentage ?? 0}%</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">Records</p>
          <p className="metric-value">{summary?.totals?.records ?? 0}</p>
        </article>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Create Class</h2>
          <form onSubmit={onCreateClass}>
            <label>Subject Code</label>
            <input value={classSubjectCode} onChange={e => setClassSubjectCode(e.target.value)} required />
            <label>Subject Name</label>
            <input value={classSubjectName} onChange={e => setClassSubjectName(e.target.value)} required />
            <label>Section</label>
            <input value={classSection} onChange={e => setClassSection(e.target.value)} required />
            <label>Room</label>
            <input value={classRoom} onChange={e => setClassRoom(e.target.value)} required />
            <label>Location Name (optional)</label>
            <input value={classLocationName} onChange={e => setClassLocationName(e.target.value)} />
            <button disabled={creatingClass} type="submit">
              {creatingClass ? 'Creating class...' : 'Create Class'}
            </button>
          </form>
        </article>

        <article className="panel">
          <h2>Enroll Students</h2>
          <form onSubmit={onEnrollStudents}>
            <label>Class</label>
            <select value={enrollClassId} onChange={e => setEnrollClassId(e.target.value)} required>
              <option value="">Select class</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.subjectCode} - {c.section}
                </option>
              ))}
            </select>

            <label>Students</label>
            <div className="student-picker">
              {students.map(student => (
                <label className="inline-check" key={student.id}>
                  <input
                    type="checkbox"
                    checked={selectedStudentIds.includes(student.id)}
                    onChange={() => toggleEnrollStudent(student.id)}
                  />
                  <span>
                    {student.name} ({student.studentId || student.id})
                    {enrolledSet.has(student.id) ? ' - Enrolled' : ' - Not enrolled'}
                  </span>
                </label>
              ))}
              {!students.length ? <p className="muted">No registered students yet.</p> : null}
            </div>

            <button disabled={enrollingStudents || !selectedNotEnrolledCount} type="submit">
              {enrollingStudents ? 'Enrolling...' : `Enroll Selected (${selectedNotEnrolledCount})`}
            </button>
            <button
              className="danger-btn"
              disabled={removingStudents || !selectedEnrolledCount}
              type="button"
              onClick={onRemoveStudents}
            >
              {removingStudents ? 'Removing...' : `Remove Selected (${selectedEnrolledCount})`}
            </button>
            <button
              className="danger-btn"
              disabled={deletingStudents || !selectedStudentIds.length}
              type="button"
              onClick={onDeleteStudents}
            >
              {deletingStudents ? 'Deleting accounts...' : `Delete Selected Accounts (${selectedStudentIds.length})`}
            </button>
          </form>
        </article>

        <article className="panel">
          <h2>Create Schedule</h2>
          <form onSubmit={onCreateSchedule}>
            <label>Class</label>
            <select value={scheduleClassId} onChange={e => setScheduleClassId(e.target.value)} required>
              <option value="">Select class</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.subjectCode} - {c.section}
                </option>
              ))}
            </select>

            <div className="form-grid">
              <div>
                <label>Start Time</label>
                <input
                  type="time"
                  value={scheduleStartTime}
                  onChange={e => setScheduleStartTime(e.target.value)}
                  required
                />
              </div>
              <div>
                <label>End Time</label>
                <input type="time" value={scheduleEndTime} onChange={e => setScheduleEndTime(e.target.value)} required />
              </div>
            </div>

            <label>Days of Week</label>
            <div className="days-grid">
              {dayLabelMap.map((label, day) => (
                <label className="inline-check" key={label}>
                  <input
                    type="checkbox"
                    checked={scheduleDays.includes(day)}
                    onChange={() => toggleScheduleDay(day)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <div className="form-grid">
              <div>
                <label>Latitude</label>
                <input
                  type="number"
                  value={scheduleLat}
                  onChange={e => setScheduleLat(e.target.value)}
                  step="any"
                  required
                />
              </div>
              <div>
                <label>Longitude</label>
                <input
                  type="number"
                  value={scheduleLng}
                  onChange={e => setScheduleLng(e.target.value)}
                  step="any"
                  required
                />
              </div>
            </div>
              <div className="form-grid">
                <div>
                  <label>Radius (Meters)</label>
                  <input
                    type="number"
                    value={scheduleRadius}
                    onChange={e => setScheduleRadius(e.target.value)}
                    min="1"
                    required
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={onAutoDetectGeofence}
                disabled={detectingGeofence || creatingSchedule}
              >
                {detectingGeofence ? 'Detecting location...' : 'Auto-detect Geofence'}
              </button>

              <label>Pick Specific Room on Map</label>
              <p className="muted">Click on map to mark the exact classroom radius.</p>
              
              <div className="schedule-map">
                <MapContainer
                  center={mapCenter}
                  zoom={18}
                  scrollWheelZoom={true}>
                  <TileLayer
                    url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
                    attribution="&copy; Google Maps"
                  />

                  {hasScheduleCoords && geofencePolygon.length > 0 && (
                    <>
                      <Polygon
                        positions={geofencePolygon}
                        pathOptions={{ color: '#0b7f69', fillColor: '#0b7f69', fillOpacity: 0.2 }}
                      />
                      <Marker
                        position={[handleLat, handleLng]}
                        draggable={true}
                        icon={dotIcon}
                        eventHandlers={{
                          drag: (e) => {
                            const latlng = e.target.getLatLng();
                            const dLat = latlng.lat - parsedScheduleLat;
                            const dLng = latlng.lng - parsedScheduleLng;
                            const dy = dLat * (Math.PI * 6371000 / 180);
                            const dx = dLng * (Math.PI * 6371000 * Math.cos(parsedScheduleLat * Math.PI / 180) / 180);
                            let angle = Math.atan2(dx, dy) * (180 / Math.PI);
                            if (angle < 0) angle += 360;
                            setScheduleRotation(Math.round(angle));
                          }
                        }}
                      />
                    </>
                  )}

                  {hasScheduleCoords && (
                    <CircleMarker
                      center={[parsedScheduleLat, parsedScheduleLng]}
                      radius={5}
                      pathOptions={{ color: '#ff4d4f', fillColor: '#ff4d4f', fillOpacity: 1 }}
                    />
                  )}

                  <GeofenceMapView center={mapCenter} />
                  <GeofenceMapClick
                    onPick={(lat, lng) => {
                      setScheduleLat(lat.toFixed(6));
                      setScheduleLng(lng.toFixed(6));
                    }}
                  />
                </MapContainer>
              </div>

              <button disabled={creatingSchedule} type="submit">
                {creatingSchedule ? 'Creating schedule...' : 'Create Schedule'}
              </button>
            </form>
          </article>

          <article className="panel">
            <h2>Classes</h2>
            <ul className="list rich-list">
              {classes.map(c => (
                <li key={c.id}>
                  <div className="list-title">
                    <strong>{c.subjectCode}</strong>
                    <span>{c.subjectName}</span>
                  </div>
                  <p className="list-meta">Section {c.section} &bull; Room {c.room} &bull; {c.studentCount} students</p>
                </li>
              ))}
              {!classes.length ? <li>No classes yet.</li> : null}
            </ul>
          </article>

          <article className="panel">
          <h2>Schedules / Geofence</h2>
          <ul className="list rich-list">
            {schedules.map(s => (
              <li key={s.id}>
                <div className="list-title">
                  <strong>{s.class?.subjectCode || s.classId}</strong>
                  <span>{s.startTime}-{s.endTime}</span>
                </div>
                <p className="list-meta">
                  Days: {dayLabels(s.daysOfWeek)} - Geofence: {s.geofence.radiusMeters}m
                </p>
                <button
                  className="danger-btn list-action-btn"
                  onClick={() => onDeleteSchedule(s.id)}
                  disabled={deletingScheduleId === s.id}
                  type="button"
                >
                  {deletingScheduleId === s.id ? 'Removing...' : 'Remove Schedule'}
                </button>
              </li>
            ))}
            {!schedules.length ? <li>No schedules yet.</li> : null}
          </ul>
        </article>
      </section>

      <section className="panel summary-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <h2>Attendance Summary</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={summaryFrom} onChange={e => setSummaryFrom(e.target.value)} style={{ width: 'auto' }} />
              <span>to</span>
              <input type="date" value={summaryTo} onChange={e => setSummaryTo(e.target.value)} style={{ width: 'auto' }} />
              <button className="btn-small" onClick={loadFilteredSummary} style={{ width: 'auto' }}>Filter</button>
          </div>
        </div>
        {summary ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', marginBottom: '12px' }}>
              <p className="muted" style={{ margin: 0 }}>
                Date range: <strong>{summary.from}</strong> to <strong>{summary.to}</strong>
              </p>
              {summary.perStudent.length > 0 && (
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn-small" style={{ backgroundColor: '#2e7d32', color: 'white', width: 'auto' }} onClick={exportSummaryCsv}>Export CSV</button>
                    <button className="btn-small" style={{ backgroundColor: '#d32f2f', color: 'white', width: 'auto' }} onClick={exportSummaryPdf}>Export PDF</button>
                </div>
              )}
            </div>
            <div className="totals-row">
              <span className="chip chip-present">Present: {summary.totals.present}</span>
              <span className="chip chip-late">Late: {summary.totals.late}</span>
              <span className="chip chip-absent">Absent: {summary.totals.absent}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Present</th>
                    <th>Late</th>
                    <th>Absent</th>
                    <th>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.perStudent.slice(0, 12).map(item => (
                    <tr key={item.studentId}>
                      <td>{item.studentName}</td>
                      <td>{item.present}</td>
                      <td>{item.late}</td>
                      <td>{item.absent}</td>
                      <td>{item.attendancePercentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {summary.records && summary.records.filter((r) => r.capturedImage).length > 0 && (
              <>
                <h3 style={{ marginTop: '24px', marginBottom: '8px' }}>Recent Check-ins</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  {summary.records.filter((r) => r.capturedImage).map(r => {
                    const stu = summary.perStudent.find(s => s.studentId === r.studentId);
                    const name = stu ? stu.studentName : 'Unknown';
                    return (
                      <div key={r.id} style={{ border: '1px solid #eee', borderRadius: '8px', padding: '8px', width: '120px', textAlign: 'center' }}>
                        <img src={`data:image/jpeg;base64,${r.capturedImage}`} style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '4px' }} alt="Face" />
                        <p style={{ margin: '8px 0 0 0', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</p>
                        <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: '#666' }}>{r.checkInAt ? new Date(r.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' }) : ''}</p>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        ) : (
          <p className="muted">No summary data.</p>
        )}
      </section>
    </div>
  );
}


