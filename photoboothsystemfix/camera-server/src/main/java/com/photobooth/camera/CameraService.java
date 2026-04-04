package com.photobooth.camera;

import org.blackdread.camerabinding.jna.EdsdkLibrary;
import org.blackdread.cameraframework.api.camera.CanonCamera;
import org.blackdread.cameraframework.api.command.CanonCommand;
import org.blackdread.cameraframework.api.command.TerminateSdkCommand;
import org.blackdread.cameraframework.api.command.builder.ShootOption;
import org.blackdread.cameraframework.api.command.builder.ShootOptionBuilder;
import org.blackdread.cameraframework.api.constant.EdsSaveTo;
import org.blackdread.cameraframework.api.helper.factory.CanonFactory;
import org.blackdread.cameraframework.api.helper.initialisation.FrameworkInitialisation;
import org.blackdread.cameraframework.api.helper.logic.event.CameraAddedListener;
import org.blackdread.cameraframework.api.helper.logic.event.CameraObjectListener;
import org.blackdread.cameraframework.api.helper.logic.event.CameraPropertyListener;
import org.blackdread.cameraframework.api.helper.logic.event.CameraStateListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.awt.image.BufferedImage;
import java.io.File;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Manages the Canon camera connection via EDSDK.
 * Provides live view frame retrieval and photo capture.
 */
public class CameraService {

    private static final Logger log = LoggerFactory.getLogger(CameraService.class);

    private CanonCamera camera;
    private EdsdkLibrary.EdsCameraRef cameraRef;
    private final AtomicBoolean initialized = new AtomicBoolean(false);
    private final AtomicBoolean liveViewActive = new AtomicBoolean(false);
    private final AtomicBoolean sessionOpen = new AtomicBoolean(false);
    private final AtomicBoolean propertyEventReceived = new AtomicBoolean(false);
    private final AtomicInteger captureCount = new AtomicInteger(0);

    // Default folder to save captured photos
    private File captureFolder;

    // Event listeners
    private CameraAddedListener cameraAddedListener;
    private CameraObjectListener cameraObjectListener;
    private CameraPropertyListener cameraPropertyListener;
    private CameraStateListener cameraStateListener;

    /**
     * Initialize the Canon SDK framework and open a session with the first connected camera.
     */
    public void initialize() {
        if (initialized.get()) {
            log.warn("Camera service already initialized");
            return;
        }

        // Setup capture folder
        captureFolder = new File(System.getProperty("user.dir"), "captures");
        if (!captureFolder.exists()) {
            captureFolder.mkdirs();
        }
        log.info("Capture folder: {}", captureFolder.getAbsolutePath());

        // Setup event listeners
        cameraAddedListener = event -> {
            log.info("Camera added event: {}", event);
        };
        cameraObjectListener = event -> {
            log.info("Camera object event: {}", event);
        };
        cameraPropertyListener = event -> {
            log.info("Camera property event: {}", event);
            propertyEventReceived.set(true);
        };
        cameraStateListener = event -> {
            log.info("Camera state event: {}", event);
        };

        // Initialize the framework
        new FrameworkInitialisation()
            .registerCameraAddedEvent()
            .withEventFetcherLogic()
            .withCameraAddedListener(cameraAddedListener)
            .initialize();

        // Create camera and open session
        camera = new CanonCamera();
        cameraRef = executeCommand(camera.openSession());
        sessionOpen.set(true);
        log.info("Camera session opened, ref: {}", cameraRef);

        // Register event handlers for this camera
        executeCommand(camera.getEvent().registerObjectEventCommand());
        executeCommand(camera.getEvent().registerPropertyEventCommand());
        executeCommand(camera.getEvent().registerStateEventCommand());

        CanonFactory.cameraObjectEventLogic().addCameraObjectListener(cameraObjectListener);
        CanonFactory.cameraPropertyEventLogic().addCameraPropertyListener(cameraRef, cameraPropertyListener);
        CanonFactory.cameraStateEventLogic().addCameraStateListener(cameraRef, cameraStateListener);

        initialized.set(true);
        log.info("Camera service fully initialized");
    }

    /**
     * Start live view streaming from the camera to PC.
     */
    public void startLiveView() throws InterruptedException {
        if (!initialized.get()) {
            throw new IllegalStateException("Camera not initialized");
        }
        if (liveViewActive.get()) {
            log.info("Live view already active");
            return;
        }

        propertyEventReceived.set(false);
        executeCommand(camera.getLiveView().beginLiveViewAsync());

        // Wait for property change event confirming live view started
        int waitCount = 0;
        while (!propertyEventReceived.get() && waitCount < 50) {
            Thread.sleep(100);
            waitCount++;
        }

        // Wait until camera is actually transmitting live view frames
        waitCount = 0;
        while (!executeCommand(camera.getLiveView().isLiveViewActiveAsync()) && waitCount < 20) {
            Thread.sleep(500);
            waitCount++;
        }

        // Small extra delay to avoid EDS_ERR_OBJECT_NOTREADY
        Thread.sleep(300);

        liveViewActive.set(true);
        log.info("Live view started successfully");
    }

