<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;

class User extends Authenticatable
{
    protected $table = 'users';
    public $timestamps = true;

    protected $fillable = [
        'name', 'mobile', 'username', 'email', 'recovery_email', 'recovery_email_verified',
        'password', 'role', 'permissions', 'backend_rider', 'custom_delivery',
        'registered_at', 'last_login',
    ];

    protected $hidden = ['password'];

    protected $casts = [
        'permissions' => 'array',
        'backend_rider' => 'boolean',
        'recovery_email_verified' => 'boolean',
    ];
}
