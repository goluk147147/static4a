package com.store4a.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.speech.tts.TextToSpeech;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import android.content.ContentValues;
import android.content.ContentResolver;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private ProgressBar progressBar;
    private SwipeRefreshLayout swipeRefresh;
    private LinearLayout noInternetLayout;

    // App loads the subdomain directly (no redirect). Both domains are treated
    // as "our site" so navigation stays inside the app either way.
    private static final String WEBSITE_URL = "https://4astore.webtoolsz.com/";
    private static final int FILE_CHOOSER_REQUEST_CODE = 100;
    private static final int PERMISSION_REQUEST_CODE = 200;

    private ValueCallback<Uri[]> filePathCallback;
    private String cameraPhotoPath;

    private TextToSpeech tts;
    private boolean ttsReady = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        progressBar = findViewById(R.id.progressBar);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        noInternetLayout = findViewById(R.id.noInternetLayout);

        // Initialise Hindi Text-to-Speech for the payment voice guide
        tts = new TextToSpeech(getApplicationContext(), status -> {
            if (status == TextToSpeech.SUCCESS && tts != null) {
                try {
                    int r = tts.setLanguage(new Locale("hi", "IN"));
                    if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                        tts.setLanguage(Locale.US); // fallback if Hindi voice not installed
                    }
                } catch (Exception e) {
                    try {
                        tts.setLanguage(Locale.US);
                    } catch (Exception ex) {
                        /* ignore */ }
                }
                ttsReady = true;
            }
        });

        requestPermissions();
        setupWebView();
        setupSwipeRefresh();

        if (isNetworkAvailable()) {
            loadWebsite();
            checkForUpdate();
        } else {
            showNoInternet();
        }
    }

    // ==========================================================
    // AUTO UPDATE CHECK (self-hosted APK, not on Play Store)
    // Reads version.json from the server; if a newer versionCode is
    // available, shows a popup to download the new APK.
    // ==========================================================
    private static final String VERSION_URL = "https://4astore.webtoolsz.com/data/version.json";

    private void checkForUpdate() {
        new Thread(() -> {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(VERSION_URL + "?t=" + System.currentTimeMillis())
                        .openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setRequestProperty("Cache-Control", "no-cache");
                BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = r.readLine()) != null)
                    sb.append(line);
                r.close();
                conn.disconnect();

                JSONObject json = new JSONObject(sb.toString());
                int latest = json.optInt("versionCode", 0);
                final String apkUrl = json.optString("url", "https://4astore.webtoolsz.com/4AStore.apk");
                final String message = json.optString("message", "A new update is available.");
                final boolean force = json.optBoolean("forceUpdate", false);

                int current = getCurrentVersionCode();
                if (latest > current) {
                    runOnUiThread(() -> showUpdateDialog(apkUrl, message, force));
                }
            } catch (Exception e) {
                // No network / version.json missing -> silently skip
            }
        }).start();
    }

    private int getCurrentVersionCode() {
        try {
            PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return (int) pInfo.getLongVersionCode();
            }
            return pInfo.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    private void showUpdateDialog(String apkUrl, String message, boolean force) {
        AlertDialog.Builder b = new AlertDialog.Builder(this);
        b.setTitle("🚀 Update Available");
        b.setMessage(message);
        b.setCancelable(!force);
        b.setPositiveButton("Update Now", (dialog, which) -> {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl)));
            } catch (Exception e) {
                Toast.makeText(this, "Could not open download link", Toast.LENGTH_SHORT).show();
            }
        });
        if (!force) {
            b.setNegativeButton("Later", (dialog, which) -> dialog.dismiss());
        }
        b.show();
    }

    private void requestPermissions() {
        String[] permissions = {
                Manifest.permission.CAMERA,
                Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
        };

        boolean needRequest = false;
        for (String permission : permissions) {
            if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
                needRequest = true;
                break;
            }
        }

        if (needRequest) {
            ActivityCompat.requestPermissions(this, permissions, PERMISSION_REQUEST_CODE);
        }
    }

    private void setupWebView() {
        WebSettings webSettings = webView.getSettings();

        // Basic settings
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setGeolocationEnabled(true);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Allow pinch-zoom for accessibility, but hide the on-screen zoom buttons
        webSettings.setBuiltInZoomControls(true);
        webSettings.setDisplayZoomControls(false);
        webSettings.setSupportZoom(true);
        webSettings.setLoadWithOverviewMode(true);
        webSettings.setUseWideViewPort(true);
        webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Enable file upload
        webSettings.setAllowFileAccessFromFileURLs(true);
        webSettings.setAllowUniversalAccessFromFileURLs(true);

        // Enable database and storage
        webSettings.setDatabaseEnabled(true);
        webSettings.setJavaScriptCanOpenWindowsAutomatically(true);

        // Support multiple windows
        webSettings.setSupportMultipleWindows(true);

        // Enable media playback
        webSettings.setMediaPlaybackRequiresUserGesture(false);

        // Cookie support
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        // JS bridge so the web app can save generated files (e.g. invoice PDF)
        // inside the WebView, where blob:/data: downloads normally fail.
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidApp");

        // WebViewClient - Handle URL loading including UPI intents
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();

                // Handle UPI payments
                if (url.startsWith("upi://") || url.startsWith("intent://") ||
                        url.startsWith("phonepe://") || url.startsWith("gpay://") ||
                        url.startsWith("paytmmp://") || url.startsWith("tez://")) {
                    try {
                        Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                        if (intent.resolveActivity(getPackageManager()) != null) {
                            startActivity(intent);
                        } else {
                            // If UPI app not found, try generic UPI
                            if (url.startsWith("intent://")) {
                                String fallbackUrl = intent.getStringExtra("browser_fallback_url");
                                if (fallbackUrl != null) {
                                    view.loadUrl(fallbackUrl);
                                }
                            } else {
                                Toast.makeText(MainActivity.this, "No UPI app found", Toast.LENGTH_SHORT).show();
                            }
                        }
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Cannot open payment app", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }

                // Handle tel: links
                if (url.startsWith("tel:")) {
                    Intent intent = new Intent(Intent.ACTION_DIAL, Uri.parse(url));
                    startActivity(intent);
                    return true;
                }

                // Handle mailto: links
                if (url.startsWith("mailto:")) {
                    Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse(url));
                    startActivity(intent);
                    return true;
                }

                // Handle WhatsApp links
                if (url.contains("wa.me") || url.contains("whatsapp.com") || url.startsWith("whatsapp://")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "WhatsApp not installed", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }

                // Handle market/play store links
                if (url.startsWith("market://") || url.contains("play.google.com")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                    } catch (Exception e) {
                        // Ignore
                    }
                    return true;
                }

                // Keep our site (subdomain or main domain) inside the WebView
                if (url.contains("4astore.webtoolsz.com") || url.contains("4astore.com")) {
                    return false;
                }

                // Other external links - open in browser
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                } catch (Exception e) {
                    // Ignore
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                progressBar.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                if (!isNetworkAvailable()) {
                    showNoInternet();
                }
            }
        });

        // WebChromeClient - Handle file uploads and permissions
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                if (newProgress == 100) {
                    progressBar.setVisibility(View.GONE);
                } else {
                    progressBar.setVisibility(View.VISIBLE);
                }
            }

            // Handle links opened with target="_blank" / window.open so they
            // don't create a dead blank window. We grab the intended URL and
            // route it through the normal navigation logic instead.
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog,
                    boolean isUserGesture, android.os.Message resultMsg) {
                WebView.HitTestResult result = view.getHitTestResult();
                String target = (result != null) ? result.getExtra() : null;
                if (target != null && !target.isEmpty()) {
                    if (target.contains("4astore.webtoolsz.com") || target.contains("4astore.com")) {
                        // Same-site link — keep it inside the app
                        view.loadUrl(target);
                    } else {
                        // External (WhatsApp/maps/etc.) — open with the right app/browser
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(target)));
                        } catch (Exception e) {
                            view.loadUrl(target);
                        }
                    }
                }
                return false; // we handled it ourselves; no new window needed
            }

            // File upload support
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCb,
                    FileChooserParams fileChooserParams) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = filePathCb;

                // Create camera intent
                Intent takePictureIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                if (takePictureIntent.resolveActivity(getPackageManager()) != null) {
                    File photoFile = null;
                    try {
                        photoFile = createImageFile();
                    } catch (IOException ex) {
                        // Error
                    }

                    if (photoFile != null) {
                        cameraPhotoPath = "file:" + photoFile.getAbsolutePath();
                        Uri photoUri = FileProvider.getUriForFile(
                                MainActivity.this,
                                getApplicationContext().getPackageName() + ".fileprovider",
                                photoFile);
                        takePictureIntent.putExtra(MediaStore.EXTRA_OUTPUT, photoUri);
                    } else {
                        takePictureIntent = null;
                    }
                }

                // Create file chooser intent
                Intent contentSelectionIntent = new Intent(Intent.ACTION_GET_CONTENT);
                contentSelectionIntent.addCategory(Intent.CATEGORY_OPENABLE);
                contentSelectionIntent.setType("image/*");

                // Combine intents
                Intent[] intentArray;
                if (takePictureIntent != null) {
                    intentArray = new Intent[] { takePictureIntent };
                } else {
                    intentArray = new Intent[0];
                }

                Intent chooserIntent = new Intent(Intent.ACTION_CHOOSER);
                chooserIntent.putExtra(Intent.EXTRA_INTENT, contentSelectionIntent);
                chooserIntent.putExtra(Intent.EXTRA_TITLE, "Select Image");
                chooserIntent.putExtra(Intent.EXTRA_INITIAL_INTENTS, intentArray);

                startActivityForResult(chooserIntent, FILE_CHOOSER_REQUEST_CODE);
                return true;
            }

            // Geolocation permission
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                    GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            // Permission request (camera, mic etc.)
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        // Download support (real file URLs like the APK). blob:/data: downloads
        // are handled by the JS bridge (AndroidApp.saveBase64File) instead.
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                    String mimetype, long contentLength) {
                if (url == null)
                    return;
                // These are handled in-page by jsPDF + the JS bridge
                if (url.startsWith("blob:") || url.startsWith("data:")) {
                    return;
                }
                try {
                    android.app.DownloadManager.Request req = new android.app.DownloadManager.Request(Uri.parse(url));
                    req.setMimeType(mimetype);
                    String name = URLUtil.guessFileName(url, contentDisposition, mimetype);
                    req.addRequestHeader("User-Agent", userAgent);
                    req.setNotificationVisibility(
                            android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                    android.app.DownloadManager dm = (android.app.DownloadManager) getSystemService(
                            Context.DOWNLOAD_SERVICE);
                    if (dm != null) {
                        dm.enqueue(req);
                        Toast.makeText(MainActivity.this, "Downloading " + name, Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    // Fallback: open in browser (e.g. APK that needs external installer)
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                    } catch (Exception ex) {
                        Toast.makeText(MainActivity.this, "Cannot download file", Toast.LENGTH_SHORT).show();
                    }
                }
            }
        });
    }

    // ==========================================================
    // JS BRIDGE: lets the web app save a base64 file to the phone.
    // Called from JS as: AndroidApp.saveBase64File(base64, filename, mime)
    // ==========================================================
    public class AndroidBridge {
        // Returns the installed app version so the web page can display it.
        @JavascriptInterface
        public String getAppVersion() {
            try {
                PackageInfo p = getPackageManager().getPackageInfo(getPackageName(), 0);
                return p.versionName + " (" + getCurrentVersionCode() + ")";
            } catch (Exception e) {
                return "";
            }
        }

        // Manually trigger an update check (e.g. from a button in the web UI).
        @JavascriptInterface
        public void checkUpdateNow() {
            checkForUpdate();
        }

        // Speak Hindi text using the phone's native TTS (guaranteed in-app).
        @JavascriptInterface
        public void speak(String text) {
            if (text == null || text.isEmpty())
                return;
            // Diagnostic: confirm the bridge is actually being called from JS
            runOnUiThread(() -> Toast.makeText(MainActivity.this,
                    ttsReady ? "🔊 Playing voice..." : "⏳ Voice engine loading...", Toast.LENGTH_SHORT).show());
            speakWithRetry(text, 0);
        }

        @JavascriptInterface
        public void saveBase64File(String base64Data, String fileName, String mimeType) {
            try {
                // Strip a data URI prefix if present ("data:application/pdf;base64,...")
                String clean = base64Data;
                int comma = clean.indexOf(',');
                if (clean.startsWith("data:") && comma != -1) {
                    clean = clean.substring(comma + 1);
                }
                final byte[] bytes = Base64.decode(clean, Base64.DEFAULT);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    // Android 10+ : save via MediaStore Downloads (no permission needed)
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                    values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    ContentResolver resolver = getContentResolver();
                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        OutputStream os = resolver.openOutputStream(uri);
                        if (os != null) {
                            os.write(bytes);
                            os.close();
                        }
                    }
                } else {
                    // Older Android : write to the public Downloads folder
                    File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (!dir.exists())
                        dir.mkdirs();
                    File outFile = new File(dir, fileName);
                    FileOutputStream fos = new FileOutputStream(outFile);
                    fos.write(bytes);
                    fos.close();
                }

                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Saved to Downloads: " + fileName, Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Could not save file", Toast.LENGTH_SHORT).show());
            }
        }
    }

    // Speak text; if TTS isn't ready yet (init still running), retry a few times.
    private void speakWithRetry(final String text, final int attempt) {
        runOnUiThread(() -> {
            if (tts != null && ttsReady) {
                // Turn media volume up so the voice guide is clearly audible
                try {
                    android.media.AudioManager am = (android.media.AudioManager) getSystemService(
                            Context.AUDIO_SERVICE);
                    if (am != null) {
                        int max = am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC);
                        am.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, max, 0);
                    }
                } catch (Exception e) {
                    /* ignore */ }

                android.os.Bundle params = new android.os.Bundle();
                params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
                params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, android.media.AudioManager.STREAM_MUSIC);
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "pay_guide");
            } else if (attempt < 20) {
                // TTS engine still initialising — retry shortly (up to ~6s)
                webView.postDelayed(() -> speakWithRetry(text, attempt + 1), 300);
            } else {
                // Gave up: engine never became ready (no TTS engine / voice on device)
                Toast.makeText(MainActivity.this,
                        "Voice not available. Install a Text-to-Speech voice in phone Settings.",
                        Toast.LENGTH_LONG).show();
            }
        });
    }

    private File createImageFile() throws IOException {
        String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(new Date());
        String imageFileName = "JPEG_" + timeStamp + "_";
        File storageDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        return File.createTempFile(imageFileName, ".jpg", storageDir);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (filePathCallback == null)
                return;

            Uri[] results = null;

            if (resultCode == Activity.RESULT_OK) {
                if (data == null || data.getData() == null) {
                    // Camera photo was taken
                    if (cameraPhotoPath != null) {
                        results = new Uri[] { Uri.parse(cameraPhotoPath) };
                    }
                } else {
                    // File was selected from gallery
                    String dataString = data.getDataString();
                    if (dataString != null) {
                        results = new Uri[] { Uri.parse(dataString) };
                    }
                }
            }

            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    private void setupSwipeRefresh() {
        swipeRefresh.setColorSchemeColors(
                getResources().getColor(R.color.primary, getTheme()));
        swipeRefresh.setOnRefreshListener(() -> {
            if (isNetworkAvailable()) {
                webView.reload();
            } else {
                swipeRefresh.setRefreshing(false);
                showNoInternet();
            }
        });
    }

    private void loadWebsite() {
        noInternetLayout.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        webView.loadUrl(WEBSITE_URL);
    }

    private void showNoInternet() {
        webView.setVisibility(View.GONE);
        noInternetLayout.setVisibility(View.VISIBLE);
        progressBar.setVisibility(View.GONE);
        Toast.makeText(this, "No Internet Connection", Toast.LENGTH_SHORT).show();
    }

    public void retryConnection(View view) {
        if (isNetworkAvailable()) {
            loadWebsite();
        } else {
            Toast.makeText(this, "Still no internet. Please check your connection.", Toast.LENGTH_SHORT).show();
        }
    }

    private boolean isNetworkAvailable() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
        return activeNetwork != null && activeNetwork.isConnectedOrConnecting();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        super.onDestroy();
    }

    private long lastBackPress = 0;

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            // Require a double back-press to exit (prevents accidental exit)
            long now = System.currentTimeMillis();
            if (now - lastBackPress < 2000) {
                super.onBackPressed();
            } else {
                lastBackPress = now;
                Toast.makeText(this, "Press back again to exit", Toast.LENGTH_SHORT).show();
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
            @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // Permissions handled - WebView will work with whatever permissions granted
    }
}
