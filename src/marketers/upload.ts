import { Router } from "express";
import multer from "multer";
import { uploadImage, uploadVideo } from "../pinata/upload.js";
import { gatewayUrl } from "../pinata/client.js";
import { requireMarketer } from "./routes.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 22 * 1024 * 1024 } });
export const uploadRouter = Router();

uploadRouter.post("/v1/marketers/upload/image", requireMarketer, upload.single("file"), async (req: any, res: any) => {
  if (!req.file) return res.status(400).json({ error: "no file" });
  try { 
    const out = await uploadImage(req.file.buffer, req.file.originalname); 
    res.json({ ...out, url: gatewayUrl(out.cid) }); 
  }
  catch (e: any) { 
    res.status(400).json({ error: e.message }); 
  }
});

uploadRouter.post("/v1/marketers/upload/video", requireMarketer, upload.single("file"), async (req: any, res: any) => {
  if (!req.file) return res.status(400).json({ error: "no file" });
  try {
    const out = await uploadVideo(req.file.buffer, req.file.originalname);
    res.json({ 
      ...out, 
      url: gatewayUrl(out.cid), 
      thumbnailUrl: out.thumbnailCid ? gatewayUrl(out.thumbnailCid) : undefined 
    });
  } catch (e: any) { 
    res.status(400).json({ error: e.message }); 
  }
});
