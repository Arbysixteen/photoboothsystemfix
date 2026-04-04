package com.photobooth.camera;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * GET /liveview → Streams the camera's live view as MJPEG over HTTP.
 * 
 * The stream uses multipart/x-mixed-replace boundary protocol,
 * which is natively supported by <img> tags in browsers.
 * 
 * Usage in HTML:
 *   <img src="http://localhost:9999/liveview" />
 * 
 * Target frame rate: ~20-24 fps (50ms between frames).
 */
public class LiveViewHandler implements HttpHandler {

    private static final Logger log = LoggerFactory.getLogger(LiveViewHandler.class);
    private static final String BOUNDARY = "--livefeed";
    private static final long FRAME_INTERVAL_MS = 50; // ~20fps

    private final CameraService cameraService;

    public LiveViewHandler(CameraService cameraService) {
        this.cameraService = cameraService;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        // CORS headers
        exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");

        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(405, -1);
            return;
        }

        // Ensure camera is initialized
        if (!cameraService.isInitialized()) {
            String error = "{\"error\":\"Camera not initialized\"}";
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(503, error.length());
            exchange.getResponseBody().write(error.getBytes());
            exchange.getResponseBody().close();
            return;
        }

        // Auto-start live view if not active
        if (!cameraService.isLiveViewActive()) {
            try {
                cameraService.startLiveView();
            } catch (InterruptedException e) {
                String error = "{\"error\":\"Failed to start live view: " + e.getMessage() + "\"}";
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(500, error.length());
                exchange.getResponseBody().write(error.getBytes());
                exchange.getResponseBody().close();
                return;
            }
        }

        // Set MJPEG streaming headers
        exchange.getResponseHeaders().set("Content-Type", "multipart/x-mixed-replace; boundary=" + BOUNDARY);
        exchange.getResponseHeaders().set("Cache-Control", "no-cache, no-store, must-revalidate");
        exchange.getResponseHeaders().set("Pragma", "no-cache");
        exchange.getResponseHeaders().set("Expires", "0");
        exchange.getResponseHeaders().set("Connection", "close");
        exchange.sendResponseHeaders(200, 0); // chunked

        OutputStream os = exchange.getResponseBody();
        log.info("Live view MJPEG stream started for client");

        int errorCount = 0;
        int maxErrors = 10;

        try {
            while (cameraService.isLiveViewActive()) {
                try {
                    // Download live view frame as JPEG bytes
                    BufferedImage frame = cameraService.downloadLiveViewFrame();
                    if (frame == null) {
                        Thread.sleep(FRAME_INTERVAL_MS);
                        continue;
                    }

                    ByteArrayOutputStream baos = new ByteArrayOutputStream(65536);
                    ImageIO.write(frame, "jpeg", baos);
                    byte[] imageBytes = baos.toByteArray();

                    // Write MJPEG boundary + JPEG data
                    StringBuilder header = new StringBuilder();
                    header.append(BOUNDARY).append("\r\n");
                    header.append("Content-Type: image/jpeg\r\n");
                    header.append("Content-Length: ").append(imageBytes.length).append("\r\n");
                    header.append("\r\n");

                    os.write(header.toString().getBytes());
                    os.write(imageBytes);
                    os.write("\r\n".getBytes());
                    os.flush();

                    errorCount = 0; // Reset error count on success

                    Thread.sleep(FRAME_INTERVAL_MS);

                } catch (IOException e) {
                    // Client disconnected
                    log.info("Live view client disconnected");
                    break;
                } catch (RuntimeException e) {
                    errorCount++;
                    log.warn("Error downloading live view frame ({}/{}): {}", errorCount, maxErrors, e.getMessage());
                    if (errorCount >= maxErrors) {
                        log.error("Too many live view frame errors, stopping stream");
                        break;
                    }
                    Thread.sleep(200); // Back off on error
                }
            }
        } catch (InterruptedException e) {
            log.info("Live view stream interrupted");
        } finally {
            try {
                os.close();
            } catch (IOException ignored) {}
            log.info("Live view MJPEG stream ended");
        }
    }
}
