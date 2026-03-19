# GeoAttend Student App

Flutter mobile app for **students only**.

Admin and teacher workflows stay in the web portal.

## Features

- Student registration in-app
- Student login (student ID + password)
- Class and schedule viewing
- Attendance check-in
- Location capture + selfie capture
- Face enrollment
- Attendance history (daily/weekly/monthly)
- Notifications list + mark as read
- Student profile update

## Run

1. Start backend API from project root:

```bash
npm install
npm start
```

2. Run Flutter app:

```bash
cd student_app
flutter pub get
flutter run
```

3. In app, set API Base URL to your server:

- Local emulator: `http://10.0.2.2:3100/api` (Android emulator)
- Same machine: `http://localhost:3100/api`
- Physical phone (same Wi-Fi): `http://<your-pc-ip>:3100/api`
