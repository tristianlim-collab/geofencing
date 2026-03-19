import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin = FlutterLocalNotificationsPlugin();

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  const initializationSettingsAndroid = AndroidInitializationSettings('@mipmap/ic_launcher');
  const initializationSettingsIOS = DarwinInitializationSettings(
    requestAlertPermission: true,
    requestBadgePermission: true,
    requestSoundPermission: true,
  );
  const initializationSettings = InitializationSettings(
    android: initializationSettingsAndroid,
    iOS: initializationSettingsIOS,
  );
  await flutterLocalNotificationsPlugin.initialize(
    settings: initializationSettings,
  );

  runApp(const GeoAttendStudentApp());
}

class GeoAttendStudentApp extends StatelessWidget {
  const GeoAttendStudentApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'GeoAttend Student',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0C8A6C), brightness: Brightness.light),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF4F7FB),
      ),
      home: const StudentHomePage(),
    );
  }
}

class ClassItem {
  ClassItem({
    required this.id,
    required this.subjectCode,
    required this.subjectName,
    required this.section,
    required this.room,
    required this.studentCount,
  });

  final String id;
  final String subjectCode;
  final String subjectName;
  final String section;
  final String room;
  final int studentCount;

  factory ClassItem.fromJson(Map<String, dynamic> json) {
    return ClassItem(
      id: (json['id'] ?? '').toString(),
      subjectCode: (json['subjectCode'] ?? '').toString(),
      subjectName: (json['subjectName'] ?? '').toString(),
      section: (json['section'] ?? '').toString(),
      room: (json['room'] ?? '').toString(),
      studentCount: (json['studentCount'] as num?)?.toInt() ?? 0,
    );
  }
}

class ScheduleItem {
  ScheduleItem({
    required this.id,
    required this.classId,
    required this.startTime,
    required this.endTime,
    required this.daysOfWeek,
    required this.radiusMeters,
    required this.lat,
    required this.lng,
    this.classCode,
    this.classSection,
  });

  final String id;
  final String classId;
  final String startTime;
  final String endTime;
  final List<int> daysOfWeek;
  final int radiusMeters;
  final double lat;
  final double lng;
  final String? classCode;
  final String? classSection;

