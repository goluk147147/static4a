<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    protected $table = 'orders';
    public $timestamps = true;

    protected $fillable = [
        'order_id', 'user_id', 'customer', 'items', 'subtotal', 'discount',
        'delivery_charge', 'total_amount', 'payment_method', 'payment_reference',
        'order_status', 'order_date', 'delivery_address', 'rider_id', 'rider_name',
        'rider_mobile', 'assigned_at', 'delivered_at', 'created_by', 'reminder_count',
    ];

    protected $casts = [
        'customer' => 'array',
        'items' => 'array',
        'delivery_address' => 'array',
        'order_date' => 'datetime',
        'assigned_at' => 'datetime',
        'delivered_at' => 'datetime',
    ];
}
