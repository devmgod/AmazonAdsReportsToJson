import express from "express";
import fetch from "node-fetch";
import zlib from "zlib";
import dotenv from "dotenv";
import cron from "node-cron";

// Load environment variables from .env file
dotenv.config();

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const adsClientId = process.env.ADS_CLIENT_ID;
const adsClientSecret = process.env.ADS_CLIENT_SECRET;
const solutionProviderToken = process.env.SOLUTION_PROVIDER_TOKEN;
const adsSolutionProviderToken = process.env.ADS_SOLUTION_PROVIDER_TOKEN;
const redirectUri = process.env.REDIRECT_URI;
const defaultMarketplaceId = process.env.DEFAULT_MARKETPLACE_ID || "A2Q3Y263D00KWC";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Global state to store token data
const globalState = {
  amazonLwaToken: null,
  amazonAdsLwaToken: null,
  profileId: null,
  reportId: null,
  url: null,
};

/**
 * Helper function to refresh Amazon LWA token
 * Returns the token data or throws an error
 */
async function refreshAmazonLwaToken() {
  if (!clientId || !clientSecret) {
    throw new Error("Missing credentials. Set AMAZON_CLIENT_ID and AMAZON_CLIENT_SECRET environment variables");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: solutionProviderToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Failed to refresh token");
  }

  globalState.amazonLwaToken = data;
  return data;
}

/**
 * Helper function to refresh Amazon Ads LWA token
 * Returns the token data or throws an error
 */
async function refreshAmazonAdsLwaToken() {
  if (!adsClientId || !adsClientSecret || !adsSolutionProviderToken) {
    throw new Error("Missing credentials. Set ADS_CLIENT_ID, ADS_CLIENT_SECRET, and ADS_SOLUTION_PROVIDER_TOKEN environment variables");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: adsSolutionProviderToken,
    client_id: adsClientId,
    client_secret: adsClientSecret,
    redirect_uri: redirectUri,
  });

  const response = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Failed to refresh token");
  }

  globalState.amazonAdsLwaToken = data;
  return data;
}

/**
 * Helper function to fetch Amazon Ads profiles and save profileId
 * Returns the profiles data or throws an error
 */
async function fetchAmazonAdsProfiles() {
  // Check if access token is available in global state
  if (!globalState.amazonAdsLwaToken || !globalState.amazonAdsLwaToken.access_token) {
    throw new Error("Access token not available. Please call /amazon-ads/lwa-token first to get an access token.");
  }

  if (!adsClientId) {
    throw new Error("Missing ADS_CLIENT_ID environment variable");
  }

  // Get access token from global state
  const accessToken = globalState.amazonAdsLwaToken.access_token;

  // Make request to Amazon Advertising API
  const response = await fetch("https://advertising-api.amazon.com/v2/profiles", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": adsClientId,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || "Failed to fetch profiles");
  }

  // Save profileId(s) to global state
  // Assuming data is an array of profiles, save the first profile's profileId
  // If there are multiple profiles, you might want to save all of them
  if (Array.isArray(data) && data.length > 0) {
    globalState.profileId = data[0].profileId;
  } else if (data.profileId) {
    globalState.profileId = data.profileId;
  }

  return data;
}

/**
 * Helper function to fetch Amazon Ads campaigns
 * Returns the campaigns data or throws an error
 */
async function fetchAmazonAdsCampaigns(queryParams = {}) {
  // Check if access token is available in global state
  if (!globalState.amazonAdsLwaToken || !globalState.amazonAdsLwaToken.access_token) {
    throw new Error("Access token not available. Please call /amazon-ads/lwa-token first to get an access token.");
  }

  if (!adsClientId) {
    throw new Error("Missing ADS_CLIENT_ID environment variable");
  }

  if (!globalState.profileId) {
    throw new Error("Profile ID not available. Please call /amazon-ads/profiles first to get a profile ID.");
  }

  // Get access token and profileId from global state
  const accessToken = globalState.amazonAdsLwaToken.access_token;
  const profileId = globalState.profileId;

  // Build URL with query parameters
  const url = new URL("https://advertising-api.amazon.com/v2/campaigns");
  Object.keys(queryParams).forEach(key => {
    if (queryParams[key] !== undefined && queryParams[key] !== null) {
      url.searchParams.append(key, queryParams[key]);
    }
  });

  // Make request to Amazon Advertising API
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": adsClientId,
      "Amazon-Advertising-API-Scope": profileId.toString(),
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || "Failed to fetch campaigns");
  }

  return data;
}

