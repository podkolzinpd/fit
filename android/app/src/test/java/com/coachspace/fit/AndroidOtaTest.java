package com.coachspace.fit;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

import android.content.Context;
import android.os.Looper;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import io.capawesome.capacitorjs.plugins.liveupdate.LiveUpdate;
import io.capawesome.capacitorjs.plugins.liveupdate.LiveUpdateConfig;
import io.capawesome.capacitorjs.plugins.liveupdate.LiveUpdatePlugin;
import io.capawesome.capacitorjs.plugins.liveupdate.LiveUpdatePreferences;
import io.capawesome.capacitorjs.plugins.liveupdate.classes.options.DownloadBundleOptions;
import io.capawesome.capacitorjs.plugins.liveupdate.classes.options.SetNextBundleOptions;
import io.capawesome.capacitorjs.plugins.liveupdate.interfaces.EmptyCallback;
import io.capawesome.capacitorjs.plugins.liveupdate.interfaces.NonEmptyCallback;
import io.capawesome.capacitorjs.plugins.liveupdate.interfaces.Result;
import java.io.*;
import java.lang.reflect.Field;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

/** Real plugin, crypto, extraction, SharedPreferences and Bridge rollback under
 * Android's JVM test runtime. This does not replace acceptance on a real phone. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
@LooperMode(LooperMode.Mode.PAUSED)
public class AndroidOtaTest {
    private byte[] fixture() throws Exception {
        try (InputStream stream = getClass().getResourceAsStream("/ota/bundle.zip")) {
            assertNotNull("Run generate-android-ota-native-fixtures.mjs", stream);
            return stream.readAllBytes();
        }
    }
    private JSONObject metadata() throws Exception {
        try (InputStream stream = getClass().getResourceAsStream("/ota/metadata.json")) {
            assertNotNull(stream);
            return new JSONObject(new String(stream.readAllBytes(), StandardCharsets.UTF_8));
        }
    }
    private LiveUpdate downloader() throws Exception {
        LiveUpdateConfig config = new LiveUpdateConfig();
        config.setPublicKey(metadata().getString("publicKey"));
        config.setHttpTimeout(5000);
        return new LiveUpdate(config, RuntimeEnvironment.getApplication());
    }
    private <T extends Result> JSObject result(Consumer<NonEmptyCallback<T>> operation) {
        AtomicReference<JSObject> value = new AtomicReference<>();
        operation.accept(new NonEmptyCallback<T>() {
            public void success(T result) { value.set(result.toJSObject()); }
            public void error(Exception error) { throw new AssertionError(error); }
        });
        assertNotNull(value.get()); return value.get();
    }
    private EmptyCallback success() {
        return new EmptyCallback() {
            public void success() {}
            public void error(Exception error) { throw new AssertionError(error); }
        };
    }
    private LiveUpdate engine(Bridge bridge) throws Exception {
        Object plugin = bridge.getPlugin("LiveUpdate").getInstance();
        Field field = LiveUpdatePlugin.class.getDeclaredField("implementation");
        field.setAccessible(true);
        LiveUpdate engine = (LiveUpdate) field.get(plugin);
        assertNotNull(engine); return engine;
    }
    // Loopback HTTP exists only in this JVM test, never in production policy.
    private Exception download(LiveUpdate engine, String id, byte[] body, String signature, boolean truncate) throws Exception {
        AtomicReference<Exception> failure = new AtomicReference<>();
        CountDownLatch complete = new CountDownLatch(1);
        try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            Thread responder = new Thread(() -> {
                try (Socket socket = server.accept()) {
                    socket.setSoTimeout(5000);
                    BufferedReader input = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                    String line;
                    while ((line = input.readLine()) != null && !line.isEmpty()) {}
                    OutputStream output = socket.getOutputStream();
                    output.write(("HTTP/1.1 200 OK\r\nContent-Length: " + (body.length + (truncate ? 100 : 0)) + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                    output.write(body); output.flush();
                } catch (IOException ignored) { /* assertion below catches request failure */ }
            });
            responder.setDaemon(true); responder.start();
            engine.downloadBundle(new DownloadBundleOptions("zip", id, null, signature, "http://127.0.0.1:" + server.getLocalPort() + "/bundle.zip"), new EmptyCallback() {
                public void success() { complete.countDown(); }
                public void error(Exception error) { failure.set(error); complete.countDown(); }
            });
            assertTrue("Native download callback deadline", complete.await(10, TimeUnit.SECONDS));
        }
        return failure.get();
    }
    @Test public void nativeDownloadRejectsUnsignedModifiedAndInterruptedArchives() throws Exception {
        LiveUpdate updater = downloader(); byte[] bytes = fixture();
        assertNotNull(download(updater, "unsigned", bytes, null, false));
        assertNull(updater.getBundleDirectory("unsigned"));
        byte[] modified = bytes.clone(); modified[modified.length - 1] ^= 1;
        assertNotNull(download(updater, "modified", modified, metadata().getString("signature"), false));
        assertNull(updater.getBundleDirectory("modified"));
        assertNotNull(download(updater, "truncated", bytes, metadata().getString("signature"), true));
        assertNull(updater.getBundleDirectory("truncated"));
    }
    @Test public void verifiedBundleIsStagedAndSurvivesASecondNativeInstance() throws Exception {
        LiveUpdate updater = downloader();
        assertNull(download(updater, "verified", fixture(), metadata().getString("signature"), false));
        assertTrue(new File(updater.getBundleDirectory("verified"), "index.html").isFile());
        PluginCall call = new PluginCall(null, "LiveUpdate", "test", "setNextBundle", new JSObject().put("bundleId", "verified"));
        updater.setNextBundle(new SetNextBundleOptions(call), success());
        // Persistence of the next native path is real, not a mocked JS adapter.
        assertEquals("verified", result(downloader()::getNextBundle).getString("bundleId"));
    }
    @Test public void failedColdStartReturnsToBuiltinAndBlocksThatBundle() throws Exception {
        try (ActivityController<MainActivity> first = Robolectric.buildActivity(MainActivity.class).setup()) {
            assertEquals("fit-self-hosted", new LiveUpdatePreferences(first.get()).getDeviceId());
            LiveUpdate running = engine(first.get().getBridge());
            result(running::ready);
            LiveUpdate updater = downloader();
            assertNull(download(updater, "bad-start", fixture(), metadata().getString("signature"), false));
            updater.setNextBundle(new SetNextBundleOptions(new PluginCall(null, "LiveUpdate", "test", "setNextBundle", new JSObject().put("bundleId", "bad-start"))), success());
        }
        try (ActivityController<MainActivity> second = Robolectric.buildActivity(MainActivity.class).setup()) {
            LiveUpdate running = engine(second.get().getBridge());
            assertEquals("bad-start", result(running::getCurrentBundle).getString("bundleId"));
            // No JS ready acknowledgement. Advance the foreground clock deterministically.
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(20001));
            assertTrue(result(running::getCurrentBundle).isNull("bundleId"));
            assertTrue(result(running::ready).getBool("rollback"));
            assertTrue(result(running::getBlockedBundles).getJSONArray("bundleIds").toString().contains("bad-start"));
        }
    }
}
