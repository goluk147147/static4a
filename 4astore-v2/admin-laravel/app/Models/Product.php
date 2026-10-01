<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Product extends Model
{
    protected $table = 'products';
    public $timestamps = true;

    protected $fillable = [
        'name', 'brand', 'category', 'weight', 'mrp', 'price',
        'discount', 'image', 'description', 'features', 'in_stock',
    ];

    protected $casts = [
        'features' => 'array',
        'in_stock' => 'boolean',
        'mrp' => 'float',
        'price' => 'float',
    ];
}
