-- ============================================================
-- RAMI - PEMBERIAN ROLE ADMIN
-- ============================================================
-- 1. Buat akun email/password terlebih dahulu melalui:
--    Supabase Dashboard > Authentication > Users > Add user
--    ATAU jalankan: npm run create-admin
--
-- 2. Ganti hanya nilai admin_email di bawah, kemudian Run.
--
-- Password sengaja TIDAK disimpan di SQL. Jangan INSERT manual ke
-- auth.users karena Supabase Auth juga mengelola hash, identity, dan session.

do $$
declare
    admin_email constant text := 'admin@example.com';
    affected_rows integer;
begin
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object('role', 'admin')
    where lower(email) = lower(admin_email);

    get diagnostics affected_rows = row_count;
    if affected_rows = 0 then
        raise exception 'User % belum ada. Buat user lewat Supabase Auth terlebih dahulu.', admin_email;
    end if;
end
$$;

-- Verifikasi seluruh akun yang memiliki role admin.
select id, email, raw_app_meta_data ->> 'role' as role, created_at
from auth.users
where raw_app_meta_data ->> 'role' = 'admin'
order by created_at;
