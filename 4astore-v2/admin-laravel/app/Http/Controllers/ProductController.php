<?php

namespace App\Http\Controllers;

use App\Models\Product;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    public function handle(Request $request)
    {
        $action = $request->input('action');

        if (in_array($action, ['add', 'update'], true)) {
            $p = $request->input('product', []);
            if (empty($p['name']) || empty($p['category'])) {
                return response()->json(['success' => false, 'message' => 'Product name and category are required'], 422);
            }
            $mrp = (float) ($p['mrp'] ?? 0);
            $price = (float) ($p['price'] ?? 0);
            $discount = isset($p['discount']) && $p['discount'] !== ''
                ? (int) $p['discount']
                : ($mrp > 0 && $price <= $mrp ? (int) round((($mrp - $price) / $mrp) * 100) : 0);

            $data = [
                'name' => $p['name'],
                'brand' => $p['brand'] ?? '',
                'category' => $p['category'],
                'weight' => $p['weight'] ?? '',
                'mrp' => $mrp,
                'price' => $price,
                'discount' => $discount,
                'image' => $p['image'] ?? '',
                'description' => $p['description'] ?? '',
                'features' => is_array($p['features'] ?? null) ? $p['features'] : [],
                'in_stock' => (bool) ($p['inStock'] ?? true),
            ];

            if ($action === 'add') {
                $product = Product::create($data);
                return response()->json(['success' => true, 'message' => 'Product added', 'product' => $product]);
            }
            $id = (int) ($p['id'] ?? $request->input('id'));
            $product = Product::find($id);
            if (!$product) {
                return response()->json(['success' => false, 'message' => 'Product not found'], 404);
            }
            $product->update($data);
            return response()->json(['success' => true, 'message' => 'Product updated', 'product' => $product]);
        }

        if ($action === 'delete') {
            Product::where('id', (int) $request->input('id'))->delete();
            return response()->json(['success' => true, 'message' => 'Product deleted']);
        }

        return response()->json(['success' => false, 'message' => 'Invalid action'], 400);
    }
}
