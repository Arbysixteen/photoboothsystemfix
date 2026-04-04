package com.photobooth.camera;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.google.gson.Gson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.OutputStream;

/**
 * GET /status → Returns camera status as JSON.
 * 
 * Response example:
 * {
 *   "initialized": true,
 *   "sessionOpen": true,
 *   "liveViewActive": true,
 *   "captureCount": 5,
 *   "captureFolderPath": "C:\\photobooth\\captures",
 *   "serialNumber": "1234567890"
 * }
 */
public class StatusHandler implements HttpHandler {

    private static final Logger log = LoggerFactory.getLogger(StatusHandler.class);
    private final CameraService cameraService;
    private final Gson gson = new Gson();

    public StatusHandler(CameraService cameraService) {
        this.cameraService = cameraService;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        // CORS headers
        exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, OPTIONS");
        exchange.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");

        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }

        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendError(exchange, 405, "Method Not Allowed");
            return;
        }

        try {
            CameraService.CameraStatus status = cameraService.getStatus();
            String json = gson.toJson(status);

            exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
            byte[] bytes = json.getBytes("UTF-8");
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        } catch (Exception e) {
            log.error("Error getting status", e);
            sendError(exchange, 500, "{\"error\":\"" + e.getMessage() + "\"}");
        }
    }

    private void sendError(HttpExchange exchange, int code, String message) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        byte[] bytes = message.getBytes("UTF-8");
        exchange.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }
}
