import youtubedl from "youtube-dl-exec";
import { createReadStream, existsSync, mkdirSync, readdirSync } from "fs";
import { unlink, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sanitizeFilename = (filename) => {
  return filename.replace(/[^a-z0-9]/gi, "_");
};

const isValidYoutubeUrl = (url) => {
  try {
    const urlObj = new URL(url);
    return (
      (urlObj.hostname === "www.youtube.com" ||
        urlObj.hostname === "youtube.com" ||
        urlObj.hostname === "youtu.be") &&
      (urlObj.pathname.includes("/watch") || urlObj.hostname === "youtu.be")
    );
  } catch {
    return false;
  }
};

const audio = async (req, res) => {
  let tempFilePath = null;
  const downloadsDir = path.join(__dirname, "..", "..", "downloads");

  try {
    const { videoUrl, getInfo } = req.body;

    if (!videoUrl || !isValidYoutubeUrl(videoUrl)) {
      return res.status(400).json({
        error: "Invalid YouTube URL. Please provide a valid youtube.com or youtu.be URL",
      });
    }

    // Get video info
    const info = await youtubedl(videoUrl, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      preferFreeFormats: true,
      youtubeSkipDashManifest: true,
    });

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

    // Ensure download folder exists
    if (!existsSync(downloadsDir)) {
      mkdirSync(downloadsDir, { recursive: true });
    }

    // Set up output path
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

    console.log("Downloading to:", tempFilePath);
    await youtubedl(videoUrl, options);

    if (!existsSync(tempFilePath)) {
      console.error("File not found after download:", tempFilePath);
      return res.status(500).json({ error: "Audio file not created." });
    }

    const fileStat = await stat(tempFilePath);
    const fileSize = fileStat.size;
    const range = req.headers.range;

    res.header("Content-Type", "audio/mp3");
    res.header("Accept-Ranges", "bytes");
    res.header("Cache-Control", "no-cache");

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
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
          console.error("Error deleting file:", err);
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
          console.error("Error deleting file:", err);
        }
      });
    }
  } catch (error) {
    if (tempFilePath && existsSync(tempFilePath)) {
      try {
        await unlink(tempFilePath);
      } catch (err) {
        console.error("Cleanup error:", err);
      }
    }

    console.error("Download error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to process YouTube audio",
        details: error.message,
      });
    }
  }
};

export default audio;
