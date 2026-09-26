/**
 * Script sementara untuk generate file qris.svg (placeholder QRIS)
 * Jalankan: node make-qris.js
 */
const fs = require('fs');

const svg = [
  "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300' viewBox='0 0 300 300'>",
  "<rect width='300' height='300' fill='white'/>",
  "<text x='150' y='28' font-family='Arial' font-size='13' font-weight='bold' fill='#222' text-anchor='middle'>RAMI COFFEE &amp; EATERY</text>",
  // Top-left finder
  "<rect x='20' y='38' width='118' height='118' fill='black'/>",
  "<rect x='27' y='45' width='104' height='104' fill='white'/>",
  "<rect x='37' y='55' width='84' height='84' fill='black'/>",
  "<rect x='47' y='65' width='64' height='64' fill='white'/>",
  "<rect x='57' y='75' width='44' height='44' fill='black'/>",
  // Top-right finder
  "<rect x='162' y='38' width='118' height='118' fill='black'/>",
  "<rect x='169' y='45' width='104' height='104' fill='white'/>",
  "<rect x='179' y='55' width='84' height='84' fill='black'/>",
  "<rect x='189' y='65' width='64' height='64' fill='white'/>",
  "<rect x='199' y='75' width='44' height='44' fill='black'/>",
  // Bottom-left finder
  "<rect x='20' y='164' width='118' height='118' fill='black'/>",
  "<rect x='27' y='171' width='104' height='104' fill='white'/>",
  "<rect x='37' y='181' width='84' height='84' fill='black'/>",
  "<rect x='47' y='191' width='64' height='64' fill='white'/>",
  "<rect x='57' y='201' width='44' height='44' fill='black'/>",
  // Data modules (bottom-right area)
  "<rect x='162' y='164' width='10' height='10' fill='black'/>",
  "<rect x='178' y='164' width='10' height='10' fill='black'/>",
  "<rect x='194' y='164' width='10' height='10' fill='black'/>",
  "<rect x='210' y='164' width='10' height='10' fill='black'/>",
  "<rect x='162' y='180' width='10' height='10' fill='black'/>",
  "<rect x='194' y='180' width='10' height='10' fill='black'/>",
  "<rect x='226' y='180' width='10' height='10' fill='black'/>",
  "<rect x='162' y='196' width='10' height='10' fill='black'/>",
  "<rect x='178' y='196' width='10' height='10' fill='black'/>",
  "<rect x='210' y='196' width='10' height='10' fill='black'/>",
  "<rect x='242' y='196' width='10' height='10' fill='black'/>",
  "<rect x='178' y='212' width='10' height='10' fill='black'/>",
  "<rect x='210' y='212' width='10' height='10' fill='black'/>",
  "<rect x='226' y='212' width='10' height='10' fill='black'/>",
  "<rect x='162' y='228' width='10' height='10' fill='black'/>",
  "<rect x='194' y='228' width='10' height='10' fill='black'/>",
  "<rect x='242' y='228' width='10' height='10' fill='black'/>",
  "<rect x='178' y='244' width='10' height='10' fill='black'/>",
  "<rect x='210' y='244' width='10' height='10' fill='black'/>",
  "<rect x='226' y='244' width='10' height='10' fill='black'/>",
  "<rect x='162' y='260' width='10' height='10' fill='black'/>",
  "<rect x='194' y='260' width='10' height='10' fill='black'/>",
  "<rect x='226' y='260' width='10' height='10' fill='black'/>",
  "<rect x='242' y='260' width='10' height='10' fill='black'/>",
  "<text x='150' y='292' font-family='Arial' font-size='10' fill='#888' text-anchor='middle'>Upload QR Code QRIS asli di Admin Panel</text>",
  "</svg>"
].join('\n');

fs.writeFileSync('qris.png', svg);
fs.writeFileSync('qris.svg', svg);
console.log('OK: qris.png dan qris.svg berhasil dibuat (placeholder SVG).');
