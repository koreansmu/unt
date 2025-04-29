import youtubedl from "youtube-dl-exec";
import { createReadStream } from "fs";
import { unlink } from "fs/promises";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

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

  try {
    const { videoUrl, getInfo } = req.body;
    const proxy = req.headers["x-proxy"] || process.env.YTDL_PROXY || null;

    if (!videoUrl || !isValidYoutubeUrl(videoUrl)) {
      return res.status(400).json({
        error:
          "Invalid YouTube URL. Please provide a valid youtube.com or youtu.be URL",
      });
    }

    const commonOptions = {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      preferFreeFormats: true,
      youtubeSkipDashManifest: true,
      ...(proxy && { proxy }), // apply proxy if provided
    };

    const info = await youtubedl(videoUrl, commonOptions);

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

    const filename = sanitizeFilename(info.title) + ".mp3";
    tempFilePath = path.join(__dirname, "..", "..", "downloads", filename);

    const downloadOptions = {
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: 0,
      output: tempFilePath,
      noWarnings: true,
      noCallHome: true,
      preferFreeFormats: true,
      youtubeSkipDashManifest: true,
      ...(proxy && { proxy }), // apply proxy if provided
    };

    await youtubedl(videoUrl, downloadOptions);

    res.header("Content-Type", "audio/mp3");
    res.header("Accept-Ranges", "bytes");
    res.header("Cache-Control", "no-cache");

    const stat = await fs.promises.stat(tempFilePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
      const chunksize = end - start + 1;

      res.status(206);
      res.header("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.header("Content-Length", chunksize);

      const stream = createReadStream(tempFilePath, { start, end });
      stream.pipe(res).on("end", async () => {
        try {
          await unlink(tempFilePath);
        } catch (err) {
          console.error("Error deleting temp file:", err);
        }
      });
    } else {
      res.header("Content-Length", fileSize);

      const stream = createReadStream(tempFilePath);
      stream.pipe(res).on("end", async () => {
        try {
          await unlink(tempFilePath);
        } catch (err) {
          console.error("Error deleting temp file:", err);
        }
      });
    }
  } catch (error) {
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch (err) {
        console.error("Error deleting temp file:", err);
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
