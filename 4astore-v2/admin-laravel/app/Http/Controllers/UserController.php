<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;

class UserController extends Controller
{
    private array $allowedPermissions = [
        'dashboard', 'orders', 'riderTracking', 'products', 'categories',
        'banners', 'ads', 'users', 'earnings', 'settings', 'team',
    ];

    public function index()
    {
        return response()->json(['success' => true, 'users' => User::orderBy('id', 'desc')->get()]);
    }

    /** Assign a role to a user BY MOBILE NUMBER (owner/superadmin only). */
    public function assignRole(Request $request)
    {
        $claims = $request->attributes->get('jwt');
        if (!in_array($claims['role'] ?? '', ['owner', 'superadmin'], true)) {
            return response()->json(['success' => false, 'message' => 'Owner access required'], 403);
        }

        $mobile = preg_replace('/\D+/', '', (string) $request->input('mobile'));
        $role = $request->input('role');
        $permissions = array_values(array_intersect(
            is_array($request->input('permissions')) ? $request->input('permissions') : [],
            $this->allowedPermissions
        ));

        if (!preg_match('/^[6-9]\d{9}$/', $mobile) || !in_array($role, ['admin', 'rider', 'customer'], true)) {
            return response()->json(['success' => false, 'message' => 'Valid mobile and role required'], 422);
        }
        if ($role === 'admin' && count($permissions) === 0) {
            return response()->json(['success' => false, 'message' => 'At least one permission required for admin'], 422);
        }

        $user = User::where('mobile', $mobile)->first();
        if (!$user) {
            return response()->json(['success' => false, 'message' => 'User not found for this mobile number'], 404);
        }

        $user->role = $role;
        $user->permissions = $role === 'admin' ? $permissions : [];
        $user->backend_rider = $role === 'rider';
        $user->save();

        return response()->json(['success' => true, 'message' => "Role '{$role}' assigned to {$mobile}", 'user' => $user]);
    }
}
