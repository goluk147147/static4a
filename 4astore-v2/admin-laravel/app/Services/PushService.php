<?php

namespace App\Services;

use App\Models\Order;
use Illuminate\Support\Facades\Http;

/**
 * The Node API owns FCM. Laravel forwards push requests to Node's
 * internal push service so there is one Firebase integration.
 * Set NODE_PUSH_URL in .env (e.g. http://localhost:4000/api/push/send).
 * In dev without it, this no-ops (logs only).
 */
class PushService
{
    public function broadcast(string $target, string $title, string $body, ?string $link = null): void
    {
        $url = env('NODE_PUSH_URL');
        if (!$url) {
            logger()->info("[push:dev] target={$target} title={$title}");
            return;
        }
        try {
            Http::timeout(5)->post($url, compact('target', 'title', 'body', 'link'));
        } catch (\Throwable $e) {
            logger()->warning('[push] forward failed: ' . $e->getMessage());
        }
    }

    public function notifyCustomerStatus(Order $order): void
    {
        $this->broadcast(
            'order_' . $order->order_id,
            "Order {$order->order_id}",
            "Status: {$order->order_status}",
            "/track/{$order->order_id}"
        );
    }
}
