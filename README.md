# GeoAttend (Split Stack)

This project is now split by role and platform:

- **Backend API**: Node.js (existing server)
- **Admin/Teacher Web**: React + TypeScript (`web-admin`)
- **Student Mobile App**: Flutter (`student_app`)

## 1) Backend API

```bash
npm install
npm start
```

API runs at:

- `http://localhost:3100`
- LAN: `http://<your-pc-ip>:3100`

### Auth for multi-client apps

- `POST /api/auth/login` now returns `sid`.
- Use token auth header for React/Flutter:
  - `Authorization: Bearer <sid>`
- Cookie auth still works for same-origin clients.

## 2) Admin/Teacher Web (React + TypeScript)

Folder: `web-admin`

Install + run:

```bash
npm run web:install
npm run web:dev
```

Open: `http://localhost:5173`

Default API base URL is `http://localhost:3100/api`.
You can override via env:

```bash
VITE_API_BASE=http://192.168.111.129:3100/api
```

### Web role restriction

- Web portal allows only `admin` and `teacher` accounts.
- Student accounts are blocked and redirected to use Flutter app.

### Server-hosted web UI

- Root path `/` now serves `web-admin/dist` (React build).
- Legacy `public` web UI is no longer served by `server.js`.
- Build web-admin first before `npm start` if you need server-hosted UI:

```bash
npm run web:build
npm start
```

## 3) Student App (Flutter)

Folder: `student_app`

```bash
cd student_app
flutter pub get
flutter run
```

In app, set API base URL to your LAN API URL, example:

- `http://192.168.111.129:3100/api`

Current student app flow includes:

- student login
- smartphone location capture
- live face scan (no manual photo capture)
- face enrollment (`/api/students/register-face`)
- attendance check-in (`/api/attendance/check-in`)

## 4) Windows firewall / phone access

If phone cannot reach your PC URL, allow inbound TCP `3100` with admin PowerShell:

```powershell
New-NetFirewallRule -DisplayName "GeoAttend 3100" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3100 -Profile Public,Private
```

Or set Wi-Fi profile to **Private** and retry.

## Notes

- Existing backend domain logic (geofence, attendance, reports) is preserved.
- New clients consume the same API.
- This is a migration baseline; expand features in React/Flutter screens as needed.

## Supabase Migration Starter

You now have migration assets in:

- [supabase/schema.sql](supabase/schema.sql)
- [supabase/README.md](supabase/README.md)

Generate SQL seed from current JSON datastore:

```bash
npm run supabase:export-sql
```

This outputs `supabase/seed.sql` from `data/db.json`.

### Runtime Switch (Optional)

Backend now supports Supabase at runtime.

Set these environment variables before `npm start`:

```bash
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

If both are set, backend reads/writes Supabase tables.
If not set, backend continues using local `data/db.json`.
