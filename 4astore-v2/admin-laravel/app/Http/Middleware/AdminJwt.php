<?php

namespace App\Http\Middleware;

use App\Support\JwtGuard;
use Closure;
use Illuminate\Http\Request;

/**
 * Route middleware: `admin.jwt:orders` requires a valid JWT whose user is
 * owner/superadmin, or an admin holding the given permission.
 */
class AdminJwt
{
    public function handle(Request $request, Closure $next, string $permission = null)
    {
        $claims = JwtGuard::fromRequest($request);
        if (!$claims) {
            return response()->json(['success' => false, 'message' => 'Login required'], 401);
        }

        $role = $claims['role'] ?? '';
        $permissions = $claims['permissions'] ?? [];

        if (!in_array($role, ['owner', 'superadmin', 'admin'], true)) {
            return response()->json(['success' => false, 'message' => 'Admin access required'], 403);
        }

        $isSuper = in_array($role, ['owner', 'superadmin'], true);
        if ($permission && !$isSuper) {
            if (!in_array('*', $permissions, true) && !in_array($permission, $permissions, true)) {
                return response()->json(['success' => false, 'message' => "Permission required: {$permission}"], 403);
            }
        }

        $request->attributes->set('jwt', $claims);
        return $next($request);
    }
}