/**
 * Helper function to create Amazon Ads report
 * Returns the report creation response or throws an error
 */
async function createAmazonAdsReport(reportBody) {
  // Check if access token is available in global state
  if (!globalState.amazonAdsLwaToken || !globalState.amazonAdsLwaToken.access_token) {
    throw new Error("Access token not available. Please call /amazon-ads/lwa-token first to get an access token.");
  }

  if (!adsClientId) {
    throw new Error("Missing ADS_CLIENT_ID environment variable");
  }

  if (!globalState.profileId) {
    throw new Error("Profile ID not available. Please call /amazon-ads/profiles first to get a profile ID.");
  }

  // Get access token and profileId from global state
  const accessToken = globalState.amazonAdsLwaToken.access_token;
  const profileId = globalState.profileId;

  // Make request to Amazon Advertising API
  const response = await fetch("https://advertising-api.amazon.com/reporting/reports", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": adsClientId,
      "Amazon-Advertising-API-Scope": profileId.toString(),
      "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
      "Accept": "application/vnd.createasyncreportresponse.v3+json",
    },
    body: JSON.stringify(reportBody),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || "Failed to create report");
  }

  // Save reportId to global state
  if (data.reportId) {
    globalState.reportId = data.reportId;
  }

  return data;
}

/**
 * Helper function to get Amazon Ads report by reportId
 * Returns the report data or throws an error
 */
async function getAmazonAdsReport(reportId) {
  // Check if access token is available in global state
  if (!globalState.amazonAdsLwaToken || !globalState.amazonAdsLwaToken.access_token) {
    throw new Error("Access token not available. Please call /amazon-ads/lwa-token first to get an access token.");
  }

  if (!adsClientId) {
    throw new Error("Missing ADS_CLIENT_ID environment variable");
  }

  if (!globalState.profileId) {
    throw new Error("Profile ID not available. Please call /amazon-ads/profiles first to get a profile ID.");
  }

  if (!reportId) {
    throw new Error("Report ID is required");
  }

  // Get access token and profileId from global state
  const accessToken = globalState.amazonAdsLwaToken.access_token;
  const profileId = globalState.profileId;

  // Make request to Amazon Advertising API
  const response = await fetch(`https://advertising-api.amazon.com/reporting/reports/${reportId}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": adsClientId,
      "Amazon-Advertising-API-Scope": profileId.toString(),
      "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
      "Accept": "application/vnd.createasyncreportresponse.v3+json",
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || "Failed to get report");
  }

  // Save URL to globalState if available in the response
  if (data.url) {
    globalState.url = data.url;
  }

  return data;
}

/**
 * Helper function to fetch Amazon Selling Partner API orders
 * Returns the orders data or throws an error
 * @param {Object} queryParams - Query parameters (MarketplaceIds, CreatedAfter, etc.)
 * @param {string} region - API region (na, eu, fe) - defaults to 'na'
 */
async function fetchAmazonSPAPIOrders(queryParams = {}, region = 'na') {
  // Check if access token is available in global state
  if (!globalState.amazonLwaToken || !globalState.amazonLwaToken.access_token) {
    throw new Error("Access token not available. Please call /amazon-lwa/token first to get an access token.");
  }

  // Get access token from global state
  const accessToken = globalState.amazonLwaToken.access_token;

  // Build base URL based on region
  const regionMap = {
    na: 'sellingpartnerapi-na.amazon.com',
    eu: 'sellingpartnerapi-eu.amazon.com',
    fe: 'sellingpartnerapi-fe.amazon.com'
  };
  
  const baseUrl = `https://${regionMap[region] || regionMap.na}/orders/v0/orders`;

  // Build URL with query parameters
  const url = new URL(baseUrl);
  
  // Handle MarketplaceIds - can be string or array
  // If not provided, use default from environment variable or fallback to "A2Q3Y263D00KWC"
  const marketplaceIdsToUse = queryParams.MarketplaceIds || defaultMarketplaceId;
  const marketplaceIds = Array.isArray(marketplaceIdsToUse) 
    ? marketplaceIdsToUse 
    : marketplaceIdsToUse.split(',');
  marketplaceIds.forEach(id => {
    const trimmedId = id.trim();
    if (trimmedId) {
      url.searchParams.append('MarketplaceIds', trimmedId);
    }
  });

  // Handle CreatedAfter - if not provided, default to 30 days ago (ISO format)
  // This matches Retool's moment().subtract(30, 'days').toISOString()
  if (queryParams.CreatedAfter) {
    url.searchParams.append('CreatedAfter', queryParams.CreatedAfter);
  } else if (!queryParams.CreatedBefore) {
    // Default to 30 days ago if no date filters provided
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    url.searchParams.append('CreatedAfter', thirtyDaysAgo.toISOString());
  }

  // Add other query parameters
  Object.keys(queryParams).forEach(key => {
    if (key !== 'MarketplaceIds' && key !== 'CreatedAfter' && 
        queryParams[key] !== undefined && queryParams[key] !== null) {
      url.searchParams.append(key, queryParams[key]);
    }
  });

  // Make request to Amazon Selling Partner API
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-amz-access-token": accessToken,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.errors?.[0]?.message || data.error || "Failed to fetch orders");
  }

  return data;
}

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
    const data = await refreshAmazonLwaToken();
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
    const data = await refreshAmazonAdsLwaToken();
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /amazon-ads/profiles
 * Gets Amazon Ads profiles
 * Uses access token from global state (amazonAdsLwaToken) and ADS_CLIENT_ID from environment
 * returns: Array of profile objects
 */
