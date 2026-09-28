<?php
function sendAppEmail($recipient, $subject, $textBody)
{
    if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Invalid recipient'];
    }

    $config = [];
    $configPath = __DIR__ . '/../data/mail-config.php';
    if (is_file($configPath)) {
        $loaded = include $configPath;
        if (is_array($loaded))
            $config = $loaded;
    }

    $fromEmail = $config['from_email'] ?? 'no-reply@localhost';
    $fromName = $config['from_name'] ?? '4A Store';
    if (!filter_var($fromEmail, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Invalid sender'];
    }

    if (empty($config['host'])) {
        $headers = "From: {$fromName} <{$fromEmail}>\r\n";
        $headers .= "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n";
        $sent = @mail($recipient, '=?UTF-8?B?' . base64_encode($subject) . '?=', $textBody, $headers);
        return ['ok' => $sent, 'error' => $sent ? '' : 'PHP mail() failed'];
    }

    $host = (string) $config['host'];
    $port = (int) ($config['port'] ?? 465);
    $secure = strtolower((string) ($config['secure'] ?? 'ssl'));
    $remote = $secure === 'ssl' ? "ssl://{$host}:{$port}" : "{$host}:{$port}";
    $context = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $socket = @stream_socket_client($remote, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $context);
    if (!$socket)
        return ['ok' => false, 'error' => "SMTP connect failed: {$errstr} ({$errno})"];
    stream_set_timeout($socket, 15);

    $read = static function () use ($socket) {
        $response = '';
        while (($line = fgets($socket, 515)) !== false) {
            $response .= $line;
            if (strlen($line) < 4 || $line[3] === ' ')
                break;
        }
        return $response;
    };
    $command = static function ($value) use ($socket, $read) {
        fwrite($socket, $value . "\r\n");
        return $read();
    };
    $code = static function ($response) {
        return (int) substr(trim($response), 0, 3);
    };
    $fail = static function ($message) use ($socket) {
        fclose($socket);
        return ['ok' => false, 'error' => $message];
    };

    if ($code($read()) !== 220)
        return $fail('SMTP greeting failed');
    $serverName = preg_replace('/[^a-zA-Z0-9.-]/', '', (string) ($_SERVER['SERVER_NAME'] ?? 'localhost'));
    if ($code($command("EHLO {$serverName}")) !== 250)
        return $fail('SMTP EHLO failed');
    if ($secure === 'tls') {
        if ($code($command('STARTTLS')) !== 220)
            return $fail('SMTP STARTTLS failed');
        $crypto = STREAM_CRYPTO_METHOD_TLS_CLIENT;
        if (defined('STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT'))
            $crypto |= STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT;
        if (!stream_socket_enable_crypto($socket, true, $crypto))
            return $fail('SMTP TLS negotiation failed');
        if ($code($command("EHLO {$serverName}")) !== 250)
            return $fail('SMTP EHLO after TLS failed');
    }

    $username = (string) ($config['username'] ?? '');
    $password = (string) ($config['password'] ?? '');
    if ($username !== '' || $password !== '') {
        if ($code($command('AUTH LOGIN')) !== 334)
            return $fail('SMTP authentication unavailable');
        if ($code($command(base64_encode($username))) !== 334)
            return $fail('SMTP username rejected');
        if ($code($command(base64_encode($password))) !== 235)
            return $fail('SMTP password rejected');
    }
    if ($code($command("MAIL FROM:<{$fromEmail}>")) !== 250)
        return $fail('SMTP sender rejected');
    $recipientResponse = $command("RCPT TO:<{$recipient}>");
    if (!in_array($code($recipientResponse), [250, 251], true))
        return $fail('SMTP recipient rejected');
    if ($code($command('DATA')) !== 354)
        return $fail('SMTP DATA rejected');

    $safeFromName = '=?UTF-8?B?' . base64_encode($fromName) . '?=';
    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $message = "From: {$safeFromName} <{$fromEmail}>\r\n";
    $message .= "To: <{$recipient}>\r\nSubject: {$encodedSubject}\r\n";
    $message .= "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n";
    $normalizedBody = str_replace(["\r\n", "\r"], "\n", $textBody);
    $normalizedBody = preg_replace('/^\./m', '..', $normalizedBody);
    $message .= str_replace("\n", "\r\n", $normalizedBody);
    fwrite($socket, $message . "\r\n.\r\n");
    $response = $read();
    $command('QUIT');
    fclose($socket);

    return $code($response) === 250
        ? ['ok' => true, 'error' => '']
        : ['ok' => false, 'error' => 'SMTP did not accept the message'];
}
?>