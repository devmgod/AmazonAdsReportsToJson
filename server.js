import express from "express";
import fetch from "node-fetch";
import zlib from "zlib";
import dotenv from "dotenv";
import cors from "cors";
import {
  testDatabaseConnection,
  initializeCampaignsTable,
  storeCampaignsInDatabase,
  getCampaignsFromDatabase,
  initializeOrdersTable,
  storeOrdersInDatabase,
  getOrdersFromDatabase,
  getDatabaseTestResult,
  getDatabaseInfo,
  initializeReportSingleTable,
  storeReportSingleInDatabase,
  initializeReportsTable,
  storeReportsInDatabase,
  getReportsFromDatabase,
  initializeAIDecisionLogTable,
  initializeAIDetectedChangesTable,
  initializeRecommendedActionsTable,
  storeAIDecision,
  getAIDecisionLog,
  storeAIDetectedChange,
  getAIDetectedChanges,
  storeRecommendedAction,
  getRecommendedActions,
  updateRecommendedActionStatus,
} from "./database.js";

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

// Enable CORS with specific origins
app.use(cors({
  origin: [
    "https://amazonadsreportstojson-1.onrender.com",
    "https://livingfinds.com.br",
    "http://localhost:5173"
  ],
  credentials: true
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Global state to store token data
const globalState = {
  amazonLwaToken: null,
  amazonAdsLwaToken: null,
  profileId: null,
  reportId: "a4f574e2-ee7f-486a-8303-2d0c13902a5e",
  url: null,
  revenue: null,
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

  // Calculate total order revenue from orders
  if (data.payload && data.payload.Orders && Array.isArray(data.payload.Orders)) {
    const totalRevenue = data.payload.Orders.reduce((sum, order) => {
      // OrderTotal structure: { Amount: string, CurrencyCode: string }
      const orderTotal = order.OrderTotal?.Amount || 0;
      const amount = typeof orderTotal === 'string' ? parseFloat(orderTotal) : (orderTotal || 0);
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0);
    
    globalState.revenue = totalRevenue;
  } else {
    globalState.revenue = 0;
  }

  return data;
}


/**
 * GET /db/test
 * Tests PostgreSQL database connection
 * returns: Connection status and database info
 */
app.get("/db/test", async (req, res) => {
  try {
    const result = await getDatabaseTestResult();
    if (result.success) {
      return res.json(result);
    } else {
      return res.status(500).json(result);
    }
  } catch (e) {
    const dbInfo = getDatabaseInfo();
    return res.status(500).json({ 
      success: false,
      error: e?.message || "Database connection error",
      database: dbInfo.database,
      host: dbInfo.host,
    });
  }
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
 * Gets Amazon Ads campaigns and stores them in the database
 * Uses access token from global state (amazonAdsLwaToken), profileId, and ADS_CLIENT_ID from environment
 * Query parameters: Any valid Amazon Advertising API query parameters (e.g., startIndex, count, etc.)
 * returns: Array of campaign objects and storage status
 */
app.get("/amazon-ads/campaigns", async (req, res) => {
  try {
    const data = await fetchAmazonAdsCampaigns(req.query);
    
    // Store campaigns in database if data is an array
    let storageResult = null;
    if (Array.isArray(data)) {
      try {
        storageResult = await storeCampaignsInDatabase(data);
      } catch (storageError) {
        console.error("Failed to store campaigns:", storageError.message);
        // Continue even if storage fails, return the data anyway
      }
    }
    
    // Return campaigns data along with storage status
    return res.json({
      campaigns: data,
      storage: storageResult || { message: "No campaigns to store or storage failed" }
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /db/campaigns
 * Retrieves campaigns from the database
 * Query parameters:
 *   - state: Filter by campaign state (e.g., "archived", "enabled")
 *   - campaignType: Filter by campaign type (e.g., "sponsoredProducts")
 *   - limit: Limit number of results (default: 100). Use "all" or "0" to fetch all records
 *   - offset: Offset for pagination (default: 0)
 * returns: Array of campaign objects from database with totalCount metadata
 */
app.get("/db/campaigns", async (req, res) => {
  try {
    const result = await getCampaignsFromDatabase({
      state: req.query.state,
      campaignType: req.query.campaignType,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /db/orders
 * Retrieves orders from the database
 * Query parameters:
 *   - orderStatus: Filter by order status (e.g., "Unshipped", "Shipped")
 *   - marketplaceId: Filter by marketplace ID
 *   - fulfillmentChannel: Filter by fulfillment channel (e.g., "MFN", "AFN")
 *   - startDate: Filter orders from this date (ISO 8601 format)
 *   - endDate: Filter orders until this date (ISO 8601 format)
 *   - limit: Limit number of results (default: 100). Use "all" or "0" to fetch all records
 *   - offset: Offset for pagination (default: 0)
 * returns: Array of order objects from database with totalCount metadata
 */
app.get("/db/orders", async (req, res) => {
  try {
    const result = await getOrdersFromDatabase({
      orderStatus: req.query.orderStatus,
      marketplaceId: req.query.marketplaceId,
      fulfillmentChannel: req.query.fulfillmentChannel,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /db/reports
 * Retrieves reports from the database
 * Query parameters:
 *   - reportId: Filter by report ID
 *   - campaignId: Filter by campaign ID
 *   - campaignStatus: Filter by campaign status (e.g., "ENABLED", "PAUSED")
 *   - startDate: Filter reports from this date (ISO 8601 format)
 *   - endDate: Filter reports until this date (ISO 8601 format)
 *   - limit: Limit number of results (default: 100). Use "all" or "0" to fetch all records
 *   - offset: Offset for pagination (default: 0)
 * returns: Array of report objects from database with totalCount metadata
 */
app.get("/db/reports", async (req, res) => {
  try {
    const result = await getReportsFromDatabase({
      reportId: req.query.reportId,
      campaignId: req.query.campaignId,
      campaignStatus: req.query.campaignStatus,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /db/reports/summary
 * Retrieves summary data from reports table
 * Query parameters:
 *   - reportId: Filter by report ID
 *   - campaignId: Filter by campaign ID
 *   - campaignStatus: Filter by campaign status (e.g., "ENABLED", "PAUSED")
 *   - startDate: Filter reports from this date (ISO 8601 format)
 *   - endDate: Filter reports until this date (ISO 8601 format)
 *   - limit: Limit number of results for calculation (default: "all"). Use "all" or "0" to fetch all records
 * returns: Summary object with aggregated metrics (impressions, clicks, cost, sales, acos, roas, etc.)
 */
app.get("/db/reports/summary", async (req, res) => {
  try {
    // Get reports from database - use "all" by default to calculate summary from all matching records
    const result = await getReportsFromDatabase({
      reportId: req.query.reportId,
      campaignId: req.query.campaignId,
      campaignStatus: req.query.campaignStatus,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: req.query.limit || "all", // Default to "all" for summary calculation
      offset: 0, // Always start from beginning for summary
    });

    // Transform database rows to match format expected by calculateReportSummary
    // Ensure all numeric fields are properly converted and dates are formatted correctly
    const rows = result.reports.map(report => {
      // Convert date to string format (YYYY-MM-DD)
      let dateValue = report.date;
      if (dateValue instanceof Date) {
        dateValue = dateValue.toISOString().split('T')[0];
      } else if (dateValue && typeof dateValue === 'string') {
        // Remove time portion if present
        dateValue = dateValue.split('T')[0];
      } else if (!dateValue) {
        dateValue = null;
      }
      
      // Helper function to safely convert numeric values
      const toNumber = (value) => {
        if (value === null || value === undefined) return 0;
        const num = typeof value === 'number' ? value : parseFloat(value);
        return isNaN(num) ? 0 : num;
      };
      
      return {
        date: dateValue,
        impressions: toNumber(report.impressions),
        clicks: toNumber(report.clicks),
        cost: toNumber(report.cost),
        sales1d: toNumber(report.sales1d),
        sales7d: toNumber(report.sales7d),
        sales14d: toNumber(report.sales14d),
        sales30d: toNumber(report.sales30d),
        purchases14d: toNumber(report.purchases14d),
        campaignId: report.campaignId || null,
        campaignStatus: report.campaignStatus || null,
      };
    });

    // Calculate summary using the existing function
    const summary = calculateReportSummary(rows);

    // Return summary with metadata
    return res.json({
      summary,
      metadata: {
        totalReports: result.totalCount,
        reportsUsed: rows.length,
        filters: {
          reportId: req.query.reportId || null,
          campaignId: req.query.campaignId || null,
          campaignStatus: req.query.campaignStatus || null,
          startDate: req.query.startDate || null,
          endDate: req.query.endDate || null,
        }
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /amazon-sp-api/orders
 * Gets Amazon Selling Partner API orders and stores them in the database
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
 * returns: Orders response with payload containing orders array and storage status
 */
app.get("/amazon-sp-api/orders", async (req, res) => {
  try {
    const { region, ...queryParams } = req.query;
    const data = await fetchAmazonSPAPIOrders(queryParams, region || 'na');
    
    // Store orders in database if orders array exists
    let storageResult = null;
    if (data.payload && data.payload.Orders && Array.isArray(data.payload.Orders)) {
      try {
        storageResult = await storeOrdersInDatabase(data.payload.Orders);
      } catch (storageError) {
        console.error("Failed to store orders:", storageError.message);
        // Continue even if storage fails, return the data anyway
      }
    }
    
    // Return orders data along with storage status
    return res.json({
      ...data,
      storage: storageResult || { message: "No orders to store or storage failed" }
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /amazon-ads/reports
 * Creates an Amazon Ads report
 * Uses access token from global state (amazonAdsLwaToken), profileId, and ADS_CLIENT_ID from environment
 * Query parameters (optional): name, startDate, endDate - if not provided, uses defaults
 * returns: Report creation response with reportId and status
 */
app.get("/amazon-ads/reports", async (req, res) => {
  try {
    // Calculate dates based on period query parameter or defaults
    const today = new Date();
    const endDateDefault = today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    
    // Determine number of days based on period query parameter
    // Default to 30 days if period is not provided or not recognized
    let daysBack = 30;
    if (req.query.period === "7d") {
      daysBack = 7;
    } else if (req.query.period === "30d") {
      daysBack = 30;
    }
    // If period is not provided or doesn't match "7d" or "30d", daysBack remains 30 (default)
    
    const startDateDefault = new Date(today);
    startDateDefault.setDate(today.getDate() - daysBack);
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
    const reportId = globalState.reportId;
    
    if (!reportId) {
      return res.status(400).json({ error: "Report ID is required. Please provide reportId in the URL or create a report first." });
    }
    
    const data = await getAmazonAdsReport(reportId);
    
    // Store report data in database
    let storageResult = null;
    try {
      storageResult = await storeReportSingleInDatabase(data);
    } catch (storageError) {
      console.error("Failed to store report_single:", storageError.message);
      // Continue even if storage fails, return the data anyway
    }
    
    // Return report data along with storage status
    return res.json({
      ...data,
      storage: storageResult || { message: "Storage failed" }
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * Helper function to update Amazon Ads campaign
 * Updates campaign budget or bidding strategy
 */
async function updateAmazonAdsCampaign(campaignId, updates) {
  if (!globalState.amazonAdsLwaToken || !globalState.amazonAdsLwaToken.access_token) {
    throw new Error("Access token not available. Please call /amazon-ads/lwa-token first.");
  }

  if (!adsClientId) {
    throw new Error("Missing ADS_CLIENT_ID environment variable");
  }

  if (!globalState.profileId) {
    throw new Error("Profile ID not available. Please call /amazon-ads/profiles first.");
  }

  const accessToken = globalState.amazonAdsLwaToken.access_token;
  const profileId = globalState.profileId;

  // Build update payload
  const updatePayload = {
    campaignId: campaignId.toString(),
    ...updates
  };

  const response = await fetch(`https://advertising-api.amazon.com/v2/campaigns`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": adsClientId,
      "Amazon-Advertising-API-Scope": profileId.toString(),
      "Content-Type": "application/vnd.updatecampaignsrequest.v3+json",
      "Accept": "application/vnd.updatecampaignsresponse.v3+json",
    },
    body: JSON.stringify([updatePayload]),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || "Failed to update campaign");
  }

  return data;
}

/**
 * AI Decision Engine
 * Analyzes campaign performance and generates recommendations
 */
async function analyzeCampaignPerformance(campaigns, reports, aiMode = 'analytical') {
  const analysis = {
    detectedChanges: [],
    recommendedActions: [],
    optimizationMetrics: {
      campaignsOptimized: 0
    }
  };

  // Group reports by campaign
  const reportsByCampaign = {};
  reports.forEach(report => {
    if (!reportsByCampaign[report.campaignId]) {
      reportsByCampaign[report.campaignId] = [];
    }
    reportsByCampaign[report.campaignId].push(report);
  });

  // Analyze each campaign
  for (const campaign of campaigns) {
    if (campaign.state !== 'enabled' && campaign.state !== 'ENABLED') continue;

    const campaignReports = reportsByCampaign[campaign.campaignId] || [];
    if (campaignReports.length === 0) continue;

    // Calculate campaign metrics
    const totalCost = campaignReports.reduce((sum, r) => sum + (parseFloat(r.cost) || 0), 0);
    const totalSales = campaignReports.reduce((sum, r) => sum + (parseFloat(r.sales14d) || 0), 0);
    const totalClicks = campaignReports.reduce((sum, r) => sum + (parseInt(r.clicks) || 0), 0);
    const totalImpressions = campaignReports.reduce((sum, r) => sum + (parseInt(r.impressions) || 0), 0);

    const roas = totalCost > 0 ? totalSales / totalCost : 0;
    const acos = totalSales > 0 ? (totalCost / totalSales) * 100 : 0;
    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const cpc = totalClicks > 0 ? totalCost / totalClicks : 0;
    const dailyBudget = parseFloat(campaign.dailyBudget) || 0;

    // Decision logic based on performance
    let confidence = 'medium';
    let detectedChange = null;
    let recommendedAction = null;

    // High ROAS (>3.0) - Increase budget
    if (roas > 3.0 && campaignReports.length >= 7) {
      confidence = 'high';
      const suggestedIncrease = Math.min(dailyBudget * 0.2, 50); // Max 20% or R$50
      
      detectedChange = {
        date: new Date(),
        description: `High ROAS detected: Campaign "${campaign.name}" shows ${roas.toFixed(2)}x ROAS`,
        details: `Campaign demonstrates consistently high return. Current daily budget: R$ ${dailyBudget.toFixed(2)}. Recommend increasing by R$ ${suggestedIncrease.toFixed(2)}.`,
        confidence: 'high',
        campaignId: campaign.campaignId,
        patternType: 'high_roas'
      };

      if (aiMode === 'execution') {
        recommendedAction = {
          type: 'Budget Adjustment',
          title: `Increase daily budget for Campaign ${campaign.name}`,
          description: `Increase daily budget from R$ ${dailyBudget.toFixed(2)} to R$ ${(dailyBudget + suggestedIncrease).toFixed(2)} based on high ROAS performance (${roas.toFixed(2)}x)`,
          campaignId: campaign.campaignId,
          campaignName: campaign.name,
          scheduledTime: '3:00 AM',
          status: 'pending',
          actionData: {
            action: 'update_budget',
            campaignId: campaign.campaignId,
            oldBudget: dailyBudget,
            newBudget: dailyBudget + suggestedIncrease
          }
        };
      }
    }
    // Low ROAS (<1.5) and high ACOS (>50%) - Decrease budget or pause
    else if (roas < 1.5 && acos > 50 && campaignReports.length >= 7) {
      confidence = 'high';
      const suggestedDecrease = Math.max(dailyBudget * 0.2, 10); // Min 20% or R$10
      
      detectedChange = {
        date: new Date(),
        description: `Low ROAS and high ACOS: Campaign "${campaign.name}" shows ${roas.toFixed(2)}x ROAS and ${acos.toFixed(2)}% ACOS`,
        details: `Campaign performance is below target. Current daily budget: R$ ${dailyBudget.toFixed(2)}. Recommend decreasing by R$ ${suggestedDecrease.toFixed(2)} or pausing.`,
        confidence: 'high',
        campaignId: campaign.campaignId,
        patternType: 'low_performance'
      };

      if (aiMode === 'execution' && dailyBudget > 20) {
        recommendedAction = {
          type: 'Budget Adjustment',
          title: `Decrease daily budget for Campaign ${campaign.name}`,
          description: `Decrease daily budget from R$ ${dailyBudget.toFixed(2)} to R$ ${(dailyBudget - suggestedDecrease).toFixed(2)} due to low ROAS (${roas.toFixed(2)}x)`,
          campaignId: campaign.campaignId,
          campaignName: campaign.name,
          scheduledTime: '3:00 AM',
          status: 'pending',
          actionData: {
            action: 'update_budget',
            campaignId: campaign.campaignId,
            oldBudget: dailyBudget,
            newBudget: Math.max(dailyBudget - suggestedDecrease, 10)
          }
        };
      }
    }
    // High CTR (>2%) but low conversions - Optimize bids
    else if (ctr > 2 && roas < 2 && campaignReports.length >= 14) {
      confidence = 'medium';
      const currentBid = campaign.bidding?.strategy || cpc;
      const suggestedBid = currentBid * 0.9; // Reduce by 10%
      
      detectedChange = {
        date: new Date(),
        description: `High CTR but low conversions: Campaign "${campaign.name}" has ${ctr.toFixed(2)}% CTR but ${roas.toFixed(2)}x ROAS`,
        details: `Campaign gets clicks but conversions are low. Current CPC: R$ ${cpc.toFixed(2)}. Recommend reducing bid by 10% to improve efficiency.`,
        confidence: 'medium',
        campaignId: campaign.campaignId,
        patternType: 'ctr_conversion_mismatch'
      };

      if (aiMode === 'execution') {
        recommendedAction = {
          type: 'Bid Adjustment',
          title: `Optimize bid for Campaign ${campaign.name}`,
          description: `Reduce bid by 10% to improve conversion efficiency. Current CPC: R$ ${cpc.toFixed(2)}`,
          campaignId: campaign.campaignId,
          campaignName: campaign.name,
          scheduledTime: '3:00 AM',
          status: 'pending',
          actionData: {
            action: 'update_bid',
            campaignId: campaign.campaignId,
            oldBid: currentBid,
            newBid: suggestedBid
          }
        };
      }
    }

    // Store detected changes
    if (detectedChange) {
      try {
        await storeAIDetectedChange(detectedChange);
        analysis.detectedChanges.push(detectedChange);
      } catch (error) {
        console.error(`Failed to store detected change for campaign ${campaign.campaignId}:`, error.message);
      }
    }

    // Store recommended actions
    if (recommendedAction) {
      try {
        await storeRecommendedAction(recommendedAction);
        analysis.recommendedActions.push(recommendedAction);
        analysis.optimizationMetrics.campaignsOptimized++;
      } catch (error) {
        console.error(`Failed to store recommended action for campaign ${campaign.campaignId}:`, error.message);
      }
    }
  }

  return analysis;
}

/**
 * Execute recommended actions
 * This function should be called at 3:00 AM daily
 */
async function executeRecommendedActions() {
  try {
    // Get all pending actions
    const pendingActions = await getRecommendedActions({ status: 'pending', limit: 'all' });
    
    const results = [];
    
    for (const action of pendingActions) {
      try {
        const actionData = action.actionData || {};
        
        if (actionData.action === 'update_budget') {
          // Update campaign budget
          await updateAmazonAdsCampaign(actionData.campaignId, {
            dailyBudget: {
              amount: actionData.newBudget,
              currencyCode: 'BRL'
            }
          });

          // Log the decision
          await storeAIDecision({
            timestamp: new Date(),
            campaignId: actionData.campaignId,
            campaignName: action.campaignName,
            actionType: 'Budget Update',
            whatChanged: `Daily budget changed from R$ ${actionData.oldBudget.toFixed(2)} to R$ ${actionData.newBudget.toFixed(2)}`,
            reason: action.description,
            status: 'success',
            oldValue: { budget: actionData.oldBudget },
            newValue: { budget: actionData.newBudget },
            confidence: 'high',
            aiMode: 'execution'
          });

          // Update action status
          await updateRecommendedActionStatus(action.id, 'executed', new Date());
          
          results.push({
            actionId: action.id,
            status: 'success',
            message: `Budget updated successfully for campaign ${actionData.campaignId}`
          });
        } else if (actionData.action === 'update_bid') {
          // Note: Bid updates require updating ad groups or keywords, which is more complex
          // For now, we'll log it as a recommendation that needs manual implementation
          await storeAIDecision({
            timestamp: new Date(),
            campaignId: actionData.campaignId,
            campaignName: action.campaignName,
            actionType: 'Bid Adjustment',
            whatChanged: `Bid adjustment recommended: ${actionData.oldBid.toFixed(2)} to ${actionData.newBid.toFixed(2)}`,
            reason: action.description,
            status: 'pending_manual',
            oldValue: { bid: actionData.oldBid },
            newValue: { bid: actionData.newBid },
            confidence: 'medium',
            aiMode: 'execution'
          });

          await updateRecommendedActionStatus(action.id, 'requires_manual', new Date());
          
          results.push({
            actionId: action.id,
            status: 'requires_manual',
            message: `Bid adjustment requires manual implementation for campaign ${actionData.campaignId}`
          });
        }
      } catch (error) {
        // Log failed action
        await storeAIDecision({
          timestamp: new Date(),
          campaignId: action.campaignId,
          campaignName: action.campaignName,
          actionType: action.type,
          whatChanged: action.title,
          reason: `Failed to execute: ${error.message}`,
          status: 'failed',
          oldValue: {},
          newValue: {},
          confidence: 'high',
          aiMode: 'execution'
        });

        await updateRecommendedActionStatus(action.id, 'failed', new Date());
        
        results.push({
          actionId: action.id,
          status: 'failed',
          message: error.message
        });
      }
    }

    return {
      executed: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length,
      requiresManual: results.filter(r => r.status === 'requires_manual').length,
      results
    };
  } catch (error) {
    console.error('Error executing recommended actions:', error);
    throw error;
  }
}

/**
 * Helper function to calculate summary metrics from report rows
 * @param {Array} rows - Array of report row objects
 * @returns {Object} Summary object with aggregated metrics
 */
function calculateReportSummary(rows) {
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
    ? summary.clicks / summary.impressions
    : 0;

  summary.cpc = summary.clicks > 0
    ? summary.cost / summary.clicks
    : 0;

  const totalCost = rows.reduce((s, r) => s + (r.cost || 0), 0);
  const adRevenue = rows.reduce((s, r) => s + (r.sales14d || 0), 0);
  const adRevenue30d = rows.reduce((s, r) => s + (r.sales30d || 0), 0);
  const adRevenue1d = rows.reduce((s, r) => s + (r.sales1d || 0), 0);
  const adRevenue7d = rows.reduce((s, r) => s + (r.sales7d || 0), 0);
  
  const acos = adRevenue > 0
    ? (totalCost / adRevenue) * 100
    : null;
  
  summary.acos = Number(acos?.toFixed(2));

  // Calculate TACOS (Total Advertising Cost of Sales)
  // TACOS = Ad Spend ÷ Total Revenue × 100
  const totalRevenue = globalState.revenue || 0;
  const tacos = totalRevenue > 0
    ? (totalCost / (adRevenue + adRevenue30d)) * 100
    : null;
  
  summary.tacos = Number(tacos?.toFixed(2));
  summary.totalCost = totalCost;
  summary.totalRevenue = totalRevenue;
  summary.adRevenue = adRevenue;

  // Extract startDate and endDate from report data
  // Convert dates to YYYY-MM-DD string format
  const dates = rows
    .map(row => {
      if (!row.date) return null;
      // If it's already a string in YYYY-MM-DD format, use it
      if (typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row.date)) {
        return row.date.split('T')[0]; // Take only the date part if it includes time
      }
      // If it's a Date object, convert to YYYY-MM-DD
      if (row.date instanceof Date) {
        return row.date.toISOString().split('T')[0];
      }
      // Try to parse as date and convert
      try {
        const date = new Date(row.date);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      } catch (e) {
        // Ignore parsing errors
      }
      return null;
    })
    .filter(date => date != null)
    .sort();
  
  summary.startDate = dates.length > 0 ? dates[0] : null;
  summary.endDate = dates.length > 0 ? dates[dates.length - 1] : null;

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

  return summary;
}

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

  // Store report rows in database
  const reportId = globalState.reportId;
  if (reportId && rows.length > 0) {
    try {
      await storeReportsInDatabase(reportId, rows);
    } catch (storageError) {
      console.error("Failed to store report rows:", storageError.message);
      // Continue even if storage fails
    }
  }

  // Calculate summary using separate function
  const summary = calculateReportSummary(rows);

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
    let campaignsStorageResult = null;
    
    try {
      if (globalState.amazonAdsLwaToken?.access_token && globalState.profileId) {
        campaignsData = await fetchAmazonAdsCampaigns(req.query);
        
        // Store campaigns in database if data is an array
        if (Array.isArray(campaignsData)) {
          try {
            campaignsStorageResult = await storeCampaignsInDatabase(campaignsData);
          } catch (storageError) {
            console.error("Failed to store campaigns in /api/all-data:", storageError.message);
            // Continue even if storage fails
          }
        }
      }
    } catch (error) {
      campaignsError = error.message || "Failed to fetch campaigns";
    }

    // Fetch orders data if LWA token is available
    let ordersData = null;
    let ordersError = null;
    let ordersStorageResult = null;
    
    try {
      if (globalState.amazonLwaToken?.access_token) {
        // Use query params for orders, but extract region if provided
        const { region, ...ordersQuery } = req.query;
        ordersData = await fetchAmazonSPAPIOrders(ordersQuery, region || 'na');
        
        // Store orders in database if orders array exists
        if (ordersData.payload && ordersData.payload.Orders && Array.isArray(ordersData.payload.Orders)) {
          try {
            ordersStorageResult = await storeOrdersInDatabase(ordersData.payload.Orders);
          } catch (storageError) {
            console.error("Failed to store orders in /api/all-data:", storageError.message);
            // Continue even if storage fails
          }
        }
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
        reportId: globalState.reportId,
        url: globalState.url,
        revenue: globalState.revenue,
      },
      campaigns: campaignsData || null,
      campaignsError: campaignsError || null,
      campaignsStorage: campaignsStorageResult || null,
      orders: ordersData || null,
      ordersError: ordersError || null,
      ordersStorage: ordersStorageResult || null,
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
        "GET /db/test",
        "GET /db/campaigns",
        "GET /db/orders",
        "GET /db/reports",
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

/**
 * POST /ai/analyze
 * Analyzes campaign performance and generates AI recommendations
 * Query parameters:
 *   - aiMode: 'analytical' or 'execution' (default: 'analytical')
 */
app.post("/ai/analyze", async (req, res) => {
  try {
    const aiMode = req.query.aiMode || req.body.aiMode || 'analytical';
    
    // Get campaigns and reports from database
    const campaignsResult = await getCampaignsFromDatabase({ limit: 'all' });
    const reportsResult = await getReportsFromDatabase({ limit: 'all' });
    
    const campaigns = campaignsResult.campaigns || [];
    const reports = reportsResult.reports || [];
    
    // Run AI analysis
    const analysis = await analyzeCampaignPerformance(campaigns, reports, aiMode);
    
    return res.json({
      success: true,
      aiMode,
      analysis,
      metadata: {
        campaignsAnalyzed: campaigns.length,
        reportsAnalyzed: reports.length,
        timestamp: new Date()
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /ai/detected-changes
 * Retrieves AI-detected changes from database
 * Query parameters:
 *   - confidence: Filter by confidence level ('high', 'medium', 'low', 'all')
 *   - campaignId: Filter by campaign ID
 *   - limit: Limit number of results
 */
app.get("/ai/detected-changes", async (req, res) => {
  try {
    const changes = await getAIDetectedChanges({
      confidence: req.query.confidence || 'all',
      campaignId: req.query.campaignId,
      limit: req.query.limit || 100
    });
    return res.json({ changes, count: changes.length });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /ai/recommended-actions
 * Retrieves recommended actions from database
 * Query parameters:
 *   - status: Filter by status ('pending', 'executed', 'failed')
 *   - limit: Limit number of results
 */
app.get("/ai/recommended-actions", async (req, res) => {
  try {
    const actions = await getRecommendedActions({
      status: req.query.status,
      limit: req.query.limit || 100
    });
    return res.json({ actions, count: actions.length });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /ai/decision-log
 * Retrieves AI decision log from database
 * Query parameters:
 *   - campaignId: Filter by campaign ID
 *   - startDate: Filter from date
 *   - endDate: Filter to date
 *   - status: Filter by status
 *   - limit: Limit number of results
 *   - offset: Offset for pagination
 */
app.get("/ai/decision-log", async (req, res) => {
  try {
    const result = await getAIDecisionLog({
      campaignId: req.query.campaignId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status,
      limit: req.query.limit || 100,
      offset: req.query.offset || 0
    });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * POST /ai/execute-actions
 * Executes pending recommended actions
 * This endpoint should be called at 3:00 AM daily (via cron job or scheduler)
 */
app.post("/ai/execute-actions", async (req, res) => {
  try {
    const result = await executeRecommendedActions();
    return res.json({
      success: true,
      message: `Executed ${result.executed} actions, ${result.failed} failed, ${result.requiresManual} require manual intervention`,
      ...result
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * POST /ai/update-campaign
 * Manually update a campaign (budget or bid)
 * Body: { campaignId, dailyBudget?, bidding? }
 */
app.post("/ai/update-campaign", async (req, res) => {
  try {
    const { campaignId, dailyBudget, bidding } = req.body;
    
    if (!campaignId) {
      return res.status(400).json({ error: "campaignId is required" });
    }

    const updates = {};
    if (dailyBudget !== undefined) {
      updates.dailyBudget = {
        amount: dailyBudget,
        currencyCode: 'BRL'
      };
    }
    if (bidding !== undefined) {
      updates.bidding = bidding;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "At least one update field (dailyBudget or bidding) is required" });
    }

    // Get current campaign data for logging
    const campaignsResult = await getCampaignsFromDatabase({ limit: 'all' });
    const campaign = campaignsResult.campaigns.find(c => c.campaignId === campaignId);
    
    // Update campaign via Amazon Ads API
    const result = await updateAmazonAdsCampaign(campaignId, updates);
    
    // Log the decision
    await storeAIDecision({
      timestamp: new Date(),
      campaignId: campaignId,
      campaignName: campaign?.name || null,
      actionType: 'Manual Update',
      whatChanged: JSON.stringify(updates),
      reason: 'Manual campaign update via API',
      status: 'success',
      oldValue: campaign || {},
      newValue: updates,
      confidence: 'high',
      aiMode: 'execution'
    });
    
    return res.json({
      success: true,
      message: "Campaign updated successfully",
      result
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

/**
 * GET /ai/optimization-metrics
 * Get optimization metrics
 */
app.get("/ai/optimization-metrics", async (req, res) => {
  try {
    const campaignsResult = await getCampaignsFromDatabase({ limit: 'all' });
    const campaigns = campaignsResult.campaigns || [];
    const optimizedCampaigns = campaigns.filter(c => 
      c.state === 'enabled' || c.state === 'ENABLED'
    ).length;
    
    return res.json({
      campaignsOptimized: optimizedCampaigns,
      totalCampaigns: campaigns.length
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log(`API listening on :${port}`);
  
  // Test database connection on startup
  console.log("Testing PostgreSQL connection...");
  await testDatabaseConnection();
  
  // Initialize campaigns table
  console.log("Initializing campaigns table...");
  await initializeCampaignsTable();
  
  // Initialize orders table
  console.log("Initializing orders table...");
  await initializeOrdersTable();
  
  // Initialize report_single table
  console.log("Initializing report_single table...");
  await initializeReportSingleTable();
  
  // Initialize reports table
  console.log("Initializing reports table...");
  await initializeReportsTable();
  
  // Initialize AI tables
  console.log("Initializing AI tables...");
  await initializeAIDecisionLogTable();
  await initializeAIDetectedChangesTable();
  await initializeRecommendedActionsTable();
  
  // Initialize tokens on server startup
  console.log("Initializing tokens on startup...");
  
  try {
    await refreshAmazonLwaToken();
    console.log("✓ Amazon LWA token refreshed successfully");
    
    // Fetch orders and calculate revenue after token is refreshed
    try {
      const ordersData = await fetchAmazonSPAPIOrders({}, 'na');
      console.log(`✓ Amazon SP-API orders fetched successfully. Revenue: ${globalState.revenue || 0}`);
      if (ordersData.payload && ordersData.payload.Orders) {
        console.log(`  Total orders: ${ordersData.payload.Orders.length}`);
        
        // Store orders in database
        try {
          const storageResult = await storeOrdersInDatabase(ordersData.payload.Orders);
          console.log(`✓ Orders stored in database: ${storageResult.stored} new, ${storageResult.updated} updated`);
        } catch (storageError) {
          console.error("✗ Failed to store orders in database:", storageError.message);
        }
      }
    } catch (error) {
      console.error("✗ Failed to fetch Amazon SP-API orders:", error.message);
    }
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
    } catch (error) {
      console.error("✗ Failed to fetch Amazon Ads profiles:", error.message);
    }
  } catch (error) {
    console.error("✗ Failed to refresh Amazon Ads LWA token:", error.message);
  }
});