  factory ScheduleItem.fromJson(Map<String, dynamic> json) {
    final geofence = (json['geofence'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final cls = json['class'] as Map<String, dynamic>?;
    final days = (json['daysOfWeek'] as List<dynamic>? ?? const [])
        .map((day) => (day as num).toInt())
        .toList();
    return ScheduleItem(
      id: (json['id'] ?? '').toString(),
      classId: (json['classId'] ?? '').toString(),
      startTime: (json['startTime'] ?? '').toString(),
      endTime: (json['endTime'] ?? '').toString(),
      daysOfWeek: days,
      radiusMeters: (geofence['radiusMeters'] as num?)?.toInt() ?? 0,
      lat: (geofence['lat'] as num?)?.toDouble() ?? 0,
      lng: (geofence['lng'] as num?)?.toDouble() ?? 0,
      classCode: cls?['subjectCode']?.toString(),
      classSection: cls?['section']?.toString(),
    );
  }

  String get displayName {
    final code = classCode == null || classCode!.isEmpty ? classId : classCode!;
    final section = classSection == null || classSection!.isEmpty ? '' : ' • ${classSection!}';
    return '$code$section';
  }
}

class AttendanceRecord {
  AttendanceRecord({
    required this.id,
    required this.date,
    required this.status,
    required this.checkInAt,
    required this.checkOutAt,
    required this.classCode,
    required this.classSection,
  });

  final String id;
  final String date;
  final String status;
  final String? checkInAt;
  final String? checkOutAt;
  final String classCode;
  final String classSection;

  factory AttendanceRecord.fromJson(Map<String, dynamic> json) {
    final cls = (json['class'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    return AttendanceRecord(
      id: (json['id'] ?? '').toString(),
      date: (json['date'] ?? '').toString(),
      status: (json['status'] ?? '').toString(),
      checkInAt: json['checkInAt']?.toString(),
      checkOutAt: json['checkOutAt']?.toString(),
      classCode: (cls['subjectCode'] ?? '').toString(),
      classSection: (cls['section'] ?? '').toString(),
    );
  }
}

class AppNotification {
  AppNotification({required this.id, required this.title, required this.message, required this.read, required this.createdAt});

  final String id;
  final String title;
  final String message;
  final bool read;
  final String createdAt;

  factory AppNotification.fromJson(Map<String, dynamic> json) {
    return AppNotification(
      id: (json['id'] ?? '').toString(),
      title: (json['title'] ?? '').toString(),
      message: (json['message'] ?? '').toString(),
      read: json['read'] == true,
      createdAt: (json['createdAt'] ?? '').toString(),
    );
  }
}

`class StudentHomePage extends StatefulWidget {
  const StudentHomePage({super.key});

  @override
  State<StudentHomePage> createState() => _StudentHomePageState();
}

class _StudentHomePageState extends State<StudentHomePage> {
  final _apiBaseController = TextEditingController();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();

  final _registerNameController = TextEditingController();
  final _registerStudentIdController = TextEditingController();
  final _registerPasswordController = TextEditingController();
  final _registerCourseController = TextEditingController();
  final _registerYearSectionController = TextEditingController();

  final _profileNameController = TextEditingController();
  final _profileCourseController = TextEditingController();
  final _profileYearSectionController = TextEditingController();
  final _profilePasswordController = TextEditingController();

  String? _sid;
  String? _studentName;
  String? _studentId;
  String? _studentCourse;
  String? _studentYearSection;

  String _status = 'Ready';
  Position? _position;
  String? _checkinFaceDescriptor;
  List<String> _checkinFaceDescriptors = const [];

  int _tabIndex = 0;
  bool _busy = false;
  bool _showRegister = false;
  bool _autoDetectingApi = false;
  String _selectedPeriod = 'weekly';

  List<ClassItem> _classes = [];
  List<ScheduleItem> _schedules = [];
  List<AttendanceRecord> _records = [];
  List<AppNotification> _notifications = [];
  String? _selectedScheduleId;

  static const _days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  bool get _isLoggedIn => _sid != null && _sid!.isNotEmpty;

  @override
  void initState() {
    super.initState();
    _apiBaseController.text = _sanitizeApiBase(_defaultApiBase());
    Future.microtask(() async {
      final detected = await _autoDiscoverApiBase();
      if (!mounted) return;
      if (detected != null && detected != _normalizeApiBase()) {
        _setApiBase(detected);
        _setStatus('API auto-switched to $detected');
      } else {
        _setApiBase(_apiBaseController.text);
      }
    });
  }

  @override
  void dispose() {
    _apiBaseController.dispose();
    _usernameController.dispose();
    _passwordController.dispose();
    _registerNameController.dispose();
    _registerStudentIdController.dispose();
    _registerPasswordController.dispose();
    _registerCourseController.dispose();
    _registerYearSectionController.dispose();
    _profileNameController.dispose();
    _profileCourseController.dispose();
    _profileYearSectionController.dispose();
    _profilePasswordController.dispose();
    super.dispose();
  }

  String _sanitizeApiBase(String value) {
    var text = value.trim();
    if (text.endsWith('/')) text = text.substring(0, text.length - 1);

    try {
      final uri = Uri.parse(text);
      final host = uri.host.toLowerCase();
      if (host == 'localhost' || host == '127.0.0.1') {
        text = _defaultApiBase();
      }
    } catch (_) {}

    if (!text.endsWith('/api')) {
      text = '$text/api';
    }

    if (text.endsWith('/')) text = text.substring(0, text.length - 1);
    return text;
  }

  String _normalizeApiBase() {
    return _sanitizeApiBase(_apiBaseController.text);
  }

  String _defaultApiBase() {
    return 'http://192.168.140.129:3100/api';
  }

  void _setApiBase(String value) {
    final sanitized = _sanitizeApiBase(value);
    setState(() {
      _apiBaseController.text = sanitized;
    });
  }

  String _networkHelpMessage(Object error, Uri uri) {
    final url = uri.toString();
    final lower = error.toString().toLowerCase();
    final host = uri.host.toLowerCase();

    if (lower.contains('connection refused')) {
      if (host == 'localhost' || host == '127.0.0.1') {
        return 'Cannot reach $url. If using Android emulator use http://10.0.2.2:${uri.port}/api. If using a real phone use your PC LAN IP (example: http://192.168.x.x:${uri.port}/api). Also ensure backend is running.';
      }
      if (host == '10.0.2.2') {
        return 'Cannot reach $url from emulator. Ensure backend is running on your PC and listening on port ${uri.port}.';
      }
      return 'Cannot reach $url. Ensure phone and PC are on same Wi-Fi, backend is running, and firewall allows port ${uri.port}.';
    }

    return 'Failed to connect to $url. Check API Base URL and ensure backend is running (sometimes server auto-shifts to 3101+ if 3100 is busy).';
  }

  bool _isPrivateIpv4(InternetAddress address) {
    if (address.type != InternetAddressType.IPv4) return false;
    final octets = address.address.split('.');
    if (octets.length != 4) return false;
    final a = int.tryParse(octets[0]) ?? -1;
    final b = int.tryParse(octets[1]) ?? -1;
    if (a == 10) return true;
    if (a == 192 && b == 168) return true;
    if (a == 172 && b >= 16 && b <= 31) return true;
    return false;
  }

  Future<bool> _isApiHealthy(String base) async {
    try {
      final uri = Uri.parse('$base/health');
      final res = await http.get(uri).timeout(const Duration(milliseconds: 500));
      if (res.statusCode < 200 || res.statusCode >= 300) return false;
      final data = res.body.isEmpty ? <String, dynamic>{} : jsonDecode(res.body) as Map<String, dynamic>;
      return data['ok'] == true;
    } catch (_) {
      return false;
    }
  }

  Future<String?> _scanCandidates(List<String> candidates) async {
    const batchSize = 24;
    for (var i = 0; i < candidates.length; i += batchSize) {
      final end = (i + batchSize) > candidates.length ? candidates.length : i + batchSize;
      final batch = candidates.sublist(i, end);
      final checks = await Future.wait(
        batch.map((candidate) async {
          final ok = await _isApiHealthy(candidate);
          return ok ? candidate : null;
        }),
      );
      for (final match in checks) {
        if (match != null) return match;
      }
    }
    return null;
  }

  Future<String?> _autoDiscoverApiBase({bool deepScan = false}) async {
    final candidates = <String>[];
    final seen = <String>{};

    void addCandidate(String value) {
      final normalized = value.endsWith('/') ? value.substring(0, value.length - 1) : value;
      if (seen.add(normalized)) candidates.add(normalized);
    }

    final current = _normalizeApiBase();
    addCandidate(current);

    try {
      final currentUri = Uri.parse(current);
      final host = currentUri.host;
      final scheme = currentUri.scheme.isEmpty ? 'http' : currentUri.scheme;
      for (var port = 3100; port <= 3110; port += 1) {
        addCandidate('$scheme://$host:$port/api');
      }
    } catch (_) {}

    if (Platform.isAndroid) addCandidate('http://10.0.2.2:3100/api');
    addCandidate('http://localhost:3100/api');
    addCandidate('http://127.0.0.1:3100/api');

    final commonLanHosts = ['192.168.1.100', '192.168.1.10', '192.168.1.2', '192.168.111.129', '192.168.140.129'];
    for (final host in commonLanHosts) {
      for (var port = 3100; port <= 3105; port += 1) {
        addCandidate('http://$host:$port/api');
      }
    }

    final quickMatch = await _scanCandidates(candidates);
    if (quickMatch != null) return quickMatch;

    if (!deepScan) return null;

    final prefixes = <String>{};
    try {
      final interfaces = await NetworkInterface.list(
        type: InternetAddressType.IPv4,
        includeLinkLocal: false,
        includeLoopback: false,
      );
      for (final iface in interfaces) {
        for (final addr in iface.addresses) {
          if (!_isPrivateIpv4(addr)) continue;
          final parts = addr.address.split('.');
          if (parts.length == 4) prefixes.add('${parts[0]}.${parts[1]}.${parts[2]}');
        }
      }
    } catch (_) {}

    if (prefixes.isEmpty) return null;

    final subnetCandidates = <String>[];
    const ports = [3100, 3101, 3102, 3103, 3104, 3105];
    for (final prefix in prefixes) {
      for (var octet = 2; octet <= 254; octet += 1) {
        for (final port in ports) {
          addCandidate('http://$prefix.$octet:$port/api');
          subnetCandidates.add('http://$prefix.$octet:$port/api');
        }
      }
    }

    return _scanCandidates(subnetCandidates);
  }

  Future<http.Response> _sendHttpRequest(String method, Uri uri, Map<String, String> headers, Map<String, dynamic>? body) {
    const timeout = Duration(seconds: 4);
    if (method == 'GET') return http.get(uri, headers: headers).timeout(timeout);
    if (method == 'POST') return http.post(uri, headers: headers, body: jsonEncode(body ?? <String, dynamic>{})).timeout(timeout);
    if (method == 'PUT') return http.put(uri, headers: headers, body: jsonEncode(body ?? <String, dynamic>{})).timeout(timeout);
    throw Exception('Unsupported method: $method');
  }

  Future<void> _detectAndApplyApiBase() async {
    if (_autoDetectingApi) return;
    setState(() {
      _autoDetectingApi = true;
    });
    _setStatus('Detecting API server on local network...');
    try {
      final detected = await _autoDiscoverApiBase(deepScan: true);
      if (detected == null) {
        throw Exception('No API server found. Ensure backend is running and phone/PC are on same Wi-Fi.');
      }
      _setApiBase(detected);
      _setStatus('API detected: $detected');
      _snack('API detected: $detected');
    } catch (e) {
      _setStatus('API detection failed: $e');
      _snack('API detection failed: $e', isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _autoDetectingApi = false;
        });
      }
    }
  }

  ScheduleItem? _findSelectedSchedule() {
    if (_selectedScheduleId == null) return null;
    for (final item in _schedules) {
      if (item.id == _selectedScheduleId) return item;
    }
    return null;
  }

  Future<Map<String, dynamic>> _request(String method, String path, {Map<String, dynamic>? body, String? sid}) async {
    final headers = <String, String>{'Content-Type': 'application/json'};
    final token = sid ?? _sid;
    if (token != null && token.isNotEmpty) headers['Authorization'] = 'Bearer $token';

    final uri = Uri.parse('${_normalizeApiBase()}$path');
    late http.Response res;
    try {
      res = await _sendHttpRequest(method, uri, headers, body);
    } on SocketException catch (e) {
      final detected = await _autoDiscoverApiBase();
      if (detected != null && detected != _normalizeApiBase()) {
        _setApiBase(detected);
        final retryUri = Uri.parse('$detected$path');
        try {
          res = await _sendHttpRequest(method, retryUri, headers, body);
        } on SocketException {
          throw Exception(_networkHelpMessage(e, uri));
        }
      } else {
        throw Exception(_networkHelpMessage(e, uri));
      }
    }

    Map<String, dynamic> data;
    try {
      data = res.body.isEmpty ? <String, dynamic>{} : jsonDecode(res.body) as Map<String, dynamic>;
    } catch (_) {
      data = <String, dynamic>{};
    }

    if (res.statusCode == 404 && (data['error']?.toString().toLowerCase().contains('api route not found') ?? false)) {
      final detected = await _autoDiscoverApiBase();
      if (detected != null && detected != _normalizeApiBase()) {
        _setApiBase(detected);
        final retryUri = Uri.parse('$detected$path');
        final retryRes = await _sendHttpRequest(method, retryUri, headers, body);
        try {
          data = retryRes.body.isEmpty ? <String, dynamic>{} : jsonDecode(retryRes.body) as Map<String, dynamic>;
        } catch (_) {
          data = <String, dynamic>{};
        }
        res = retryRes;
      }
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw Exception(data['error']?.toString() ?? 'Request failed (${res.statusCode})');
    }
    return data;
  }

  Future<Map<String, dynamic>> _get(String path, {String? sid}) => _request('GET', path, sid: sid);
  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body, {String? sid}) => _request('POST', path, body: body, sid: sid);
  Future<Map<String, dynamic>> _put(String path, Map<String, dynamic> body, {String? sid}) => _request('PUT', path, body: body, sid: sid);

  void _setBusy(bool value) {
    if (!mounted) return;
    setState(() {
      _busy = value;
    });
  }

  void _setStatus(String text) {
    if (!mounted) return;
    setState(() {
      _status = text;
    });
  }

  void _snack(String text, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text), backgroundColor: isError ? const Color(0xFFB00020) : null),
    );
  }

  Future<void> _loadMe() async {
    if (!_isLoggedIn) return;
    final me = await _get('/auth/me');
    final user = me['user'] as Map<String, dynamic>?;
    if (user == null) throw Exception('Session expired. Please log in again.');
    if (user['role']?.toString() != 'student') {
      throw Exception('This app is only for students. Admin/Teacher should use web portal.');
    }
    _studentName = (user['name'] ?? 'Student').toString();
    _studentId = user['studentId']?.toString();
    _studentCourse = user['course']?.toString();
    _studentYearSection = user['yearSection']?.toString();
    _profileNameController.text = _studentName ?? '';
    _profileCourseController.text = _studentCourse ?? '';
    _profileYearSectionController.text = _studentYearSection ?? '';
  }

  Future<void> _loadClassesAndSchedules() async {
    if (!_isLoggedIn) return;
    final clsData = await _get('/classes');
    final schData = await _get('/schedules');
    final clsList = (clsData['classes'] as List<dynamic>? ?? const [])
        .map((item) => ClassItem.fromJson(item as Map<String, dynamic>))
        .toList();
    final schList = (schData['schedules'] as List<dynamic>? ?? const [])
        .map((item) => ScheduleItem.fromJson(item as Map<String, dynamic>))
        .toList();
    if (!mounted) return;
    setState(() {
      _classes = clsList;
      _schedules = schList;
      _selectedScheduleId ??= schList.isNotEmpty ? schList.first.id : null;
      if (schList.isEmpty) {
        _selectedScheduleId = null;
      }
    });
    if (schList.isEmpty) {
      _setStatus('No schedules available. Ask teacher/admin to enroll your student account to a class.');
    }
  }

  Future<void> _exportCsv() async {
    if (_records.isEmpty) {
      _snack('No records to export');
      return;
    }
    try {
      final rows = <List<dynamic>>[];
      rows.add(['Date', 'Class Code', 'Section', 'Status', 'Check In', 'Check Out']);
      for (final r in _records) {
        rows.add([r.date, r.classCode, r.classSection, r.status, r.checkInAt ?? '', r.checkOutAt ?? '']);
      }
      final strBuf = StringBuffer();
      for (final row in rows) {
        strBuf.writeln(row.map((e) => '"${e.toString().replaceAll('"', '""')}"').join(','));
      }
      final csvData = strBuf.toString();
      final dir = await getApplicationDocumentsDirectory();
      final path = '${dir.path}/attendance_${DateTime.now().millisecondsSinceEpoch}.csv';
      final file = File(path);
      await file.writeAsString(csvData);
      Share.shareXFiles([XFile(path)], text: 'My Attendance CSV');
    } catch (e) {
      _snack('Error exporting CSV: $e', isError: true);
    }
  }

  Future<void> _exportPdf() async {
    if (_records.isEmpty) {
      _snack('No records to export');
      return;
    }
    try {
      final pdfDocument = pw.Document();
      pdfDocument.addPage(
        pw.Page(
          build: (pw.Context context) {
            return pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text('Attendance Report', style: pw.TextStyle(fontSize: 24, fontWeight: pw.FontWeight.bold)),
                pw.SizedBox(height: 20),
                pw.TableHelper.fromTextArray(
                  context: context,
                  data: <List<String>>[
                    <String>['Date', 'Class Code', 'Section', 'Status', 'Check In', 'Check Out'],
                    ..._records.map((r) => [
                          r.date,
                          r.classCode,
                          r.classSection,
                          r.status,
                          r.checkInAt ?? '',
                          r.checkOutAt ?? ''
                        ])
                  ],
                ),
              ],
            );
          },
        ),
      );
      final dir = await getApplicationDocumentsDirectory();
      final path = '${dir.path}/attendance_${DateTime.now().millisecondsSinceEpoch}.pdf';
      final file = File(path);
      await file.writeAsBytes(await pdfDocument.save());
      Share.shareXFiles([XFile(path)], text: 'My Attendance PDF');
    } catch (e) {
      _snack('Error exporting PDF: $e', isError: true);
    }
  }

  Future<void> _loadAttendanceHistory({String? period}) async {
    if (!_isLoggedIn) return;
    final targetPeriod = period ?? _selectedPeriod;
    final data = await _get('/attendance/my?period=$targetPeriod');
    final rows = (data['records'] as List<dynamic>? ?? const [])
        .map((item) => AttendanceRecord.fromJson(item as Map<String, dynamic>))
        .toList();
    if (!mounted) return;
    setState(() {
      _selectedPeriod = targetPeriod;
      _records = rows;
    });
  }

  Future<void> _loadNotifications() async {
    if (!_isLoggedIn) return;
    final data = await _get('/notifications');
    final rows = (data['notifications'] as List<dynamic>? ?? const [])
        .map((item) => AppNotification.fromJson(item as Map<String, dynamic>))
        .toList();
    if (!mounted) return;
    setState(() {
      _notifications = rows;
    });
  }

  Future<void> _refreshAllStudentData() async {
    if (!_isLoggedIn) return;
    await Future.wait([
      _loadMe(),
      _loadClassesAndSchedules(),
      _loadAttendanceHistory(),
      _loadNotifications(),
    ]);
  }

  Future<void> _login() async {
    _setBusy(true);
    _setStatus('Logging in...');
    try {
      final res = await _post('/auth/login', {
        'username': _usernameController.text.trim(),
        'password': _passwordController.text,
      });
      final user = res['user'] as Map<String, dynamic>?;
      if (user == null || user['role']?.toString() != 'student') {
        throw Exception('This app is for students only. Admin/Teacher should use web portal.');
      }
      _sid = res['sid']?.toString();
      await _refreshAllStudentData();
      _setStatus('Logged in as ${_studentName ?? 'Student'}');
      _snack('Welcome ${_studentName ?? 'Student'}');
    } catch (e) {
      _setStatus('Login failed: $e');
      _snack('Login failed: $e', isError: true);
    } finally {
      _setBusy(false);
    }
  }

  Future<void> _registerStudent() async {
    if (_checkinFaceDescriptor == null) {
      _setStatus('Scan face first for enrollment.');
      _snack('Scan face first for enrollment.', isError: true);
      return;
    }
    _setBusy(true);
    _setStatus('Creating student account...');
    try {
      await _post('/auth/register-student', {
        'name': _registerNameController.text.trim(),
        'studentId': _registerStudentIdController.text.trim(),
        'password': _registerPasswordController.text,
        'course': _registerCourseController.text.trim(),
        'yearSection': _registerYearSectionController.text.trim(),
        'faceDescriptor': _checkinFaceDescriptor,
        'faceDescriptors': _checkinFaceDescriptors,
      });
      _usernameController.text = _registerStudentIdController.text.trim();
      _passwordController.text = _registerPasswordController.text;
      _registerNameController.clear();
      _registerStudentIdController.clear();
      _registerPasswordController.clear();
      _registerCourseController.clear();
      _registerYearSectionController.clear();
      _checkinFaceDescriptor = null;
      _checkinFaceDescriptors = const [];
      if (!mounted) return;
      setState(() {
        _showRegister = false;
      });
      _setStatus('Student account registered with face enrollment. You can now log in.');
      _snack('Registration successful. Please log in.');
    } catch (e) {
      _setStatus('Registration failed: $e');
      _snack('Registration failed: $e', isError: true);
    } finally {
      _setBusy(false);
    }
  }

  Future<void> _logout() async {
    if (_isLoggedIn) {
      try {
        await _post('/auth/logout', {}, sid: _sid);
      } catch (_) {}
    }
    if (!mounted) return;
    setState(() {
      _sid = null;
      _studentName = null;
      _studentId = null;
      _studentCourse = null;
      _studentYearSection = null;
      _classes = [];
      _schedules = [];
      _records = [];
      _notifications = [];
      _position = null;
      _checkinFaceDescriptor = null;
      _checkinFaceDescriptors = const [];
      _selectedScheduleId = null;
      _tabIndex = 0;
      _status = 'Logged out.';
    });
  }

  Future<void> _captureLocation() async {
    _setStatus('Getting high-precision location...\nPlease stand still in open air if possible.');
    try {
      final enabled = await Geolocator.isLocationServiceEnabled();
      if (!enabled) throw Exception('Location service is disabled.');

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        throw Exception('Location permission denied.');
      }

      Position? bestPos;
      
      try {
        final stream = Geolocator.getPositionStream(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.bestForNavigation,
            distanceFilter: 0,
          ),
        );
        
        await for (final pos in stream.take(4).timeout(const Duration(seconds: 15))) {
            if (pos.isMocked) {
              throw Exception('Fake GPS app detected! Please disable spoofing applications to check in.');
            }
            if (bestPos == null || pos.accuracy < bestPos.accuracy) {
              bestPos = pos;
            }
            if (bestPos.accuracy <= 5.0) break;
          }
        } catch (e) {
          if (e is Exception && e.toString().contains('Fake GPS')) rethrow;
        }

        bestPos ??= await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 5),
          ),
        );
        
        if (bestPos.isMocked) {
          throw Exception('Fake GPS app detected! Please disable spoofing applications to check in.');
        }

        setState(() {
          _position = bestPos;
        });
        _setStatus('Location captured: ${bestPos.latitude.toStringAsFixed(6)}, ${bestPos.longitude.toStringAsFixed(6)}\n(Accuracy: ${bestPos.accuracy.toStringAsFixed(1)}m)');
      } catch (e) {
        _setStatus('GPS Error: $e');
        _snack('GPS Error: $e', isError: true);
      }
  }

  Future<void> _scanFace() async {
    _setStatus('Opening camera...');
    try {
      final result = await Navigator.of(context).push<FaceScanResult>(
        MaterialPageRoute(builder: (_) => const FaceScanPage()),
      );
      if (result == null) {
        _setStatus('Face scan cancelled.');
        return;
      }
      if (!mounted) return;
      setState(() {
        _checkinFaceDescriptor = result.primaryDescriptor;
        _checkinFaceDescriptors = result.descriptors;
      });
      _setStatus('Face scan complete. Ready for enrollment/check-in.');
    } catch (e) {
      _setStatus('Face scan failed: $e');
      _snack('Face scan failed: $e', isError: true);
    }
  }

  Future<void> _registerDevice() async {
    if (!_isLoggedIn) {
      _setStatus('Log in first.');
      return;
    }
    _setBusy(true);
    _setStatus('Registering this device...');
    try {
      await _post('/students/register-device', {'deviceId': 'FLUTTER-${Platform.operatingSystem}'}, sid: _sid);
      _setStatus('Device registered successfully.');
      _snack('Device registered.');
      await _loadNotifications();
    } catch (e) {
      _setStatus('Device registration failed: $e');
      _snack('Device registration failed: $e', isError: true);
    } finally {
      _setBusy(false);
    }
  }

  Future<void> _showLocalNotification(String title, String body) async {
    const androidDetails = AndroidNotificationDetails(
      'geoattend_channel',
      'GeoAttend Notifications',
      importance: Importance.max,
      priority: Priority.high,
    );
    const iosDetails = DarwinNotificationDetails();
    const details = NotificationDetails(android: androidDetails, iOS: iosDetails);
    await flutterLocalNotificationsPlugin.show(
      id: math.Random().nextInt(100000),
      title: title,
      body: body,
      notificationDetails: details,
    );
  }

  Future<void> _checkIn() async {
    if (!_isLoggedIn) {
      _setStatus('Log in first.');
      return;
    }
    if (_selectedScheduleId == null || _selectedScheduleId!.isEmpty) {
      _setStatus('Select a schedule first.');
      return;
    }
    if (_position == null) {
      _setStatus('Capture location first.');
      return;
    }
    if (_checkinFaceDescriptor == null) {
      _setStatus('Scan face first.');
      return;
    }

    _setBusy(true);
    _setStatus('Submitting check-in...');
    try {
      final res = await _post('/attendance/check-in', {
        'scheduleId': _selectedScheduleId,
        'lat': _position!.latitude,
        'lng': _position!.longitude,
        'deviceId': 'FLUTTER-${Platform.operatingSystem}',
        'faceDescriptor': _checkinFaceDescriptor,
        'faceDescriptors': _checkinFaceDescriptors,
      }, sid: _sid);
      final msg = 'Attendance recorded: ${res['status'] ?? 'OK'}';
      _setStatus(msg);
      _snack(msg);
      await _showLocalNotification('Check-in Success', msg);
      await _loadAttendanceHistory();
      await _loadNotifications();
    } catch (e) {
      _setStatus('Check-in failed: $e');
      _snack('Check-in failed: $e', isError: true);
    } finally {
      _setBusy(false);
    }
  }

  Future<void> _updateProfile() async {
    if (!_isLoggedIn) {
      _setStatus('Log in first.');
      return;
    }

    _setBusy(true);
    _setStatus('Updating profile...');
    try {
      final body = <String, dynamic>{
        'name': _profileNameController.text.trim(),
        'course': _profileCourseController.text.trim(),
        'yearSection': _profileYearSectionController.text.trim(),
      };
      if (_profilePasswordController.text.trim().isNotEmpty) {
        body['password'] = _profilePasswordController.text;
      }
      await _put('/students/me', body, sid: _sid);
      _profilePasswordController.clear();
      await _loadMe();
      _setStatus('Profile updated.');
      _snack('Profile updated.');
    } catch (e) {
      _setStatus('Profile update failed: $e');
      _snack('Profile update failed: $e', isError: true);
    } finally {
      _setBusy(false);
    }
  }

  Future<void> _markNotificationRead(String id) async {
    if (!_isLoggedIn) return;
    try {
      await _post('/notifications/$id/read', {}, sid: _sid);
      await _loadNotifications();
    } catch (e) {
      _snack('Failed to mark notification: $e', isError: true);
    }
  }

  Widget _heroCard() {
    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF0C8A6C), Color(0xFF0A5F8F)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(22),
      ),
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _isLoggedIn ? 'Welcome, ${_studentName ?? 'Student'}' : 'GeoAttend Student',
            style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          Text(
            _isLoggedIn
                ? '${_studentId ?? ''}${_studentCourse != null ? ' • ${_studentCourse!}' : ''}${_studentYearSection != null ? ' • ${_studentYearSection!}' : ''}'
                : 'Student registration, attendance, and profile in one app.',
            style: const TextStyle(color: Color(0xFFE8F5FF)),
          ),
          const SizedBox(height: 12),
          Text('Status: $_status', style: const TextStyle(color: Colors.white)),
        ],
      ),
    );
  }

  Widget _authCard() {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SegmentedButton<bool>(
              showSelectedIcon: false,
              segments: const [
                ButtonSegment<bool>(value: false, label: Text('Login')),
                ButtonSegment<bool>(value: true, label: Text('Register')),
              ],
              selected: {_showRegister},
              onSelectionChanged: (value) {
                setState(() {
                  _showRegister = value.first;
                });
              },
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _apiBaseController,
              decoration: const InputDecoration(labelText: 'API Base URL', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ActionChip(
                  label: const Text('Android Emulator'),
                  onPressed: () => _setApiBase('http://10.0.2.2:3100/api'),
                ),
                ActionChip(
                  label: const Text('LAN Template'),
                  onPressed: () => _setApiBase('http://192.168.1.100:3100/api'),
                ),
                ActionChip(
                  label: Text(_autoDetectingApi ? 'Detecting...' : 'Auto-detect API'),
                  onPressed: _autoDetectingApi ? null : _detectAndApplyApiBase,
                ),
              ],
            ),
            const SizedBox(height: 4),
            const Text(
              'Use 10.0.2.2 for Android emulator. Use your PC LAN IP for real phone.',
              style: TextStyle(fontSize: 12, color: Color(0xFF607080)),
            ),
            const SizedBox(height: 10),
            if (!_showRegister) ...[
              TextField(
                controller: _usernameController,
                decoration: const InputDecoration(labelText: 'Student ID', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _passwordController,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Password', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _busy ? null : _login,
                icon: const Icon(Icons.login),
                label: const Text('Login as Student'),
              ),
            ] else ...[
              TextField(
                controller: _registerNameController,
                decoration: const InputDecoration(labelText: 'Full Name', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _registerStudentIdController,
                decoration: const InputDecoration(labelText: 'Student ID', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _registerPasswordController,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Password', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _registerCourseController,
                decoration: const InputDecoration(labelText: 'Course', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _registerYearSectionController,
                decoration: const InputDecoration(labelText: 'Year / Section', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 10),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFF3F8FF),
                  border: Border.all(color: const Color(0xFFD5E4FF)),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Text(
                  'Face Enrollment (Required): Scan your face before registering.',
                  style: TextStyle(color: Color(0xFF2D3A4A), fontWeight: FontWeight.w600),
                ),
              ),
              const SizedBox(height: 10),
              FilledButton.tonalIcon(
                onPressed: _busy ? null : _scanFace,
                icon: const Icon(Icons.face_retouching_natural),
                label: Text(_checkinFaceDescriptor == null ? 'Enroll Face (Scan)' : 'Re-enroll Face (Scan)'),
              ),
              if (_checkinFaceDescriptor != null) ...[
                const SizedBox(height: 8),
                const Text('Face scan captured and ready for registration.', style: TextStyle(color: Color(0xFF0C8A6C))),
              ],
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: (_busy || _checkinFaceDescriptor == null) ? null : _registerStudent,
                icon: const Icon(Icons.person_add_alt_1),
                label: const Text('Register Student + Face'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _homeTab() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
      children: [
        _heroCard(),
        const SizedBox(height: 12),
        if (!_isLoggedIn) _authCard(),
        if (_isLoggedIn)
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Student Account', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _profileNameController,
                    decoration: const InputDecoration(labelText: 'Name', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _profileCourseController,
                    decoration: const InputDecoration(labelText: 'Course', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _profileYearSectionController,
                    decoration: const InputDecoration(labelText: 'Year / Section', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _profilePasswordController,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'New Password (optional)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      FilledButton.icon(
                        onPressed: _busy ? null : _updateProfile,
                        icon: const Icon(Icons.save),
                        label: const Text('Save Profile'),
                      ),
                      FilledButton.tonalIcon(
                        onPressed: _busy ? null : _registerDevice,
                        icon: const Icon(Icons.phone_android),
                        label: const Text('Register Device'),
                      ),
                      OutlinedButton.icon(
                        onPressed: _busy ? null : _logout,
                        icon: const Icon(Icons.logout),
                        label: const Text('Logout'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _attendanceTab() {
    if (!_isLoggedIn) {
      return const Center(child: Text('Log in first to use attendance features.'));
    }

    final selected = _findSelectedSchedule();

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
      children: [
        Card(
          elevation: 0,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Attendance Session', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                const SizedBox(height: 10),
                if (_schedules.isEmpty)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFDCE4EF)),
                      color: const Color(0xFFF9FBFD),
                    ),
                    child: const Text(
                      'No schedule to select yet. Teacher/Admin must enroll your account in a class first.',
                      style: TextStyle(color: Color(0xFF566272)),
                    ),
                  )
                else
                  DropdownButtonFormField<String>(
                    key: ValueKey('${_selectedScheduleId ?? 'none'}-${_schedules.length}'),
                    initialValue: _selectedScheduleId,
                    decoration: const InputDecoration(labelText: 'Select Schedule', border: OutlineInputBorder()),
                    items: _schedules
                        .map(
                          (item) => DropdownMenuItem<String>(
                            value: item.id,
                            child: Text('${item.displayName} • ${item.startTime}-${item.endTime}'),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      setState(() {
                        _selectedScheduleId = value;
                      });
                    },
                  ),
                if (_schedules.isEmpty) ...[
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _loadClassesAndSchedules,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Refresh Schedules'),
                  ),
                ],
                if (selected != null) ...[
                  const SizedBox(height: 8),
                  Text('Days: ${selected.daysOfWeek.map((day) => _days[day]).join(', ')}'),
                  const SizedBox(height: 2),
                  Text(
                    'Geofence: ${selected.lat.toStringAsFixed(6)}, ${selected.lng.toStringAsFixed(6)} • ${selected.radiusMeters}m',
                    style: const TextStyle(color: Color(0xFF5A6470)),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),
        Card(
          elevation: 0,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Capture', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    FilledButton.tonalIcon(
                      onPressed: _busy ? null : _captureLocation,
                      icon: const Icon(Icons.my_location),
                      label: const Text('Capture Location'),
                    ),
                    FilledButton.tonalIcon(
                      onPressed: _busy ? null : _scanFace,
                      icon: const Icon(Icons.camera_alt),
                      label: const Text('Scan Face'),
                    ),
                  ],
                ),
                if (_position != null) ...[
                  const SizedBox(height: 8),
                  Text('Location: ${_position!.latitude.toStringAsFixed(6)}, ${_position!.longitude.toStringAsFixed(6)}'),
                ],
                if (_checkinFaceDescriptor != null) ...[
                  const SizedBox(height: 10),
                  const Text('Face scan is ready for check-in.', style: TextStyle(color: Color(0xFF0C8A6C))),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),
        Card(
          elevation: 0,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  onPressed: _busy ? null : _checkIn,
                  icon: const Icon(Icons.login),
                  label: const Text('Check In'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _classesTab() {
    if (!_isLoggedIn) {
      return const Center(child: Text('Log in first to view classes and schedules.'));
    }
    return RefreshIndicator(
      onRefresh: _loadClassesAndSchedules,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        children: [
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('My Classes', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 10),
                  if (_classes.isEmpty)
                    const Text('No classes yet. Ask your teacher/admin to enroll you.')
                  else
                    ..._classes.map(
                      (item) => ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text('${item.subjectCode} • ${item.subjectName}'),
                        subtitle: Text('Section ${item.section} • Room ${item.room}'),
                        trailing: Text('${item.studentCount} students'),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('My Schedules', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 10),
                  if (_schedules.isEmpty)
                    const Text('No schedules yet.')
                  else
                    ..._schedules.map(
                      (item) => ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text('${item.displayName} • ${item.startTime}-${item.endTime}'),
                        subtitle: Text('Days ${item.daysOfWeek.map((day) => _days[day]).join(', ')} • ${item.radiusMeters}m geofence'),
                        trailing: TextButton(
                          onPressed: () {
                            setState(() {
                              _selectedScheduleId = item.id;
                              _tabIndex = 1;
                            });
                          },
                          child: const Text('Use'),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _statusColor(String status) {
    if (status == 'Present') return const Color(0xFF0C8A6C);
    if (status == 'Late') return const Color(0xFFA56500);
    return const Color(0xFFB23A3A);
  }

  Widget _activityTab() {
    if (!_isLoggedIn) {
      return const Center(child: Text('Log in first to view attendance and notifications.'));
    }
    return RefreshIndicator(
      onRefresh: () async {
        await _loadAttendanceHistory();
        await _loadNotifications();
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        children: [
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Attendance History', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                      Row(
                        children: [
                          IconButton(
                            icon: const Icon(Icons.picture_as_pdf, color: Colors.redAccent),
                            onPressed: _exportPdf,
                            tooltip: 'Export PDF',
                          ),
                          IconButton(
                            icon: const Icon(Icons.table_chart, color: Colors.green),
                            onPressed: _exportCsv,
                            tooltip: 'Export CSV',
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  SegmentedButton<String>(
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(value: 'daily', label: Text('Daily')),
                      ButtonSegment(value: 'weekly', label: Text('Weekly')),
                      ButtonSegment(value: 'monthly', label: Text('Monthly')),
                    ],
                    selected: {_selectedPeriod},
                    onSelectionChanged: (value) {
                      _loadAttendanceHistory(period: value.first);
                    },
                  ),
                  const SizedBox(height: 10),
                  if (_records.isEmpty)
                    const Text('No attendance records yet.')
                  else
                    ..._records.map(
                      (record) => Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFDCE4EF)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(child: Text('${record.classCode} • ${record.classSection}')),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: _statusColor(record.status).withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(999),
                                  ),
                                  child: Text(record.status, style: TextStyle(color: _statusColor(record.status))),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text('Date: ${record.date}'),
                            Text('In: ${record.checkInAt ?? '-'}'),
                            Text('Out: ${record.checkOutAt ?? '-'}'),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Expanded(
                        child: Text('Notifications', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                      ),
                      IconButton(
                        onPressed: _busy ? null : _loadNotifications,
                        icon: const Icon(Icons.refresh),
                      ),
                    ],
                  ),
                  if (_notifications.isEmpty)
                    const Text('No notifications yet.')
                  else
                    ..._notifications.map(
                      (notification) => ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(notification.title),
                        subtitle: Text('${notification.message}\n${notification.createdAt}'),
                        isThreeLine: true,
                        trailing: notification.read
                            ? const Icon(Icons.done_all, color: Color(0xFF0C8A6C))
                            : TextButton(
                                onPressed: () => _markNotificationRead(notification.id),
                                child: const Text('Mark read'),
                              ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pages = [_homeTab(), _attendanceTab(), _classesTab(), _activityTab()];

    return Scaffold(
      appBar: AppBar(
        title: const Text('GeoAttend'),
        actions: [
          IconButton(
            onPressed: _busy
                ? null
                : () async {
                    if (!_isLoggedIn) return;
                    _setBusy(true);
                    try {
                      await _refreshAllStudentData();
                      _snack('Data refreshed.');
                    } catch (e) {
                      _snack('Refresh failed: $e', isError: true);
                    } finally {
                      _setBusy(false);
                    }
                  },
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: IndexedStack(index: _tabIndex, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        onDestinationSelected: (index) {
          setState(() {
            _tabIndex = index;
          });
        },
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.how_to_reg_outlined), selectedIcon: Icon(Icons.how_to_reg), label: 'Attendance'),
          NavigationDestination(icon: Icon(Icons.class_outlined), selectedIcon: Icon(Icons.class_), label: 'Classes'),
          NavigationDestination(icon: Icon(Icons.history_outlined), selectedIcon: Icon(Icons.history), label: 'Activity'),
        ],
      ),
    );
  }
}

class FaceScanResult {
  const FaceScanResult({required this.primaryDescriptor, required this.descriptors});

  final String primaryDescriptor;
  final List<String> descriptors;
}

class FaceScanPage extends StatefulWidget {
  const FaceScanPage({super.key});

  @override
  State<FaceScanPage> createState() => _FaceScanPageState();
}

class _FaceScanPageState extends State<FaceScanPage> with SingleTickerProviderStateMixin {
  CameraController? _camera;
  bool _initializing = true;
  bool _processing = false;
  bool _completed = false;
  int _acceptedFrames = 0;
  String _hint = 'Align your face in the center...';
  final List<String> _samples = [];
  DateTime _lastProcessedAt = DateTime.fromMillisecondsSinceEpoch(0);
  AnimationController? _scanAnimController;

  @override
  void initState() {
    super.initState();
    _scanAnimController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(reverse: true);
    _startCamera();
  }

  @override
  void dispose() {
    _scanAnimController?.dispose();
    _camera?.dispose();
    super.dispose();
  }

  Future<void> _startCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) throw Exception('No camera found on device.');
      final front = cameras.where((cam) => cam.lensDirection == CameraLensDirection.front).toList();
      final selected = front.isNotEmpty ? front.first : cameras.first;

      final controller = CameraController(
        selected,
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.yuv420,
      );
      await controller.initialize();
      await controller.startImageStream(_onFrame);
      if (!mounted) return;
      setState(() {
        _camera = controller;
        _initializing = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _initializing = false;
        _hint = 'Failed to open camera: $e';
      });
    }
  }

  Future<void> _onFrame(CameraImage image) async {
    if (_completed || _processing) return;
    final now = DateTime.now();
    if (now.difference(_lastProcessedAt).inMilliseconds < 300) return;
    _lastProcessedAt = now;
    _processing = true;
    try {
      final descriptor = _descriptorFromYPlane(image);
      if (descriptor == null) {
        if (mounted) {
          setState(() {
            _hint = 'Bring your face to the center with good lighting.';
          });
        }
        return;
      }
      _samples.add(descriptor);
      if (_samples.length > 12) {
        _samples.removeAt(0);
      }

      final stable = _stableDescriptors(_samples);
      if (mounted) {
        setState(() {
          _acceptedFrames = stable.length;
          _hint = stable.length >= 8
              ? 'Face scan complete.'
              : 'Scanning face... ${stable.length}/8';
        });
      }

      if (stable.length >= 8 && mounted) {
        _completed = true;
          await _camera?.stopImageStream();
          if (!mounted) return;
          final primary = _findMedoid(stable);
          Navigator.of(context).pop(FaceScanResult(primaryDescriptor: primary, descriptors: stable));
        }
      } catch (e) {
        debugPrint('Frame processing err: $e');
      } finally {
        _processing = false;
      }
    }

    String? _descriptorFromYPlane(CameraImage image) {
      if (image.planes.isEmpty) return null;
    final yPlane = image.planes.first;
    final bytes = yPlane.bytes;
    final rowStride = yPlane.bytesPerRow;
    final width = image.width;
    final height = image.height;
    if (width < 80 || height < 80) return null;

    final side = math.min(width, height);
    final cropSide = (side * 0.62).round();
    final left = ((width - cropSide) / 2).round();
    final top = ((height - cropSide) / 2).round();

    const size = 16;
    final luminance = <int>[];
    for (var y = 0; y < size; y++) {
      final srcY = top + ((y + 0.5) * cropSide / size).floor();
      for (var x = 0; x < size; x++) {
        final srcX = left + ((x + 0.5) * cropSide / size).floor();
        if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) {
          luminance.add(0);
          continue;
        }
        final offset = srcY * rowStride + srcX;
        if (offset < 0 || offset >= bytes.length) {
          luminance.add(0);
          continue;
        }
        luminance.add(bytes[offset]);
      }
    }

    final avg = luminance.reduce((a, b) => a + b) / luminance.length;
    return luminance.map((value) => value >= avg ? '1' : '0').join();
  }

  List<String> _stableDescriptors(List<String> samples) {
    if (samples.length < 8) return const [];
    final medoid = _findMedoid(samples);
    final stable = samples
        .where((sample) => _hammingDistance(sample, medoid) <= 48)
        .toSet()
        .toList(growable: false);
    return stable;
  }

  String _findMedoid(List<String> descriptors) {
      if (descriptors.isEmpty) return '';
      var best = descriptors.first;
      var bestScore = double.infinity;
      for (final candidate in descriptors) {
        num score = 0;
        for (final other in descriptors) {
          score += _hammingDistance(candidate, other);
        }
        if (score < bestScore) {
          best = candidate;
          bestScore = score.toDouble();
        }
      }
      return best;
    }

  int _hammingDistance(String a, String b) {
    final len = math.min(a.length, b.length);
    var distance = (a.length - b.length).abs();
    for (var i = 0; i < len; i++) {
      if (a[i] != b[i]) distance += 1;
    }
    return distance;
  }

  @override
  Widget build(BuildContext context) {
    final camera = _camera;
    return Scaffold(
      appBar: AppBar(title: const Text('Face Scan')),
      body: _initializing
          ? const Center(child: CircularProgressIndicator())
          : camera == null || !camera.value.isInitialized
              ? Center(child: Text(_hint, textAlign: TextAlign.center))
              : Column(
                  children: [
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(16),
                          child: Stack(
                            fit: StackFit.loose,
                            children: [
                              Center(
                                child: AspectRatio(
                                  aspectRatio: 1 / camera.value.aspectRatio,
                                  child: CameraPreview(camera),
                                ),
                              ),
                              Center(
                                child: SizedBox(
                                  width: 250,
                                  height: 250,
                                  child: Stack(
                                    children: [
                                      Container(
                                        decoration: BoxDecoration(
                                          border: Border.all(color: Colors.greenAccent, width: 3),
                                          borderRadius: BorderRadius.circular(20),
                                        ),
                                      ),
                                      if (_scanAnimController != null)
                                        AnimatedBuilder(
                                          animation: _scanAnimController!,
                                          builder: (context, child) {
                                            return Positioned(
                                              top: _scanAnimController!.value * 240,
                                              left: 0,
                                              right: 0,
                                              child: Container(
                                                height: 4,
                                                decoration: BoxDecoration(
                                                  color: Colors.greenAccent.withOpacity(0.8),
                                                  boxShadow: const [
                                                    BoxShadow(color: Colors.greenAccent, blurRadius: 8, spreadRadius: 2)
                                                  ],
                                                ),
                                              ),
                                            );
                                          },
                                        ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
                      child: Column(
                        children: [
                          Text(_hint),
                          const SizedBox(height: 6),
                          Text('Stable frames: $_acceptedFrames/8'),
                          const SizedBox(height: 10),
                          OutlinedButton(
                            onPressed: () => Navigator.of(context).pop(),
                            child: const Text('Cancel'),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
}


