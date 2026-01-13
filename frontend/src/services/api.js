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
  const response = await api.post('/ai/analyze', null, { params: { aiMode } });
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

export default api;

