create table if not exists public.app_settings (
  id smallint primary key default 1 check (id = 1),
  one_device_per_student boolean not null default true,
  late_grace_minutes integer not null default 15,
  check_out_enabled boolean not null default true,
  face_verification_required boolean not null default true,
  max_face_hamming_distance integer not null default 14,
  updated_at timestamptz not null default now()
);

create table if not exists public.users (
  id text primary key,
  role text not null check (role in ('admin', 'teacher', 'student')),
  name text not null,
  username text,
  student_id text,np
  password_hash text not null,
  course text,
  year_section text,
  device_id text,
  face_descriptor text,
  face_enrolled_at timestamptz,
  created_at timestamptz not null
);

create unique index if not exists users_username_unique on public.users (username) where username is not null;
create unique index if not exists users_student_id_unique on public.users (student_id) where student_id is not null;

create table if not exists public.classes (
  id text primary key,
  subject_code text not null,
  subject_name text not null,
  section text not null,
  room text not null,
  location_name text,
  teacher_id text not null references public.users(id) on delete restrict,
  created_at timestamptz not null
);

create table if not exists public.schedules (
  id text primary key,
  class_id text not null references public.classes(id) on delete cascade,
  days_of_week integer[] not null,
  start_time text not null,
  end_time text not null,
  geofence jsonb not null,
  created_at timestamptz not null
);

create table if not exists public.enrollments (
  id text primary key,
  class_id text not null references public.classes(id) on delete cascade,
  student_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null
);

create unique index if not exists enrollments_class_student_unique on public.enrollments (class_id, student_id);

create table if not exists public.attendance (
  id text primary key,
  class_id text not null references public.classes(id) on delete cascade,
  schedule_id text not null references public.schedules(id) on delete cascade,
  student_id text not null references public.users(id) on delete cascade,
  date text not null,
  status text not null,
  check_in_at timestamptz,
  check_out_at timestamptz,
  distance_meters integer,
  location jsonb,
  device_id text,
  face_verified boolean,
  face_distance integer,
  created_at timestamptz not null
);

create index if not exists attendance_student_date_idx on public.attendance (student_id, date);

create table if not exists public.notifications (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  type text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null
);

create table if not exists public.sessions (
  sid text primary key,
  user_id text not null references public.users(id) on delete cascade,
  expires_at timestamptz not null
);
