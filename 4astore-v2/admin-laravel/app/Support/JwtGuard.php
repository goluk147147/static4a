<?php

namespace App\Support;

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

/**
 * Verifies the SAME JWT access token issued by the Node API.
 * Node signs with HS256 using JWT_SECRET; we verify with the identical secret.
 */
class JwtGuard
{
    public static function decode(string $token): ?array
    {
        $secret = env('JWT_SECRET', '');
        if ($secret === '') {
            return null;
        }
        try {
            $payload = JWT::decode($token, new Key($secret, 'HS256'));
            return json_decode(json_encode($payload), true);
        } catch (\Throwable $e) {
            return null;
        }
    }

    public static function fromRequest(\Illuminate\Http\Request $request): ?array
    {
        $header = $request->header('Authorization', '');
        if (str_starts_with($header, 'Bearer ')) {
            return self::decode(substr($header, 7));
        }
        $cookie = $request->cookie('access_token');
        return $cookie ? self::decode($cookie) : null;
    }
}