app.get("/amazon-ads/profiles", async (req, res) => {
  try {
    const data = await fetchAmazonAdsProfiles();
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /amazon-ads/campaigns
 * Gets Amazon Ads campaigns
 * Uses access token from global state (amazonAdsLwaToken), profileId, and ADS_CLIENT_ID from environment
 * Query parameters: Any valid Amazon Advertising API query parameters (e.g., startIndex, count, etc.)
 * returns: Array of campaign objects
 */
app.get("/amazon-ads/campaigns", async (req, res) => {
  try {
    const data = await fetchAmazonAdsCampaigns(req.query);
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /amazon-sp-api/orders
 * Gets Amazon Selling Partner API orders
 * Uses access token from global state (amazonLwaToken)
 * Query parameters:
 *   - MarketplaceIds: Optional. Comma-separated list or array of marketplace IDs (e.g., "A2Q3Y263D00KWC")
 *                      Defaults to DEFAULT_MARKETPLACE_ID env var or "A2Q3Y263D00KWC" if not provided
 *   - CreatedAfter: Optional. ISO 8601 date string. Defaults to 30 days ago (ISO format) if not provided
 *                    Matches Retool's moment().subtract(30, 'days').toISOString()
 *   - CreatedBefore: Optional. ISO 8601 date string
 *   - LastUpdatedAfter: Optional. ISO 8601 date string
 *   - LastUpdatedBefore: Optional. ISO 8601 date string
 *   - OrderStatuses: Optional. Array of order statuses
 *   - FulfillmentChannels: Optional. Array of fulfillment channels
 *   - PaymentMethods: Optional. Array of payment methods
 *   - BuyerEmail: Optional. Buyer email address
 *   - SellerOrderId: Optional. Seller order ID
 *   - MaxResultsPerPage: Optional. Maximum results per page (1-100)
 *   - EasyShipShipmentStatuses: Optional. Array of Easy Ship shipment statuses
 *   - NextToken: Optional. Token for pagination
 *   - AmazonOrderIds: Optional. Array of Amazon order IDs
 *   - region: Optional. API region (na, eu, fe). Defaults to 'na'
 * returns: Orders response with payload containing orders array
 */
app.get("/amazon-sp-api/orders", async (req, res) => {
  try {
    const { region, ...queryParams } = req.query;
    const data = await fetchAmazonSPAPIOrders(queryParams, region || 'na');
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * Helper function to automatically create Amazon Ads report
 * Ensures tokens and profileId are available, then creates report
 * Stores reportId in globalState
 */
async function autoCreateAmazonAdsReport() {
  try {
    console.log("[Auto Report] Starting automatic report creation...");
    
    // Ensure Amazon Ads LWA token is available
    if (!globalState.amazonAdsLwaToken || !globalState.amazonAdsLwaToken.access_token) {
      console.log("[Auto Report] Refreshing Amazon Ads LWA token...");
      await refreshAmazonAdsLwaToken();
    }
    
    // Ensure profileId is available
    if (!globalState.profileId) {
      console.log("[Auto Report] Fetching Amazon Ads profiles...");
      await fetchAmazonAdsProfiles();
    }
    
    // Calculate default dates: endDate = today, startDate = 30 days before
    const today = new Date();
    const endDateDefault = today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    
    const startDateDefault = new Date(today);
    startDateDefault.setDate(today.getDate() - 30);
    const startDateDefaultFormatted = startDateDefault.toISOString().split('T')[0]; // Format: YYYY-MM-DD

    // Build report body with defaults
    const reportBody = {
      "name": "sp-dashboard-daily",
      "startDate": startDateDefaultFormatted,
      "endDate": endDateDefault,
      "configuration": {
        "adProduct": "SPONSORED_PRODUCTS",
        "groupBy": ["campaign"],
        "reportTypeId": "spCampaigns",
        "timeUnit": "DAILY",
        "format": "GZIP_JSON",
        "columns": [
          "date",
          "campaignId",
          "campaignName",
          "campaignStatus",
          "campaignBudgetAmount",
          "campaignBudgetCurrencyCode",
          "campaignBudgetType",
          "campaignBiddingStrategy",
          "impressions",
          "clicks",
          "cost",
          "costPerClick",
          "clickThroughRate",
          "sales1d",
          "sales7d",
          "sales14d",
          "sales30d",
          "purchases1d",
          "purchases7d",
          "purchases14d",
          "purchases30d",
          "unitsSoldClicks1d",
          "unitsSoldClicks7d",
          "unitsSoldClicks14d",
          "unitsSoldClicks30d",
          "unitsSoldSameSku1d",
          "unitsSoldSameSku7d",
          "unitsSoldSameSku14d",
          "unitsSoldSameSku30d",
          "attributedSalesSameSku1d",
          "attributedSalesSameSku7d",
          "attributedSalesSameSku14d",
          "attributedSalesSameSku30d",
          "acosClicks14d",
          "roasClicks14d",
          "topOfSearchImpressionShare"
        ]
      }
    };

    const data = await createAmazonAdsReport(reportBody);
    console.log(`[Auto Report] Report created successfully. ReportId: ${globalState.reportId}`);
    return data;
  } catch (e) {
    console.error(`[Auto Report] Failed to create report: ${e?.message || "Unknown error"}`);
    throw e;
  }
}

/**
 * GET /amazon-ads/reports
 * Creates an Amazon Ads report
 * Uses access token from global state (amazonAdsLwaToken), profileId, and ADS_CLIENT_ID from environment
 * Query parameters (optional): name, startDate, endDate - if not provided, uses defaults
 * returns: Report creation response with reportId and status
 */
app.get("/amazon-ads/reports", async (req, res) => {
  try {
    // Calculate default dates: endDate = today, startDate = 30 days before
    const today = new Date();
    const endDateDefault = today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    
    const startDateDefault = new Date(today);
    startDateDefault.setDate(today.getDate() - 30);
    const startDateDefaultFormatted = startDateDefault.toISOString().split('T')[0]; // Format: YYYY-MM-DD

    // Build report body with query parameters or defaults
    const reportBody = {
      "name": req.query.name || "sp-dashboard-daily",
      "startDate": req.query.startDate || startDateDefaultFormatted,
      "endDate": req.query.endDate || endDateDefault,
      "configuration": {
        "adProduct": "SPONSORED_PRODUCTS",
        "groupBy": ["campaign"],
        "reportTypeId": "spCampaigns",
        "timeUnit": "DAILY",
        "format": "GZIP_JSON",
        "columns": [
          "date",
          "campaignId",
          "campaignName",
          "campaignStatus",
          "campaignBudgetAmount",
          "campaignBudgetCurrencyCode",
          "campaignBudgetType",
          "campaignBiddingStrategy",
          "impressions",
          "clicks",
          "cost",
          "costPerClick",
          "clickThroughRate",
          "sales1d",
          "sales7d",
          "sales14d",
          "sales30d",
          "purchases1d",
          "purchases7d",
          "purchases14d",
          "purchases30d",
          "unitsSoldClicks1d",
          "unitsSoldClicks7d",
          "unitsSoldClicks14d",
          "unitsSoldClicks30d",
          "unitsSoldSameSku1d",
          "unitsSoldSameSku7d",
          "unitsSoldSameSku14d",
          "unitsSoldSameSku30d",
          "attributedSalesSameSku1d",
          "attributedSalesSameSku7d",
          "attributedSalesSameSku14d",
          "attributedSalesSameSku30d",
          "acosClicks14d",
          "roasClicks14d",
          "topOfSearchImpressionShare"
        ]
      }
    };

    const data = await createAmazonAdsReport(reportBody);
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /amazon-ads/reports/single
 * Gets an Amazon Ads report by reportId
 * Uses access token from global state (amazonAdsLwaToken), profileId, and ADS_CLIENT_ID from environment
 * Path parameter: reportId - if not provided or empty, uses reportId from globalState
 * Query parameter: reportId (optional) - can also be provided as query param, falls back to globalState
 * returns: Report data with status and download URL if available
 */
app.get("/amazon-ads/reports/single", async (req, res) => {
  try {
    // Use reportId from path parameter or fallback to globalState
    const reportId = globalState.reportId || "6649bbff-aeff-4791-9816-144fe39b903e";
    
    if (!reportId) {
      return res.status(400).json({ error: "Report ID is required. Please provide reportId in the URL or create a report first." });
    }
    
    const data = await getAmazonAdsReport(reportId);
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * Helper function to fetch and process Amazon Ads report JSON
 * Returns the summary data or throws an error
 */
async function fetchAmazonAdsReportSummary() {
  const url = globalState.url;
  if (!url || typeof url !== "string") {
    throw new Error("Missing 'url' in globalState. Please get a report first.");
  }

  const r = await fetch(url, { method: "GET" });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    
    // Check if it's an S3 XML error response
    let errorMessage = "Failed to download report";
    
    if (text.includes("<?xml") && text.includes("<Error>")) {
      // Parse S3 error XML
      const codeMatch = text.match(/<Code>([^<]+)<\/Code>/);
      const messageMatch = text.match(/<Message>([^<]+)<\/Message>/);
      
      if (codeMatch && messageMatch) {
        const code = codeMatch[1];
        const message = messageMatch[1];
        
        if (code === "AccessDenied" && message.includes("expired")) {
          errorMessage = "Presigned URL has expired";
        } else {
          errorMessage = `S3 Error: ${message}`;
        }
      }
    }
    
    throw new Error(errorMessage);
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
  const summary = rows.reduce((acc, row) => {
    acc.impressions += row.impressions || 0;
    acc.clicks += row.clicks || 0;
    acc.cost += row.cost || 0;
    acc.sales14d += row.sales14d || 0;
    acc.sales30d += row.sales30d || 0;
    acc.purchases14d += row.purchases14d || 0;
    return acc;
  }, {
    impressions: 0,
    clicks: 0,
    cost: 0,
    sales14d: 0,
    sales30d: 0,
    purchases14d: 0
  });

  summary.ctr = summary.impressions > 0
    ? (summary.clicks / summary.impressions) * 100
    : 0;

  summary.cpc = summary.clicks > 0
    ? summary.cost / summary.clicks
    : 0;

  const totalCost = rows.reduce((s, r) => s + (r.cost || 0), 0);
  const adRevenue = rows.reduce((s, r) => s + (r.sales14d || 0), 0);
  
  const acos = adRevenue > 0
    ? (totalCost / adRevenue) * 100
    : null;
  
  summary.acos = Number(acos?.toFixed(2));

  // TACOS calculation (totalRevenue should come from Seller Central / SP-API)
  const tacosTotalCost = rows.reduce((s, r) => s + (r.cost || 0), 0);
  // TODO: Get totalRevenue from Seller Central / SP-API (marketplaceTotalRevenue)
  const totalRevenue = null; // This must come from Seller Central / SP-API
  
  const tacos = totalRevenue > 0
    ? (tacosTotalCost / totalRevenue) * 100
    : null;
  
  summary.tacos = Number(tacos?.toFixed(2));

  summary.roas = summary.cost > 0
    ? summary.sales14d / summary.cost
    : null;

  summary.shopping = rows.reduce((sum, r) => sum + (r.purchases14d || 0), 0);
  summary.totalSpend = rows.reduce((sum, r) => sum + (r.cost || 0), 0);

  // Add campaign counts
  summary.totalCampaigns = new Set(rows.map((r) => r.campaignId)).size;
  summary.activeCampaigns = new Set(
    rows
      .filter((r) => r.campaignStatus === "ENABLED")
      .map((r) => r.campaignId)
  ).size;

  return {summary, data};
}

/**
 * GET /amazon-ads/report-json
 * returns: JSON parsed from .json.gz
 */
app.get("/amazon-ads/report-json", async (req, res) => {
  try {
    const {summary, data} = await fetchAmazonAdsReportSummary();
    return res.json({summary, data});
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /api/all-data
 * Returns all data from the server including global state, configuration, and status
 * returns: Complete server data including tokens, profileId, reportId, url, campaigns, orders, reportSummary, and server info
 * Query parameters: Can include any query parameters for campaigns and orders endpoints (e.g., MarketplaceIds, CreatedAfter, region, etc.)
 * Report summary includes: totalCampaigns, activeCampaigns, impressions, clicks, spend, sales, acos, roas
 */
app.get("/api/all-data", async (req, res) => {
  try {
    // Fetch campaigns data if tokens and profile are available
    let campaignsData = null;
    let campaignsError = null;
    
    try {
      if (globalState.amazonAdsLwaToken?.access_token && globalState.profileId) {
        campaignsData = await fetchAmazonAdsCampaigns(req.query);
      }
    } catch (error) {
      campaignsError = error.message || "Failed to fetch campaigns";
    }

    // Fetch orders data if LWA token is available
    let ordersData = null;
    let ordersError = null;
    
    try {
      if (globalState.amazonLwaToken?.access_token) {
        // Use query params for orders, but extract region if provided
        const { region, ...ordersQuery } = req.query;
        ordersData = await fetchAmazonSPAPIOrders(ordersQuery, region || 'na');
      }
    } catch (error) {
      ordersError = error.message || "Failed to fetch orders";
    }

    // Fetch report summary if URL is available
    let reportSummary = null;
    let reportSummaryError = null;
    
    try {
      if (globalState.url) {
        reportSummary = await fetchAmazonAdsReportSummary();
      }
    } catch (error) {
      reportSummaryError = error.message || "Failed to fetch report summary";
    }

    // Prepare response with all server data
    const allData = {
      globalState: {
        amazonLwaToken: globalState.amazonLwaToken
          ? {
              tokenType: globalState.amazonLwaToken.token_type,
              expiresIn: globalState.amazonLwaToken.expires_in,
              // Don't expose full token for security, just show it exists
              hasAccessToken: !!globalState.amazonLwaToken.access_token,
              hasRefreshToken: !!globalState.amazonLwaToken.refresh_token,
            }
          : null,
        amazonAdsLwaToken: globalState.amazonAdsLwaToken
          ? {
              tokenType: globalState.amazonAdsLwaToken.token_type,
              expiresIn: globalState.amazonAdsLwaToken.expires_in,
              hasAccessToken: !!globalState.amazonAdsLwaToken.access_token,
              hasRefreshToken: !!globalState.amazonAdsLwaToken.refresh_token,
            }
          : null,
        profileId: globalState.profileId,
        reportId: globalState.reportId || "ec48c701-c924-487d-9885-530e038249ef",
        url: globalState.url,
      },
      campaigns: campaignsData || null,
      campaignsError: campaignsError || null,
      orders: ordersData || null,
      ordersError: ordersError || null,
      reportSummary: reportSummary || null,
      reportSummaryError: reportSummaryError || null,
      tokenStatus: {
        amazonLwaToken: {
          hasToken: !!globalState.amazonLwaToken,
          hasAccessToken: !!globalState.amazonLwaToken?.access_token,
          hasRefreshToken: !!globalState.amazonLwaToken?.refresh_token,
        },
        amazonAdsLwaToken: {
          hasToken: !!globalState.amazonAdsLwaToken,
          hasAccessToken: !!globalState.amazonAdsLwaToken?.access_token,
          hasRefreshToken: !!globalState.amazonAdsLwaToken?.refresh_token,
        },
      },
      serverInfo: {
        port: process.env.PORT || 3000,
        environment: process.env.NODE_ENV || "development",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
      configuration: {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasAdsClientId: !!adsClientId,
        hasAdsClientSecret: !!adsClientSecret,
        hasSolutionProviderToken: !!solutionProviderToken,
        hasAdsSolutionProviderToken: !!adsSolutionProviderToken,
        hasRedirectUri: !!redirectUri,
        // Don't expose actual credentials for security
      },
      availableEndpoints: [
        "GET /amazon-lwa/token",
        "GET /amazon-ads/lwa-token",
        "GET /amazon-ads/profiles",
        "GET /amazon-ads/campaigns",
        "GET /amazon-ads/reports",
        "GET /amazon-ads/reports/single",
        "GET /amazon-ads/report-json",
        "GET /amazon-sp-api/orders",
        "GET /api/all-data",
      ],
    };

    return res.json(allData);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log(`API listening on :${port}`);
  
  // Initialize tokens on server startup
  console.log("Initializing tokens on startup...");
  
  try {
    await refreshAmazonLwaToken();
    console.log("✓ Amazon LWA token refreshed successfully");
  } catch (error) {
    console.error("✗ Failed to refresh Amazon LWA token:", error.message);
  }
  
  try {
    await refreshAmazonAdsLwaToken();
    console.log("✓ Amazon Ads LWA token refreshed successfully");
    
    // Fetch profiles and save profileId after token is refreshed
    try {
      await fetchAmazonAdsProfiles();
      console.log(`✓ Amazon Ads profiles fetched successfully. ProfileId: ${globalState.profileId}`);
      
      // Fetch report and save URL after profiles are fetched
      try {
        // Use the same default reportId as the /amazon-ads/reports/single endpoint
        const reportId = globalState.reportId || "6649bbff-aeff-4791-9816-144fe39b903e";
        globalState.reportId = reportId;

        const reportData = await getAmazonAdsReport(reportId);
        console.log(`✓ Amazon Ads report fetched successfully. ReportId: ${reportId}`);
        if (globalState.url) {
          console.log(`  Report URL saved to globalState`);
        }
      } catch (error) {
        console.error("✗ Failed to fetch Amazon Ads report:", error.message);
      }
    } catch (error) {
      console.error("✗ Failed to fetch Amazon Ads profiles:", error.message);
    }
  } catch (error) {
    console.error("✗ Failed to refresh Amazon Ads LWA token:", error.message);
  }
  
  // Set up daily cron job to automatically create report
  // Runs every day at 2 AM Brazilian time (America/Sao_Paulo timezone)
  // To change the schedule, modify the cron expression:
  // "0 2 * * *" = every day at 2 AM (default: Brazilian time)
  // "0 0 * * *" = every day at midnight
  // "0 0 * * 1" = every Monday at midnight
  const cronSchedule = process.env.REPORT_CRON_SCHEDULE || "0 2 * * *"; // Default: daily at 2 AM Brazilian time
  const cronTimezone = process.env.REPORT_CRON_TIMEZONE || "America/Sao_Paulo"; // Brazilian timezone
  
  cron.schedule(cronSchedule, async () => {
    console.log(`[Cron] Scheduled report creation triggered at ${new Date().toISOString()}`);
    try {
      await autoCreateAmazonAdsReport();
    } catch (error) {
      console.error(`[Cron] Error in scheduled report creation:`, error.message);
    }
  }, {
    scheduled: true,
    timezone: cronTimezone
  });
  
  console.log(`✓ Daily cron job scheduled. Report will be created automatically at: ${cronSchedule} (${cronTimezone})`);
  console.log(`  Current reportId in globalState: ${globalState.reportId || "None"}`);
});