    /**
     * Stop live view streaming.
     */
    public void stopLiveView() {
        if (!liveViewActive.get()) {
            return;
        }
        try {
            executeCommand(camera.getLiveView().endLiveViewAsync());
            liveViewActive.set(false);
            log.info("Live view stopped");
        } catch (Exception e) {
            log.error("Error stopping live view", e);
        }
    }

    /**
     * Download the current live view frame as a BufferedImage.
     *
     * @return current live view frame
     */
    public BufferedImage downloadLiveViewFrame() {
        if (!liveViewActive.get()) {
            throw new IllegalStateException("Live view not active");
        }
        return executeCommand(camera.getLiveView().downloadLiveViewAsync());
    }

    /**
     * Download the current live view frame as a raw JPEG byte array.
     *
     * @return current live view frame bytes
     */
    public byte[] downloadLiveViewBuffer() {
        if (!liveViewActive.get()) {
            throw new IllegalStateException("Live view not active");
        }
        return executeCommand(camera.getLiveView().downloadBufferLiveViewAsync());
    }

    /**
     * Take a photo and save to the captures folder.
     *
     * @param filename optional filename (null = auto-generated)
     * @return list of saved file paths
     */
    public List<File> capturePhoto(String filename) throws InterruptedException, ExecutionException {
        if (!initialized.get()) {
            throw new IllegalStateException("Camera not initialized");
        }

        if (filename == null || filename.isEmpty()) {
            filename = "photobooth_" + System.currentTimeMillis() + "_" + captureCount.incrementAndGet() + ".jpg";
        }

        ShootOption options = new ShootOptionBuilder()
            .setSaveTo(EdsSaveTo.kEdsSaveTo_Host)
            .setFolderDestination(captureFolder)
            .setFilename(filename)
            .build();

        List<File> files = camera.getShoot().shoot(options);
        log.info("Photo captured: {} file(s)", files.size());
        for (File f : files) {
            log.info("  → {}", f.getAbsolutePath());
        }
        return files;
    }

    /**
     * Get current camera status information.
     */
    public CameraStatus getStatus() {
        CameraStatus status = new CameraStatus();
        status.initialized = initialized.get();
        status.sessionOpen = sessionOpen.get();
        status.liveViewActive = liveViewActive.get();
        status.captureCount = captureCount.get();
        status.captureFolderPath = captureFolder != null ? captureFolder.getAbsolutePath() : "";

        if (initialized.get() && camera != null) {
            try {
                status.serialNumber = executeCommand(camera.getProperty().getBodyIDExAsync());
            } catch (Exception e) {
                status.serialNumber = "unknown";
            }
        }
        return status;
    }

    /**
     * Cleanly shutdown: stop live view, close session, terminate SDK.
     */
    public void shutdown() {
        log.info("Shutting down camera service...");
        try {
            if (liveViewActive.get()) {
                stopLiveView();
            }
        } catch (Exception e) {
            log.error("Error stopping live view during shutdown", e);
        }
        try {
            if (sessionOpen.get()) {
                executeCommand(camera.closeSession());
                sessionOpen.set(false);
                log.info("Camera session closed");
            }
        } catch (Exception e) {
            log.error("Error closing camera session", e);
        }
        try {
            CanonFactory.commandDispatcher().scheduleCommand(new TerminateSdkCommand());
            log.info("SDK terminate command sent");
        } catch (Exception e) {
            log.error("Error terminating SDK", e);
        }
        initialized.set(false);
    }

    public boolean isInitialized() {
        return initialized.get();
    }

    public boolean isLiveViewActive() {
        return liveViewActive.get();
    }

    /**
     * Helper to block-wait for a CanonCommand result.
     */
    private <R> R executeCommand(CanonCommand<R> command) {
        try {
            return command.get();
        } catch (InterruptedException | ExecutionException e) {
            throw new RuntimeException("Canon command failed: " + e.getMessage(), e);
        }
    }

    /**
     * Simple status POJO for JSON serialization.
     */
    public static class CameraStatus {
        public boolean initialized;
        public boolean sessionOpen;
        public boolean liveViewActive;
        public int captureCount;
        public String captureFolderPath;
        public String serialNumber;
    }
}
