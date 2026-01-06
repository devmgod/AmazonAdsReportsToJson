import express from "express";
import fetch from "node-fetch";
import zlib from "zlib";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Basic allowlist CORS for your Retool app domain (adjust!)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // tighten in prod
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/**
 * POST /amazon-ads/report-json
 * body: { "url": "<presigned_s3_url>" }
 * returns: JSON parsed from .json.gz
 */
app.post("/amazon-ads/report-json", async (req, res) => {

  console.log("req.body", req.body);
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Missing 'url' in body" });
    }

    const r = await fetch(url, { method: "GET" });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      
      // Check if it's an S3 XML error response
      let errorMessage = "Failed to download report";
      let errorDetails = {};
      
      if (text.includes("<?xml") && text.includes("<Error>")) {
        // Parse S3 error XML
        const codeMatch = text.match(/<Code>([^<]+)<\/Code>/);
        const messageMatch = text.match(/<Message>([^<]+)<\/Message>/);
        const expiresMatch = text.match(/<Expires>([^<]+)<\/Expires>/);
        
        if (codeMatch && messageMatch) {
          const code = codeMatch[1];
          const message = messageMatch[1];
          
          if (code === "AccessDenied" && message.includes("expired")) {
            errorMessage = "Presigned URL has expired";
            errorDetails = {
              code,
              message,
              expires: expiresMatch ? expiresMatch[1] : null,
              suggestion: "Please generate a new presigned URL from Amazon Ads API"
            };
          } else {
            errorMessage = `S3 Error: ${message}`;
            errorDetails = { code, message };
          }
        }
      }
      
      return res.status(r.status).json({
        error: errorMessage,
        status: r.status,
        statusText: r.statusText,
        ...errorDetails,
        rawResponse: text.slice(0, 500),
      });
    }

    // Read as buffer
    const arrayBuffer = await r.arrayBuffer();
    const gzBuffer = Buffer.from(arrayBuffer);

    // Gunzip
    const jsonBuffer = zlib.gunzipSync(gzBuffer);
    const jsonText = jsonBuffer.toString("utf-8");

    // Parse
    const data = JSON.parse(jsonText);

    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API listening on :${port}`));

