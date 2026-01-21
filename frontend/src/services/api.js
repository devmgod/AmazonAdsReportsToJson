import axios from 'axios';

// In development, use proxy (relative URLs). In production or when VITE_API_URL is set, use that URL
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Amazon LWA Token
export const getAmazonLWAToken = async () => {
  const response = await api.get('/amazon-lwa/token');
  return response.data;
};

// Amazon Ads LWA Token
export const getAmazonAdsLWAToken = async () => {
  const response = await api.get('/amazon-ads/lwa-token');
  return response.data;
};

// Amazon Ads Profiles
export const getAmazonAdsProfiles = async () => {
  const response = await api.get('/amazon-ads/profiles');
  return response.data;
};

// Amazon Ads Campaigns
export const getAmazonAdsCampaigns = async (queryParams = {}) => {
  const response = await api.get('/amazon-ads/campaigns', { params: queryParams });
  return response.data;
};

// Amazon SP-API Orders
export const getAmazonSPAPIOrders = async (queryParams = {}) => {
  const response = await api.get('/amazon-sp-api/orders', { params: queryParams });
  return response.data;
};

// Create Amazon Ads Report
export const createAmazonAdsReport = async (queryParams = {}) => {
  const response = await api.get('/amazon-ads/reports', { params: queryParams });
  return response.data;
};

// Get Amazon Ads Report
export const getAmazonAdsReport = async () => {
  const response = await api.get('/amazon-ads/reports/single');
  return response.data;
};

// Get Amazon Ads Report JSON
export const getAmazonAdsReportJSON = async () => {
  const response = await api.get('/amazon-ads/report-json');
  return response.data;
};

// Get All Data
export const getAllData = async (queryParams = {}) => {
  const response = await api.get('/api/all-data', { params: queryParams });
  return response.data;
};

// Get Campaigns from Database
export const getCampaignsFromDatabase = async (queryParams = {}) => {
  const response = await api.get('/db/campaigns', { params: queryParams });
  return response.data;
};

// Get Orders from Database
export const getOrdersFromDatabase = async (queryParams = {}) => {
  const response = await api.get('/db/orders', { params: queryParams });
  return response.data;
};

// Get Reports from Database
export const getReportsFromDatabase = async (queryParams = {}) => {
  const response = await api.get('/db/reports', { params: queryParams });
  return response.data;
};

// Get Reports Summary from Database
export const getReportsSummaryFromDatabase = async (queryParams = {}) => {
  const response = await api.get('/db/reports/summary', { params: queryParams });
  return response.data;
};

// AI Analysis
export const analyzeCampaigns = async (aiMode = 'analytical') => {
  // Send aiMode in request body instead of query params for POST request
  const response = await api.post('/ai/analyze', { aiMode }, {
    params: { aiMode } // Also include in query params for backward compatibility
  });
  return response.data;
};

// Get AI Detected Changes
export const getAIDetectedChanges = async (queryParams = {}) => {
  const response = await api.get('/ai/detected-changes', { params: queryParams });
  return response.data;
};

// Get Recommended Actions
export const getRecommendedActions = async (queryParams = {}) => {
  const response = await api.get('/ai/recommended-actions', { params: queryParams });
  return response.data;
};

// Get AI Decision Log
export const getAIDecisionLog = async (queryParams = {}) => {
  const response = await api.get('/ai/decision-log', { params: queryParams });
  return response.data;
};

// Execute Recommended Actions
export const executeRecommendedActions = async () => {
  const response = await api.post('/ai/execute-actions');
  return response.data;
};

// Update Campaign
export const updateCampaign = async (campaignId, updates) => {
  const response = await api.post('/ai/update-campaign', {
    campaignId,
    ...updates
  });
  return response.data;
};

// Get Optimization Metrics
export const getOptimizationMetrics = async () => {
  const response = await api.get('/ai/optimization-metrics');
  return response.data;
};

// User Goals
export const setUserGoal = async (goalData) => {
  const response = await api.post('/ai/user-goals', goalData);
  return response.data;
};

export const getUserGoals = async () => {
  const response = await api.get('/ai/user-goals');
  return response.data;
};

// ASINs
export const addASIN = async (asinData) => {
  const response = await api.post('/ai/asins', asinData);
  return response.data;
};

export const findSimilarASINs = async (asin, threshold = 0.85) => {
  const response = await api.get(`/ai/asins/${asin}/similar`, {
    params: { threshold }
  });
  return response.data;
};

// Campaign Creation for ASINs
export const createCampaignForASIN = async (campaignData) => {
  const response = await api.post('/ai/campaigns/create-for-asin', campaignData);
  return response.data;
};

// Keywords
export const promoteKeywords = async (promotionData) => {
  const response = await api.post('/ai/keywords/promote', promotionData);
  return response.data;
};

export const addNegativeKeywords = async (negativeData) => {
  const response = await api.post('/ai/keywords/negative', negativeData);
  return response.data;
};

export const getConvertingTerms = async (campaignId, options = {}) => {
  const response = await api.get(`/ai/keywords/converting-terms/${campaignId}`, {
    params: options
  });
  return response.data;
};

// Day Parting
export const getDayPartingPatterns = async (campaignId, keywordId = null) => {
  const response = await api.get(`/ai/day-parting/${campaignId}`, {
    params: keywordId ? { keywordId } : {}
  });
  return response.data;
};

export default api;

