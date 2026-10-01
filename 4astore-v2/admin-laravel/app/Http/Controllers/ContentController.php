<?php

namespace App\Http\Controllers;

use App\Models\Category;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ContentController extends Controller
{
    // ---- Categories ----
    public function categories(Request $request)
    {
        $action = $request->input('action');
        $c = $request->input('category', []);
        if ($action === 'add') {
            $cat = Category::create([
                'name' => $c['name'], 'slug' => $c['slug'], 'icon' => $c['icon'] ?? null,
                'image' => $c['image'] ?? null, 'hidden' => (bool) ($c['hidden'] ?? false),
                'age_restricted' => (bool) ($c['ageRestricted'] ?? false), 'warning' => $c['warning'] ?? null,
            ]);
            return response()->json(['success' => true, 'category' => $cat]);
        }
        if ($action === 'update') {
            $cat = Category::find((int) ($c['id'] ?? 0));
            if (!$cat) return response()->json(['success' => false, 'message' => 'Category not found'], 404);
            $cat->update([
                'name' => $c['name'] ?? $cat->name, 'slug' => $c['slug'] ?? $cat->slug,
                'icon' => $c['icon'] ?? $cat->icon, 'image' => $c['image'] ?? $cat->image,
                'hidden' => (bool) ($c['hidden'] ?? false), 'age_restricted' => (bool) ($c['ageRestricted'] ?? false),
                'warning' => $c['warning'] ?? null,
            ]);
            return response()->json(['success' => true, 'category' => $cat]);
        }
        if ($action === 'delete') {
            Category::where('id', (int) $request->input('id'))->delete();
            return response()->json(['success' => true, 'message' => 'Category deleted']);
        }
        return response()->json(['success' => false, 'message' => 'Invalid action'], 400);
    }

    // ---- Settings ----
    public function settings(Request $request)
    {
        $map = [
            'storeEmail' => 'store_email', 'deliveryCharge' => 'delivery_charge',
            'freeDeliveryAbove' => 'free_delivery_above', 'upiId' => 'upi_id', 'upiName' => 'upi_name',
            'hideMrp' => 'hide_mrp', 'storePhone' => 'store_phone', 'storeAddress' => 'store_address',
            'storeLatitude' => 'store_latitude', 'storeLongitude' => 'store_longitude',
            'serviceableVillages' => 'serviceable_villages',
        ];
        $update = [];
        foreach ($map as $in => $col) {
            if ($request->has($in)) {
                $val = $request->input($in);
                $update[$col] = $col === 'hide_mrp' ? (int) (bool) $val : $val;
            }
        }
        if ($update) {
            DB::table('settings')->where('id', 1)->update($update);
        }
        return response()->json(['success' => true, 'message' => 'Settings saved']);
    }

    // ---- Banners (config) ----
    public function banners(Request $request)
    {
        $banners = $request->input('banners');
        if (!is_array($banners)) {
            return response()->json(['success' => false, 'message' => 'banners array required'], 422);
        }
        DB::table('config')->where('id', 1)->update(['banners' => json_encode($banners, JSON_UNESCAPED_UNICODE)]);
        return response()->json(['success' => true, 'count' => count($banners)]);
    }

    // ---- Announcement ----
    public function announcement(Request $request)
    {
        $cur = DB::table('announcements')->where('row_id', 1)->first();
        $curArr = $cur ? (array) $cur : [];
        $fields = [
            'text' => $request->input('text', $curArr['text'] ?? ''),
            'image' => $request->input('image', $curArr['image'] ?? ''),
            'target' => $request->input('target', $curArr['target'] ?? 'all'),
            'cta_text' => $request->input('ctaText', $curArr['cta_text'] ?? ''),
            'cta_link' => $request->input('ctaLink', $curArr['cta_link'] ?? ''),
            'enabled' => (int) (bool) $request->input('enabled', $curArr['enabled'] ?? false),
        ];
        $changed = false;
        foreach (['text', 'image', 'target', 'cta_text', 'cta_link'] as $k) {
            if (($curArr[$k] ?? null) !== $fields[$k]) $changed = true;
        }
        $fields['id'] = (int) ($curArr['id'] ?? 0) + ($changed ? 1 : 0);
        DB::table('announcements')->where('row_id', 1)->update($fields);
        return response()->json(['success' => true, 'message' => 'Announcement saved', 'id' => $fields['id']]);
    }
}
