# Supabase Migration (GeoAttend)

This folder contains the SQL assets to move your current JSON datastore into Supabase Postgres.

## Files

- `schema.sql` → creates all required tables.
- `seed.sql` → generated from current `data/db.json` using the export script.

## Generate seed SQL from current JSON

From project root:

```bash
npm run supabase:export-sql
```

This reads `data/db.json` and writes `supabase/seed.sql`.

## Apply in Supabase SQL Editor

1. Open Supabase Dashboard → SQL Editor.
2. Run `supabase/schema.sql` first.
3. Run `supabase/seed.sql` second.

## Next step (app code)

Current backend still uses `data/db.json` at runtime.

If you want full runtime migration, next step is replacing `src/db.js` file read/write functions with Postgres/Supabase queries.
