/**
 * Membuat akun admin Supabase secara aman melalui Auth Admin API.
 * Password dibaca dari environment dan tidak disimpan di source code/SQL.
 *
 * PowerShell:
 *   $env:ADMIN_EMAIL="admin@contoh.com"
 *   $env:ADMIN_PASSWORD="password-yang-kuat"
 *   npm run create-admin
 */

require('dotenv').config();

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || '');

if (!url || !secret) throw new Error('SUPABASE_URL dan SUPABASE_SECRET_KEY wajib diisi');
if (!email) throw new Error('ADMIN_EMAIL wajib diisi');
if (password.length < 12) throw new Error('ADMIN_PASSWORD minimal 12 karakter');

async function main() {
    const response = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
            apikey: secret,
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            app_metadata: { role: 'admin' }
        })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.message || data.error || `HTTP ${response.status}`);
    console.log(`Admin Supabase berhasil dibuat: ${data.email}`);
    console.log('Hapus ADMIN_PASSWORD dari environment terminal setelah selesai.');
}

main().catch((error) => {
    console.error(`Gagal membuat admin: ${error.message}`);
    process.exitCode = 1;
});
