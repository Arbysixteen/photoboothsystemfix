package com.photobooth.camera;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.stream.Collectors;

/**
 * POST /capture → Takes a photo with the Canon camera.
 * 
 * Request body (optional JSON):
 * {
 *   "filename": "my_photo.jpg"   // optional, auto-generated if omitted
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "files": ["C:\\photobooth\\captures\\my_photo.jpg"],
 *   "count": 1
 * }
 */
public class CaptureHandler implements HttpHandler {

    private static final Logger log = LoggerFactory.getLogger(CaptureHandler.class);
    private final CameraService cameraService;
    private final Gson gson = new Gson();

    public CaptureHandler(CameraService cameraService) {
        this.cameraService = cameraService;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        // CORS headers
        exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().add("Access-Control-Allow-Methods", "POST, OPTIONS");
        exchange.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");

        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }

        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendJsonResponse(exchange, 405, "{\"error\":\"Method Not Allowed, use POST\"}");
            return;
        }

        if (!cameraService.isInitialized()) {
            sendJsonResponse(exchange, 503, "{\"error\":\"Camera not initialized\"}");
            return;
        }

        try {
            // Parse optional request body for filename
            String filename = null;
            String body = readBody(exchange);
            if (body != null && !body.trim().isEmpty()) {
                try {
                    JsonObject json = gson.fromJson(body, JsonObject.class);
                    if (json.has("filename")) {
                        filename = json.get("filename").getAsString();
                    }
                } catch (Exception e) {
                    log.warn("Could not parse request body as JSON, using auto filename");
                }
            }

            log.info("Capture requested, filename: {}", filename != null ? filename : "(auto)");

            // Take the photo
            List<File> capturedFiles = cameraService.capturePhoto(filename);

            // Build success response
            JsonObject response = new JsonObject();
            response.addProperty("success", true);
            response.addProperty("count", capturedFiles.size());
            response.add("files", gson.toJsonTree(
                capturedFiles.stream()
                    .map(File::getAbsolutePath)
                    .collect(Collectors.toList())
            ));
            response.addProperty("timestamp", System.currentTimeMillis());

            sendJsonResponse(exchange, 200, gson.toJson(response));

        } catch (Exception e) {
            log.error("Capture failed", e);
            JsonObject errorResponse = new JsonObject();
            errorResponse.addProperty("success", false);
            errorResponse.addProperty("error", e.getMessage());
            sendJsonResponse(exchange, 500, gson.toJson(errorResponse));
        }
    }

    private String readBody(HttpExchange exchange) throws IOException {
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(exchange.getRequestBody(), StandardCharsets.UTF_8))) {
            return reader.lines().collect(Collectors.joining("\n"));
        }
    }

    private void sendJsonResponse(HttpExchange exchange, int statusCode, String json) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(statusCode, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }
}
