<?php
// ==========================================================
// SMTP / MAIL CONFIGURATION
// Order emails are sent using these SMTP details.
// If 'host' is empty, the system falls back to PHP mail().
//
// ---- USING GMAIL (free & recommended) --------------------
// 1. Turn ON 2-Step Verification on the Gmail account:
//    https://myaccount.google.com/security
// 2. Create an "App Password":
//    https://myaccount.google.com/apppasswords
//    (choose "Mail" -> generate -> copy the 16-character code)
// 3. Paste that 16-char code (no spaces) into 'password' below.
//    Your normal Gmail login password will NOT work here.
// ==========================================================

return [
    'host'       => 'smtp.gmail.com',
    'port'       => 465,
    'secure'     => 'ssl',
    'username'   => 'online4astore@gmail.com', // your Gmail address
    'password'   => 'dlurroskzgtvsqyd',        // Gmail App Password (16 chars, no spaces)
    'from_email' => 'online4astore@gmail.com', // must be the same Gmail address
    'from_name'  => '4A Store Orders',
];
