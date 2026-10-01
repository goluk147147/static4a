<?php

namespace App\Http\Controllers;

use App\Models\Order;
use App\Services\PushService;
use Illuminate\Http\Request;

class OrderController extends Controller
{
    public function index()
    {
        return response()->json(['success' => true, 'orders' => Order::orderBy('id', 'desc')->get()]);
    }

    public function updateStatus(Request $request, PushService $push)
    {
        $orderId = (string) $request->input('orderId');
        $status = (string) $request->input('status');
        if ($orderId === '' || $status === '') {
            return response()->json(['success' => false, 'message' => 'Order ID and status required'], 422);
        }
        $order = Order::where('order_id', $orderId)->first();
        if (!$order) {
            return response()->json(['success' => false, 'message' => 'Order not found'], 404);
        }
        $order->order_status = $status;
        if ($status === 'Delivered') {
            $order->delivered_at = now();
        }
        $order->save();

        $push->notifyCustomerStatus($order);

        return response()->json(['success' => true, 'message' => 'Status updated']);
    }

    public function destroy(Request $request)
    {
        $orderId = preg_replace('/[^A-Za-z0-9_-]/', '', (string) $request->input('orderId'));
        $deleted = Order::where('order_id', $orderId)->delete();
        if (!$deleted) {
            return response()->json(['success' => false, 'message' => 'Order not found'], 404);
        }
        return response()->json(['success' => true, 'message' => 'Order deleted']);
    }
}
