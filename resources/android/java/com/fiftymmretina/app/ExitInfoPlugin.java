package com.fiftymmretina.app;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;

/**
 * S2 · NATIVE EXIT REASONS. Why did this app's earlier processes end?
 *
 * Android keeps its own record of that (ApplicationExitInfo, Android 11 /
 * API 30 and later): a Java crash, a native crash, a kill for low memory, an
 * "app not responding" kill. A native crash or an out-of-memory kill never
 * reaches JavaScript, so the web telemetry cannot see it. This plugin hands
 * the OS record to the web layer, which sends one telemetry row per bad exit
 * on the next start (src/lib/native/exitReasons.ts).
 *
 * Free: it is an OS API, no SDK, no account, no extra network call.
 * Copied into the generated project by scripts/android-native-plugins.mjs
 * (android-build.yml) and registered in MainActivity there.
 *
 * Contract (asserted by src/lib/native/__tests__/exitReasons.test.ts):
 *   ExitInfo.recent() -> { supported: boolean,
 *                          exits: [{ reason, timestamp, foreground }] }
 *   reason     one of "crash" | "crash_native" | "low_memory" | "anr";
 *              other reasons (user swipe, update, normal exit) are left out.
 *   timestamp  ms since the epoch (ApplicationExitInfo.getTimestamp()).
 *   foreground true when the process was visible to the member when it died.
 * Before Android 11 it resolves { supported: false, exits: [] }.
 */
@CapacitorPlugin(name = "ExitInfo")
public class ExitInfoPlugin extends Plugin {

    private static final int MAX_EXITS = 16;

    @PluginMethod
    public void recent(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray exits = new JSArray();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            ret.put("supported", false);
            ret.put("exits", exits);
            call.resolve(ret);
            return;
        }
        try {
            ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            List<ApplicationExitInfo> list = am.getHistoricalProcessExitReasons(null, 0, MAX_EXITS);
            for (ApplicationExitInfo e : list) {
                String reason = reasonName(e.getReason());
                if (reason == null) continue;
                JSObject o = new JSObject();
                o.put("reason", reason);
                o.put("timestamp", e.getTimestamp());
                o.put("foreground", e.getImportance() <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE);
                exits.put(o);
            }
            ret.put("supported", true);
            ret.put("exits", exits);
            call.resolve(ret);
        } catch (Exception ex) {
            call.reject("exit reasons unavailable", "EXITINFO_UNAVAILABLE");
        }
    }

    static String reasonName(int reason) {
        switch (reason) {
            case ApplicationExitInfo.REASON_CRASH:
                return "crash";
            case ApplicationExitInfo.REASON_CRASH_NATIVE:
                return "crash_native";
            case ApplicationExitInfo.REASON_LOW_MEMORY:
                return "low_memory";
            case ApplicationExitInfo.REASON_ANR:
                return "anr";
            default:
                return null;
        }
    }
}
