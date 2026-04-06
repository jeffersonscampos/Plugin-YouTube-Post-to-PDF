import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API: Capture YouTube Post
  app.post("/api/capture", async (req, res) => {
    const { url } = req.body;
    if (!url || !url.includes("youtube.com")) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      });
      const html = await response.text();

      // Extract ytInitialData
      const match = html.match(/var ytInitialData = ({.*?});<\/script>/);
      if (!match) {
        return res.status(404).json({ error: "Could not find post data. Make sure it's a public community post." });
      }

      const data = JSON.parse(match[1]);
      
      // Navigate through the complex YouTube JSON structure
      // This is a simplified path that works for most community posts
      let post;
      try {
        // Path for direct post URLs
        const contents = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0];
        post = contents?.backstagePostThreadRenderer?.post?.backstagePostRenderer;
        
        if (!post) {
            // Alternative path for some views
            post = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.find((t: any) => t.tabRenderer?.selected)?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.backstagePostThreadRenderer?.post?.backstagePostRenderer;
        }
      } catch (e) {
        console.error("Error navigating JSON:", e);
      }

      if (!post) {
        return res.status(404).json({ error: "Post content not found in YouTube data." });
      }

      const text = post.contentText?.runs?.map((r: any) => r.text).join("") || "";
      const images: string[] = [];

      // Check for carousel (multi-image)
      const multiImage = post.backstageAttachment?.postMultiImageRenderer;
      if (multiImage) {
        multiImage.images.forEach((img: any) => {
          const thumbnails = img.backstageImageRenderer?.image?.thumbnails;
          if (thumbnails && thumbnails.length > 0) {
            // Get the highest resolution thumbnail
            images.push(thumbnails[thumbnails.length - 1].url);
          }
        });
      } else {
        // Check for single image
        const singleImage = post.backstageAttachment?.backstageImageRenderer;
        if (singleImage) {
          const thumbnails = singleImage.image?.thumbnails;
          if (thumbnails && thumbnails.length > 0) {
            images.push(thumbnails[thumbnails.length - 1].url);
          }
        }
      }

      res.json({ text, images });
    } catch (error) {
      console.error("Capture error:", error);
      res.status(500).json({ error: "Failed to capture post content." });
    }
  });

  // API: Proxy Image to avoid CORS
  app.get("/api/proxy-image", async (req, res) => {
    const imageUrl = req.query.url as string;
    if (!imageUrl) return res.status(400).send("URL is required");

    try {
      const response = await fetch(imageUrl);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get("content-type") || "image/jpeg";
      
      res.setHeader("Content-Type", contentType);
      res.send(buffer);
    } catch (error) {
      res.status(500).send("Error proxying image");
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
