<?php

namespace App\Http\Controllers;

use App\Services\PushService;
use Illuminate\Http\Request;

class PushController extends Controller
{
    public function send(Request $request, PushService $push)
    {
        $target = $request->input('target', 'all');
        $title = (string) $request->input('title');
        $body = (string) $request->input('body');
        if ($title === '' || $body === '') {
            return response()->json(['success' => false, 'message' => 'title and body required'], 422);
        }
        $push->broadcast($target, $title, $body, $request->input('link'));
        return response()->json(['success' => true, 'message' => 'Notification sent']);
    }
}
