import express from "express";
import fetch from "node-fetch";
import zlib from "zlib";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const adsClientId = process.env.ADS_CLIENT_ID;
const adsClientSecret = process.env.ADS_CLIENT_SECRET;
const solutionProviderToken = process.env.SOLUTION_PROVIDER_TOKEN;
const adsSolutionProviderToken = process.env.ADS_SOLUTION_PROVIDER_TOKEN;
const redirectUri = process.env.REDIRECT_URI;

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Basic allowlist CORS for your Retool app domain (adjust!)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // tighten in prod
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/**
 * GET /amazon-lwa/token
 * Uses environment variables: AMAZON_REFRESH_TOKEN, AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET
 * query params: ?refresh_token=<token> (optional, defaults to AMAZON_REFRESH_TOKEN env var)
 * returns: { access_token, refresh_token, token_type, expires_in }
 */
app.get("/amazon-lwa/token", async (req, res) => {
  try {
    // Use refresh_token from query params if provided, otherwise from environment variable
    if (!clientId || !clientSecret) {
      return res.status(400).json({ 
        error: "Missing credentials. Set AMAZON_CLIENT_ID and AMAZON_CLIENT_SECRET environment variables" 
      });
    }

    // Prepare URL-encoded body
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: solutionProviderToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    // Make request to Amazon LWA token endpoint
    const response = await fetch("https://api.amazon.com/auth/o2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error_description || data.error || "Failed to refresh token",
        ...data,
      });
    }

    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * POST /amazon-ads/lwa-token
 * Gets Amazon Ads LWA access token using refresh token
 * Uses environment variables: ADS_SOLUTION_PROVIDER_TOKEN, ADS_CLIENT_ID, ADS_CLIENT_SECRET, REDIRECT_URI
 * returns: { access_token, refresh_token, token_type, expires_in }
 */
app.get("/amazon-ads/lwa-token", async (req, res) => {
  try {
    if (!adsClientId || !adsClientSecret || !adsSolutionProviderToken) {
      return res.status(400).json({ 
        error: "Missing credentials. Set ADS_CLIENT_ID, ADS_CLIENT_SECRET, and ADS_SOLUTION_PROVIDER_TOKEN environment variables" 
      });
    }

    // Prepare URL-encoded body
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: adsSolutionProviderToken,
      client_id: adsClientId,
      client_secret: adsClientSecret,
      redirect_uri: redirectUri,
    });

    // Make request to Amazon LWA token endpoint
    const response = await fetch("https://api.amazon.com/auth/o2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error_description || data.error || "Failed to refresh token",
        ...data,
      });
    }

    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
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

    // Ensure we have an array of rows
    const rows = Array.isArray(data) ? data : data.rows || [];

    // Aggregate metrics
    const totalCost = rows.reduce((s, r) => s + (r.cost || 0), 0);
    const totalSales = rows.reduce((s, r) => s + (r.sales14d || 0), 0);
    const totalImpressions = rows.reduce((s, r) => s + (r.impressions || 0), 0);
    const totalClicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);

    const summary = {
      totalCampaigns: new Set(rows.map((r) => r.campaignId)).size,
      activeCampaigns: new Set(
        rows
          .filter((r) => r.campaignStatus === "ENABLED")
          .map((r) => r.campaignId)
      ).size,
      impressions: totalImpressions,
      clicks: totalClicks,
      spend: totalCost,
      sales: totalSales,
      acos: totalSales > 0 ? totalCost / totalSales : 0,
      roas: totalCost > 0 ? totalSales / totalCost : 0,
    };

    return res.json(summary);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API listening on :${port}`));

