package com.photobooth.camera;

import com.sun.net.httpserver.HttpServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.concurrent.Executors;

/**
 * Main entry point for the Canon Camera HTTP Microservice.
 *
 * This server runs on localhost:9999 and provides:
 *   GET  /status     → Camera connection status (JSON)
 *   GET  /liveview   → MJPEG live view stream
 *   POST /capture    → Take a photo and save to disk (JSON response)
 *   POST /shutdown   → Gracefully shutdown camera and server
 *
 * Designed to be spawned as a child process by the Electron kiosk app.
 */
public class CameraServerApp {

    private static final Logger log = LoggerFactory.getLogger(CameraServerApp.class);
    private static final int DEFAULT_PORT = 9999;

    // System property key read by CanonLibraryImpl inside canon-sdk-java
    private static final String EDSDK_PATH_PROP = "blackdread.cameraframework.library.path";

    // 32-bit DLL relative path (matches DllUtil.DEFAULT_LIB_32_PATH in canon-sdk-java)
    // Our DLL is 32-bit x86, sourced from DigiCamControl bundle
    private static final String DLL_REL_PATH = "EDSDK\\Dll\\EDSDK.dll";

    private HttpServer httpServer;
    private CameraService cameraService;

    public static void main(String[] args) {
        int port = DEFAULT_PORT;
        if (args.length > 0) {
            try {
                port = Integer.parseInt(args[0]);
            } catch (NumberFormatException e) {
                log.warn("Invalid port argument '{}', using default {}", args[0], DEFAULT_PORT);
            }
        }

        CameraServerApp app = new CameraServerApp();
        app.start(port);

        // Graceful shutdown hook
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            log.info("Shutdown hook triggered, cleaning up...");
            app.stop();
        }));
    }

    public void start(int port) {
        // ── 1) Auto-detect EDSDK.dll and set library path for canon-sdk-java ─
        setupEdsdkLibraryPath();

        try {
            // ── 2) Initialize camera service (connects to Canon EDSDK) ────────
            cameraService = new CameraService();
            cameraService.initialize();
            log.info("Canon EDSDK initialized successfully");

            // ── 3) Create HTTP server and register all endpoints ──────────────
            httpServer = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
            httpServer.setExecutor(Executors.newFixedThreadPool(4));

            httpServer.createContext("/status",   new StatusHandler(cameraService));
            httpServer.createContext("/liveview", new LiveViewHandler(cameraService));
            httpServer.createContext("/capture",  new CaptureHandler(cameraService));
            httpServer.createContext("/shutdown", exchange -> {
                String response = "{\"status\":\"shutting_down\"}";
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
                exchange.sendResponseHeaders(200, response.length());
                exchange.getResponseBody().write(response.getBytes());
                exchange.getResponseBody().close();
                new Thread(() -> {
                    try { Thread.sleep(500); } catch (InterruptedException ignored) {}
                    stop();
                    System.exit(0);
                }).start();
            });

            httpServer.start();
            log.info("╔══════════════════════════════════════════════╗");
            log.info("║  Canon Camera Server started on port {}   ║", port);
            log.info("║  Endpoints:                                  ║");
            log.info("║    GET  /status   → Camera status            ║");
            log.info("║    GET  /liveview → MJPEG stream             ║");
            log.info("║    POST /capture  → Take photo               ║");
            log.info("║    POST /shutdown → Stop server              ║");
            log.info("╚══════════════════════════════════════════════╝");

            // ── 4) Signal to Electron parent that server is ready ─────────────
            System.out.println("CAMERA_SERVER_READY:" + port);
            System.out.flush();

        } catch (IOException e) {
            log.error("Failed to start camera server", e);
            throw new RuntimeException("Cannot start camera server on port " + port, e);
        }
    }

    /**
     * Auto-detect EDSDK.dll and set the system property that canon-sdk-java
     * reads in CanonLibraryImpl to load the native DLL via JNA.
     *
     * Our DLL is 32-bit (x86) - sourced from DigiCamControl bundle.
     *
     * Search order:
     *   1. Folder next to the running JAR   → <jar-dir>\EDSDK\Dll\EDSDK.dll
     *   2. Current working directory        → <cwd>\EDSDK\Dll\EDSDK.dll
     *
     * Can be overridden manually with:
     *   java -Dblackdread.cameraframework.library.path=C:\path\to\EDSDK.dll -jar canon-driver.jar
     */
    private static void setupEdsdkLibraryPath() {
        // If already set manually, respect it
        if (System.getProperty(EDSDK_PATH_PROP) != null) {
            log.info("EDSDK path manually set: {}", System.getProperty(EDSDK_PATH_PROP));
            return;
        }

        // Try 1: Folder next to the running JAR
        try {
            File jarDir = new File(
                CameraServerApp.class.getProtectionDomain()
                    .getCodeSource().getLocation().toURI()
            ).getParentFile();

            File dllNextToJar = new File(jarDir, DLL_REL_PATH);
            if (dllNextToJar.exists()) {
                System.setProperty(EDSDK_PATH_PROP, dllNextToJar.getAbsolutePath());
                log.info("✅ EDSDK.dll found next to JAR: {}", dllNextToJar.getAbsolutePath());
                return;
            }
        } catch (Exception e) {
            log.warn("Could not determine JAR directory: {}", e.getMessage());
        }

        // Try 2: Current working directory
        File dllInCwd = new File(System.getProperty("user.dir"), DLL_REL_PATH);
        if (dllInCwd.exists()) {
            System.setProperty(EDSDK_PATH_PROP, dllInCwd.getAbsolutePath());
            log.info("✅ EDSDK.dll found in working dir: {}", dllInCwd.getAbsolutePath());
            return;
        }

        // Not found — log warning, camera init will fail if DLL is truly missing
        log.warn("⚠ EDSDK.dll NOT found automatically! Searched paths:");
        log.warn("  1. <jar-dir>\\EDSDK\\Dll\\EDSDK.dll");
        log.warn("  2. {}\\EDSDK\\Dll\\EDSDK.dll", System.getProperty("user.dir"));
        log.warn("Override with: -D{}=<absolute-path-to-EDSDK.dll>", EDSDK_PATH_PROP);
    }

    public void stop() {
        try {
            if (cameraService != null) {
                cameraService.shutdown();
                log.info("Camera service shutdown complete");
            }
        } catch (Exception e) {
            log.error("Error shutting down camera service", e);
        }
        try {
            if (httpServer != null) {
                httpServer.stop(2);
                log.info("HTTP server stopped");
            }
        } catch (Exception e) {
            log.error("Error stopping HTTP server", e);
        }
    }
}
