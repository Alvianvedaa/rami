-- ============================================================
-- RAMI - PERBAIKAN IZIN DATABASE SUPABASE
-- ============================================================
-- Jalankan file ini SATU KALI di Supabase Dashboard > SQL Editor.
-- Ini memperbaiki error: permission denied for table products/settings/etc.

begin;

-- PostgREST membutuhkan izin schema sebelum dapat mengakses tabel.
grant usage on schema public to anon, authenticated, service_role;

-- Storefront hanya boleh membaca data publik. RLS policy yang sudah ada
-- tetap membatasi produk/promo yang aktif.
grant select on table
    public.products,
    public.promos,
    public.settings
to anon, authenticated;

-- Semua operasi tulis/baca dilakukan backend memakai secret/service key.
grant all privileges on table
    public.products,
    public.orders,
    public.order_items,
    public.promos,
    public.settings,
    public.activity_logs,
    public.admin_sessions
to service_role;

-- BIGSERIAL memakai sequence terpisah saat INSERT order_items/activity_logs.
grant usage, select, update on all sequences in schema public to service_role;

-- Pastikan tabel/sequence yang dibuat kemudian memiliki izin yang sama.
alter default privileges in schema public
grant all privileges on tables to service_role;

alter default privileges in schema public
grant usage, select, update on sequences to service_role;

commit;

-- Verifikasi hak akses backend. Semua nilai harus true.
select
    has_schema_privilege('service_role', 'public', 'USAGE') as schema_usage,
    has_table_privilege('service_role', 'public.products', 'SELECT') as products_select,
    has_table_privilege('service_role', 'public.orders', 'SELECT,INSERT,UPDATE,DELETE') as orders_all,
    has_table_privilege('service_role', 'public.order_items', 'SELECT,INSERT,UPDATE,DELETE') as order_items_all,
    has_table_privilege('service_role', 'public.settings', 'SELECT,INSERT,UPDATE,DELETE') as settings_all,
    has_table_privilege('service_role', 'public.promos', 'SELECT,INSERT,UPDATE,DELETE') as promos_all,
    has_table_privilege('service_role', 'public.activity_logs', 'SELECT,INSERT') as logs_access;
