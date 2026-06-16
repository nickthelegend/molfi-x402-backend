import sharp from "sharp";
import { pinata, gatewayUrl } from "./client.js";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { promises as fs } from "node:fs";
import { keccak256, toHex } from "viem";
import os from "node:os";
import path from "node:path";

export type UploadResult = {
  cid: string;
  cidHash: `0x${string}`;
  bytes: number;
  mime: string;
  durationMs?: number;
  thumbnailCid?: string;
};

export async function uploadImage(buf: Buffer, filename: string): Promise<UploadResult> {
  if (buf.length > 8 * 1024 * 1024) throw new Error("image too large (>8MB)");
  
  // Process image using sharp
  const safe = await sharp(buf)
    .rotate()
    .resize({ width: 1920, height: 1080, fit: "inside" })
    .webp({ quality: 82 })
    .toBuffer();

  const webpFilename = filename.replace(/\.[^.]+$/, "") + ".webp";
  const file = new File([new Blob([safe], { type: "image/webp" })], webpFilename);
  const { IpfsHash } = await pinata.upload.file(file);

  return {
    cid: IpfsHash,
    cidHash: keccak256(toHex(IpfsHash)),
    bytes: safe.length,
    mime: "image/webp"
  };
}

export async function uploadVideo(buf: Buffer, filename: string): Promise<UploadResult> {
  if (buf.length > 20 * 1024 * 1024) throw new Error("video too large (>20MB)");

  const tempName = `molfi-${Date.now()}-${filename.replace(/[^\w.-]/g, "_")}`;
  const tmp = path.join(os.tmpdir(), tempName);
  await fs.writeFile(tmp, buf);

  let duration: number;
  try {
    duration = await probeDuration(tmp);
  } catch (err: any) {
    await fs.unlink(tmp).catch(() => {});
    throw new Error(`probe failed: ${err.message}`);
  }

  if (duration > 60) {
    await fs.unlink(tmp).catch(() => {});
    throw new Error("video too long (>60s)");
  }
  if (duration < 3) {
    await fs.unlink(tmp).catch(() => {});
    throw new Error("video too short (<3s)");
  }

  // Extract thumbnail at 1s
  const thumbPath = tmp + ".webp";
  try {
    await extractThumbnail(tmp, thumbPath);
  } catch (err: any) {
    await fs.unlink(tmp).catch(() => {});
    throw new Error(`thumbnail extraction failed: ${err.message}`);
  }

  let thumbUpCid = "";
  try {
    const thumbBuf = await fs.readFile(thumbPath);
    const thumb = await sharp(thumbBuf).resize({ width: 640 }).webp({ quality: 80 }).toBuffer();
    const thumbFile = new File([new Blob([thumb], { type: "image/webp" })], "thumb.webp");
    const thumbUp = await pinata.upload.file(thumbFile);
    thumbUpCid = thumbUp.IpfsHash;
  } catch (err) {
    // Ignore thumbnail upload error and proceed if thumbnail can't be generated
    console.error("Thumbnail upload failed:", err);
  }

  // Upload original video file to Pinata
  const file = new File([new Blob([buf])], filename);
  const { IpfsHash } = await pinata.upload.file(file);

  await Promise.all([
    fs.unlink(tmp).catch(() => {}),
    fs.unlink(thumbPath).catch(() => {})
  ]).catch(() => {});

  return {
    cid: IpfsHash,
    cidHash: keccak256(toHex(IpfsHash)),
    bytes: buf.length,
    mime: detectMime(filename),
    durationMs: Math.round(duration * 1000),
    thumbnailCid: thumbUpCid || undefined,
  };
}

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath as any, ["-i", filePath, "-f", "null", "-"]) as any;
    let stderr = "";
    p.stderr.on("data", (c: any) => stderr += c.toString());
    p.on("close", (code: number) => {
      const m = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
      if (!m) return reject(new Error("ffmpeg probe failed to parse duration"));
      const [h, mm, s] = m.slice(1).map(Number);
      resolve(h * 3600 + mm * 60 + s);
    });
  });
}

function extractThumbnail(input: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath as any, ["-y", "-ss", "1", "-i", input, "-frames:v", "1", "-q:v", "5", out]) as any;
    p.on("close", (code: number) => code === 0 ? resolve() : reject(new Error(`ffmpeg thumbnail extraction exited with code ${code}`)));
  });
}

function detectMime(name: string) {
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}
