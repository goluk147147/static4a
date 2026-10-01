<?php

use App\Http\Controllers\ContentController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\ProductController;
use App\Http\Controllers\PushController;
use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

// All admin endpoints verify the SAME JWT the Node API issues, and enforce
// role/permission via the `admin.jwt:<permission>` middleware.

Route::prefix('admin')->group(function () {
    // Orders
    Route::middleware('admin.jwt:orders')->group(function () {
        Route::get('/orders', [OrderController::class, 'index']);
        Route::post('/orders/status', [OrderController::class, 'updateStatus']);
        Route::post('/orders/delete', [OrderController::class, 'destroy']);
    });

    // Products
    Route::middleware('admin.jwt:products')->post('/products', [ProductController::class, 'handle']);

    // Categories
    Route::middleware('admin.jwt:categories')->post('/categories', [ContentController::class, 'categories']);

    // Settings
    Route::middleware('admin.jwt:settings')->post('/settings', [ContentController::class, 'settings']);

    // Banners
    Route::middleware('admin.jwt:banners')->post('/banners', [ContentController::class, 'banners']);

    // Announcement + push broadcast
    Route::middleware('admin.jwt:ads')->group(function () {
        Route::post('/announcement', [ContentController::class, 'announcement']);
        Route::post('/push/send', [PushController::class, 'send']);
    });

    // Users (list needs `users`; assignRole is owner-only, checked in controller)
    Route::middleware('admin.jwt:users')->get('/users', [UserController::class, 'index']);
    Route::middleware('admin.jwt')->post('/assignRole', [UserController::class, 'assignRole']);
});
