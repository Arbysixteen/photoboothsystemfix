const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegStatic);

class VideoProcessor {
  /**
   * Generates a slideshow MP4 from photos with a specific background frame.
   */
  static generateSlideshow(photosBase64, framePath, slotConfig, outputPath, durationPerPhoto = 2.5, targetW = 2432, targetH = 3648) {
    return new Promise(async (resolve, reject) => {
      const tempDir = path.join(__dirname, 'temp_slideshow_' + Date.now());
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      try {
        const photoPaths = [];
        photosBase64.forEach((b64, index) => {
          const data = b64.replace(/^data:image\/\w+;base64,/, '');
          const out = path.join(tempDir, `photo_${index}.jpg`);
          fs.writeFileSync(out, Buffer.from(data, 'base64'));
          photoPaths.push(out);
        });

        // Original photo paths: [0, 1, 2, 3]
        // Ping-pong sequence: [0, 1, 2, 3, 2, 1]
        let baseSequence = [...photoPaths];
        if (photoPaths.length > 2) {
            for (let i = photoPaths.length - 2; i > 0; i--) {
                baseSequence.push(photoPaths[i]);
            }
        }
        
        let filesToPlay = [...baseSequence];
        let totalDuration = filesToPlay.length * durationPerPhoto;
        // Loop the ping-pong sequence until at least 5 seconds
        while (totalDuration < 5.0) {
          filesToPlay = filesToPlay.concat(baseSequence);
          totalDuration = filesToPlay.length * durationPerPhoto;
        }

        const concatFilePath = path.join(tempDir, 'list.txt');
        let concatContent = "";
        filesToPlay.forEach(p => {
          concatContent += `file '${p.replace(/\\/g, '/')}'\n`;
          concatContent += `duration ${durationPerPhoto}\n`;
        });
        concatContent += `file '${filesToPlay[filesToPlay.length - 1].replace(/\\/g, '/')}'\n`;
        fs.writeFileSync(concatFilePath, concatContent);

        // Fetch frame if it's a URL
        let localFramePath = null;
        if (framePath && framePath.startsWith('http')) {
          localFramePath = path.join(tempDir, 'frame_template.png');
          const res = await fetch(framePath);
          const buf = await res.arrayBuffer();
          fs.writeFileSync(localFramePath, Buffer.from(buf));
        } else if (framePath && fs.existsSync(framePath)) {
          localFramePath = framePath;
        }

        const command = ffmpeg();
        command.input(concatFilePath).inputOptions(['-f concat', '-safe 0']);
        
        if (localFramePath) {
          command.input(localFramePath);

          let filterComplex = [];
          
          if (slotConfig && slotConfig.length > 0) {
             const slot = slotConfig[0]; // use the first slot for slideshow
             // Scale the photos to fit the slot perfectly
             filterComplex.push(`[0:v]scale=${slot.width}:${slot.height}:force_original_aspect_ratio=increase,crop=${slot.width}:${slot.height}[scaled_photo]`);
             // Create a base canvas
             filterComplex.push(`color=c=black:s=${targetW}x${targetH}[base]`);
             // Overlay photo onto canvas at slot X,Y
             filterComplex.push(`[base][scaled_photo]overlay=x=${slot.x}:y=${slot.y}[bg]`);
             // Scale frame and overlay
             filterComplex.push(`[1:v]scale=${targetW}:${targetH}[fg]`);
             filterComplex.push(`[bg][fg]overlay=0:0[out]`);
          } else {
             filterComplex.push(`[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH}[bg]`);
             filterComplex.push(`[1:v]scale=${targetW}:${targetH}[fg]`);
             filterComplex.push(`[bg][fg]overlay=0:0[out]`);
          }

          command.complexFilter(filterComplex);
          command.outputOptions(['-map [out]', '-c:v libx264', '-pix_fmt yuv420p', '-r 24']);
        } else {
          command.complexFilter([
            `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH}[out]`
          ]);
          command.outputOptions(['-map [out]', '-c:v libx264', '-pix_fmt yuv420p', '-r 24']);
        }

        command.outputOptions([`-t ${totalDuration}`]);

        command.on('end', () => {
          if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error('Error in FFmpeg slideshow:', err);
          if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
          reject(err);
        })
        .save(outputPath);
      } catch (err) {
        console.error("Slideshow setup error:", err);
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        reject(err);
      }
    });
  }

  /**
   * Generates a Boomerang video from multiple webm clips inside a multi-slot frame.
   */
  static generateLayout(videoClipsBase64, framePath, slotConfigs, outputPath, targetDuration = 5.0, targetW = 2432, targetH = 3648) {
    return new Promise(async (resolve, reject) => {
      const tempDir = path.join(__dirname, 'temp_layout_' + Date.now());
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      try {
        const clipPaths = [];
        videoClipsBase64.forEach((b64, index) => {
          const data = b64.replace(/^data:video\/\w+;base64,/, '');
          const out = path.join(tempDir, `clip_${index}.webm`);
          fs.writeFileSync(out, Buffer.from(data, 'base64'));
          clipPaths.push(out);
        });

        // Fetch frame if it's a URL
        let localFramePath = null;
        if (framePath && framePath.startsWith('http')) {
          localFramePath = path.join(tempDir, 'frame_template.png');
          const res = await fetch(framePath);
          const buf = await res.arrayBuffer();
          fs.writeFileSync(localFramePath, Buffer.from(buf));
        } else if (framePath && fs.existsSync(framePath)) {
          localFramePath = framePath;
        }

        const command = ffmpeg();
        
        clipPaths.forEach(p => {
          command.input(p).inputOptions(['-stream_loop -1']); 
        });

        let frameInputIndex = clipPaths.length;
        if (localFramePath) {
          command.input(localFramePath);
        } else {
          command.input(`color=c=white:s=${targetW}x${targetH}`).inputOptions(['-f lavfi']);
        }

        let complexFilters = [];
        let lastOutput = "base";
        complexFilters.push(`color=c=black:s=${targetW}x${targetH}[base]`);

        clipPaths.forEach((_, i) => {
          const slot = slotConfigs[i];
          complexFilters.push(`[${i}:v]scale=${slot.width}:${slot.height}:force_original_aspect_ratio=increase,crop=${slot.width}:${slot.height}[scaled${i}]`);
          const currentOut = `tmp${i}`;
          complexFilters.push(`[${lastOutput}][scaled${i}]overlay=x=${slot.x}:y=${slot.y}[${currentOut}]`);
          lastOutput = currentOut;
        });

        complexFilters.push(`[${frameInputIndex}:v]scale=${targetW}:${targetH}[fg]`);
        complexFilters.push(`[${lastOutput}][fg]overlay=0:0[final_out]`);
        command.complexFilter(complexFilters);

        command.outputOptions([
          '-map [final_out]',
          '-c:v libx264',
          '-pix_fmt yuv420p',
          `-t ${targetDuration}`,
          '-r 24'
        ]);

        command.on('end', () => {
           if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
           resolve(outputPath);
        })
        .on('error', (err) => {
          console.error('Error in FFmpeg layout generation:', err);
          if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
          reject(err);
        })
        .save(outputPath);
      } catch (err) {
          console.error('Layout setup error:', err);
          if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
          reject(err);
      }
    });
  }
}

module.exports = VideoProcessor;
