import youtubedl from "youtube-dl-exec"; // or switch to 'yt-dlp-exec' for better reliability
import { createReadStream } from "fs";
import { unlink } from "fs/promises";
import fs, { existsSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to clean up the filename
const sanitizeFilename = (filename) => {
  return filename.replace(/[^a-z0-9]/gi, "_").substring(0, 100); // Truncate long titles
};

const isValidYoutubeUrl = (url) => {
  try {
    const urlObj = new URL(url);
    return (
      ["youtube.com", "www.youtube.com", "youtu.be"].includes(urlObj.hostname) &&
      (urlObj.pathname.includes("/watch") || urlObj.hostname === "youtu.be")
    );
  } catch {
    return false;
  }
};

const audio = async (req, res) => {
  let tempFilePath = null;

  try {
    const { videoUrl, getInfo } = req.body;

    if (!videoUrl || !isValidYoutubeUrl(videoUrl)) {
      return res.status(400).json({
        error: "Invalid YouTube URL. Please provide a valid youtube.com or youtu.be URL",
      });
    }

    let info;
    try {
      info = await youtubedl(videoUrl, {
        dumpSingleJson: true,
        noWarnings: true,
        noCallHome: true,
        preferFreeFormats: true,
        youtubeSkipDashManifest: true,
      });
    } catch (err) {
      console.error("youtube-dl info error:", err.stderr || err.message || err);
      return res.status(500).json({
        error: "youtube-dl failed to fetch video info",
        details: err.stderr || err.message || "unknown error",
      });
    }

    // If only info is requested
    if (getInfo) {
      const formats = info.formats
        .filter((f) => f.acodec !== "none" && f.vcodec === "none")
        .map((f) => ({
          format_id: f.format_id,
          ext: f.ext,
          quality: f.quality || "unknown",
          filesize: f.filesize || "unknown",
          asr: f.asr || "unknown",
        }));

      return res.json({
        title: info.title,
        duration: info.duration,
        thumbnail: info.thumbnail,
        description: info.description,
        formats,
      });
    }

    // Ensure downloads folder exists
    const downloadsDir = path.join(__dirname, "..", "..", "downloads");
    if (!existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

    const filename = sanitizeFilename(info.title) + ".mp3";
    tempFilePath = path.join(downloadsDir, filename);

    const options = {
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: 0,
      output: tempFilePath,
      noWarnings: true,
      noCallHome: true,
      preferFreeFormats: true,
      youtubeSkipDashManifest: true,
    };

    // Perform the download
    console.log("Downloading to:", tempFilePath);
    await youtubedl(videoUrl, options);

    if (!existsSync(tempFilePath)) {
      throw new Error(`File not found after download: ${tempFilePath}`);
    }

    const stat = await fs.promises.stat(tempFilePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.header("Content-Type", "audio/mp3");
    res.header("Accept-Ranges", "bytes");
    res.header("Cache-Control", "no-cache");

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;

      res.status(206);
      res.header("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.header("Content-Length", chunksize);

      const stream = createReadStream(tempFilePath, { start, end });
      stream.pipe(res);

      stream.on("end", async () => {
        try {
          await unlink(tempFilePath);
        } catch (err) {
          console.error("Cleanup error:", err.message);
        }
      });
    } else {
      res.header("Content-Length", fileSize);
      const stream = createReadStream(tempFilePath);
      stream.pipe(res);

      stream.on("end", async () => {
        try {
          await unlink(tempFilePath);
        } catch (err) {
          console.error("Cleanup error:", err.message);
        }
      });
    }
  } catch (error) {
    if (tempFilePath && existsSync(tempFilePath)) {
      try {
        await unlink(tempFilePath);
      } catch (err) {
        console.error("Failed to delete temp file:", err.message);
      }
    }

    console.error("Main error:", error.message || error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to process YouTube audio",
        details: error.message || error,
      });
    }
  }
};

export default audio;
