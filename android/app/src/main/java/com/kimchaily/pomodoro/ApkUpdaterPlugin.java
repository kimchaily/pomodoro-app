package com.kimchaily.pomodoro;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Lädt eine neue APK aus dem GitHub-Release herunter und startet den
 * System-Installer. Der Fortgang wird als Events gemeldet:
 * "installStarted" sobald der Installer geöffnet wurde,
 * "downloadFailed" mit { message } bei Fehlern.
 */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {

    private long downloadId = -1;
    private BroadcastReceiver receiver;

    /** Darf diese App Paket-Installationen anstoßen (Android 8+)? */
    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            allowed = getContext().getPackageManager().canRequestPackageInstalls();
        }
        JSObject ret = new JSObject();
        ret.put("allowed", allowed);
        call.resolve(ret);
    }

    /** Öffnet die Systemeinstellung „Unbekannte Apps installieren" für diese App. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    /** Lädt die APK von der übergebenen URL und öffnet danach den Installer. */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url fehlt");
            return;
        }

        Context ctx = getContext();
        File dest = new File(ctx.getExternalFilesDir(null), "pomodoro-update.apk");
        if (dest.exists() && !dest.delete()) {
            call.reject("Alte Update-Datei konnte nicht entfernt werden");
            return;
        }

        DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) {
            call.reject("DownloadManager nicht verfügbar");
            return;
        }

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
            .setTitle("Pomodoro-Update")
            .setDescription("Neue Version wird heruntergeladen …")
            .setMimeType("application/vnd.android.package-archive")
            .setDestinationUri(Uri.fromFile(dest))
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);

        // Ein evtl. noch registrierter Receiver eines früheren Versuchs wird ersetzt.
        unregisterReceiverQuietly();

        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id != downloadId) return;
                unregisterReceiverQuietly();

                int status = DownloadManager.STATUS_FAILED;
                try (Cursor cur = dm.query(new DownloadManager.Query().setFilterById(id))) {
                    if (cur != null && cur.moveToFirst()) {
                        status = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    }
                }

                if (status != DownloadManager.STATUS_SUCCESSFUL) {
                    JSObject err = new JSObject();
                    err.put("message", "Download fehlgeschlagen (Status " + status + ")");
                    notifyListeners("downloadFailed", err);
                    return;
                }

                try {
                    Uri apkUri = FileProvider.getUriForFile(
                        c, c.getPackageName() + ".fileprovider", dest);
                    Intent install = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(apkUri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    c.startActivity(install);
                    notifyListeners("installStarted", new JSObject());
                } catch (Exception e) {
                    JSObject err = new JSObject();
                    err.put("message", "Installer konnte nicht geöffnet werden: " + e.getMessage());
                    notifyListeners("downloadFailed", err);
                }
            }
        };

        ContextCompat.registerReceiver(
            ctx, receiver,
            new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            ContextCompat.RECEIVER_EXPORTED
        );

        downloadId = dm.enqueue(request);
        call.resolve();
    }

    private void unregisterReceiverQuietly() {
        if (receiver != null) {
            try { getContext().unregisterReceiver(receiver); } catch (Exception ignored) { }
            receiver = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        unregisterReceiverQuietly();
    }
}
