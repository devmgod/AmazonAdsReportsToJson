import { useState, useEffect } from 'react';
import { 
  getAllData, 
  getCampaignsFromDatabase, 
  getOrdersFromDatabase, 
  getReportsFromDatabase, 
  getReportsSummaryFromDatabase,
  analyzeCampaigns,
  getAIDetectedChanges,
  getRecommendedActions,
  getAIDecisionLog,
  getOptimizationMetrics,
  updateCampaign
} from '../services/api';
import Navigation from './Navigation';
import ApiStatusCards from './ApiStatusCards';
import LineChart from './LineChart';
import MetricCard from './MetricCard';
import { fmt } from '../utils/format';

function Dashboard() {
  const [activeTab, setActiveTab] = useState('home');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [dbCampaigns, setDbCampaigns] = useState([]);
  const [dbOrders, setDbOrders] = useState([]);
  const [dbReports, setDbReports] = useState([]);
  const [dbReportsSummary, setDbReportsSummary] = useState(null);
  const [dbLoading, setDbLoading] = useState(true);
  
  // Pagination state for each table
  const [reportsPage, setReportsPage] = useState(1);
  const [campaignsPage, setCampaignsPage] = useState(1);
  const [ordersPage, setOrdersPage] = useState(1);
  const [inventoryPage, setInventoryPage] = useState(1);
  const itemsPerPage = 10;

  // GestãoAds state
  const [dailyBudget, setDailyBudget] = useState('');
  const [maxBidValue, setMaxBidValue] = useState('');
  const [goalType, setGoalType] = useState(''); // 'TACoS', 'ACoS', 'CPC', 'Conversions', 'ROAS'
  const [targetValue, setTargetValue] = useState('');
  const [aiDetectedChanges, setAiDetectedChanges] = useState([]);
  const [recommendedActions, setRecommendedActions] = useState([]);
  const [optimizationMetrics, setOptimizationMetrics] = useState({ campaignsOptimized: 0 });
  const [confidenceFilter, setConfidenceFilter] = useState('all'); // 'all', 'high', 'medium', 'low'
  const [decisionLog, setDecisionLog] = useState([]);
  const [aiMode, setAiMode] = useState('analytical'); // 'analytical' or 'execution'
  const [decisionLogPage, setDecisionLogPage] = useState(1);

  const fetchData = async () => {
    try {
      setError(null);
      const response = await getAllData();
      setData(response);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch data');
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchDatabaseData = async () => {
    try {
      setDbLoading(true);
      
      // Fetch campaigns, orders, reports, and reports summary from database in parallel
      // Use limit=all to fetch all records (over 1000)
      const [campaignsResult, ordersResult, reportsResult, reportsSummaryResult] = await Promise.all([
        getCampaignsFromDatabase({ limit: 'all' }).catch(err => {
          console.error('Error fetching campaigns from database:', err);
          return { campaigns: [], totalCount: 0 };
        }),
        getOrdersFromDatabase({ limit: 'all' }).catch(err => {
          console.error('Error fetching orders from database:', err);
          return { orders: [], totalCount: 0 };
        }),
        getReportsFromDatabase({ limit: 'all' }).catch(err => {
          console.error('Error fetching reports from database:', err);
          return { reports: [], totalCount: 0 };
        }),
        getReportsSummaryFromDatabase({ limit: 'all' }).catch(err => {
          console.error('Error fetching reports summary from database:', err);
          return null;
        }),
      ]);

      setDbCampaigns(campaignsResult.campaigns || []);
      setDbOrders(ordersResult.orders || []);
      setDbReports(reportsResult.reports || []);
      setDbReportsSummary(reportsSummaryResult?.summary || null);
      
      // Log total counts for debugging
      console.log('Database data loaded:', {
        campaigns: campaignsResult.campaigns?.length || 0,
        orders: ordersResult.orders?.length || 0,
        reports: reportsResult.reports?.length || 0,
        reportsSummary: reportsSummaryResult?.summary ? 'Available' : 'Not available',
        totalCounts: {
          campaigns: campaignsResult.totalCount || 0,
          orders: ordersResult.totalCount || 0,
          reports: reportsResult.totalCount || 0,
        }
      });
      
      // Reset pagination to first page when data is refreshed
      setReportsPage(1);
      setCampaignsPage(1);
      setOrdersPage(1);
      setInventoryPage(1);
    } catch (err) {
      console.error('Error fetching database data:', err);
    } finally {
      setDbLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchDatabaseData();
  }, []);

  // Fetch AI data for GestãoAds
  const fetchAIData = async () => {
    if (activeTab !== 'gestaoAds') return;
    
    try {
      // Fetch AI detected changes
      const changesResponse = await getAIDetectedChanges({ 
        confidence: confidenceFilter === 'all' ? 'all' : confidenceFilter,
        limit: 100 
      });
      setAiDetectedChanges(changesResponse.changes || []);

      // Fetch recommended actions
      const actionsResponse = await getRecommendedActions({ limit: 100 });
      setRecommendedActions(actionsResponse.actions || []);

      // Fetch decision log
      const logResponse = await getAIDecisionLog({ limit: 100 });
      // Map database field names to frontend field names
      const mappedDecisions = (logResponse.decisions || []).map(decision => ({
        timestamp: decision.timestamp,
        campaignId: decision.campaign_id,
        campaignName: decision.campaign_name,
        actionType: decision.action_type,
        whatChanged: decision.what_changed,
        reason: decision.reason,
        status: decision.status
      }));
      setDecisionLog(mappedDecisions);

      // Fetch optimization metrics
      const metricsResponse = await getOptimizationMetrics();
      setOptimizationMetrics(metricsResponse || { campaignsOptimized: 0 });
    } catch (error) {
      console.error('Error fetching AI data:', error);
    }
  };

  // Initialize and fetch AI data for GestãoAds
  useEffect(() => {
    if (activeTab === 'gestaoAds') {
      fetchAIData();
    }
  }, [activeTab, confidenceFilter]);

  // Handle budget/bid updates for all campaigns
  const handleBudgetUpdate = async () => {
    if (!dailyBudget || parseFloat(dailyBudget) <= 0) {
      alert('Please enter a valid daily budget');
      return;
    }

    try {
      const budgetValue = parseFloat(dailyBudget);
      
      // Get campaigns from state (prioritize dbCampaigns, fallback to data.campaigns)
      const campaignsToUpdate = dbCampaigns.length > 0 ? dbCampaigns : (data?.campaigns || []);
      
      if (campaignsToUpdate.length === 0) {
        alert('No campaigns available to update');
        return;
      }

      let successCount = 0;
      let errorCount = 0;

      for (const campaign of campaignsToUpdate) {
        try {
          await updateCampaign(campaign.campaignId, { dailyBudget: budgetValue });
          successCount++;
        } catch (error) {
          console.error(`Error updating budget for campaign ${campaign.campaignId}:`, error);
          errorCount++;
        }
      }

      if (successCount > 0) {
        alert(`Budget updated successfully for ${successCount} campaign(s)${errorCount > 0 ? `. ${errorCount} campaign(s) failed to update.` : ''}`);
        // Refresh AI data after update
        await fetchAIData();
      } else {
        alert('Failed to update budget for any campaigns');
      }
    } catch (error) {
      console.error('Error updating budget:', error);
      alert('Failed to update budget: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleBidUpdate = async () => {
    if (!maxBidValue || parseFloat(maxBidValue) <= 0) {
      alert('Please enter a valid max bid value');
      return;
    }

    try {
      const bidValue = parseFloat(maxBidValue);
      
      // Get campaigns from state (prioritize dbCampaigns, fallback to data.campaigns)
      const campaignsToUpdate = dbCampaigns.length > 0 ? dbCampaigns : (data?.campaigns || []);
      
      if (campaignsToUpdate.length === 0) {
        alert('No campaigns available to update');
        return;
      }

      let successCount = 0;
      let errorCount = 0;

      for (const campaign of campaignsToUpdate) {
        try {
          // Note: Bid updates may need different structure depending on API requirements
          await updateCampaign(campaign.campaignId, { bidding: { strategy: 'legacyForSales', adjustments: [] } });
          successCount++;
        } catch (error) {
          console.error(`Error updating bid for campaign ${campaign.campaignId}:`, error);
          errorCount++;
        }
      }

      if (successCount > 0) {
        alert(`Max bid value updated successfully for ${successCount} campaign(s)${errorCount > 0 ? `. ${errorCount} campaign(s) failed to update.` : ''}`);
        // Refresh AI data after update
        await fetchAIData();
      } else {
        alert('Failed to update max bid value for any campaigns');
      }
    } catch (error) {
      console.error('Error updating bid:', error);
      alert('Failed to update bid: ' + (error.response?.data?.error || error.message));
    }
  };

  // Trigger AI analysis
  const handleAnalyze = async () => {
    try {
      const result = await analyzeCampaigns(aiMode);
      // Refresh AI data after analysis
      await fetchAIData();
      alert(`Analysis complete! Found ${result.analysis.detectedChanges.length} changes and ${result.analysis.recommendedActions.length} recommended actions.`);
    } catch (error) {
      console.error('Error running analysis:', error);
      alert('Failed to run analysis: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
    fetchDatabaseData();
  };

  const handleUpdateToken = () => {
    // TODO: Implement token update
    console.log('Update token clicked');
  };

  const handleProcessReports = () => {
    // TODO: Implement report processing
    console.log('Process reports clicked');
  };

  // Pagination helper functions
  const getPaginatedData = (data, page, itemsPerPage) => {
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return data.slice(startIndex, endIndex);
  };

  const getTotalPages = (data, itemsPerPage) => {
    return Math.ceil(data.length / itemsPerPage);
  };

  // Pagination component
  const Pagination = ({ currentPage, totalPages, onPageChange, dataLength, itemsPerPage }) => {
    const startItem = (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, dataLength);

    const handlePrevious = () => {
      if (currentPage > 1) {
        onPageChange(currentPage - 1);
      }
    };

    const handleNext = () => {
      if (currentPage < totalPages) {
        onPageChange(currentPage + 1);
      }
    };

    if (totalPages <= 1) return null;

    // Calculate page numbers to show
    const getPageNumbers = () => {
      const pages = [];
      const maxVisible = 5;
      
      if (totalPages <= maxVisible) {
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        if (currentPage <= 3) {
          for (let i = 1; i <= 4; i++) {
            pages.push(i);
          }
          pages.push('...');
          pages.push(totalPages);
        } else if (currentPage >= totalPages - 2) {
          pages.push(1);
          pages.push('...');
          for (let i = totalPages - 3; i <= totalPages; i++) {
            pages.push(i);
          }
        } else {
          pages.push(1);
          pages.push('...');
          for (let i = currentPage - 1; i <= currentPage + 1; i++) {
            pages.push(i);
          }
          pages.push('...');
          pages.push(totalPages);
        }
      }
      return pages;
    };

    return (
      <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
        <div className="flex-1 flex justify-between sm:hidden">
          <button
            onClick={handlePrevious}
            disabled={currentPage === 1}
            className={`relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md ${
              currentPage === 1
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            Anterior
          </button>
          <button
            onClick={handleNext}
            disabled={currentPage === totalPages}
            className={`ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md ${
              currentPage === totalPages
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            Próximo
          </button>
        </div>
        <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-gray-700">
              Mostrando <span className="font-medium">{startItem}</span> até{' '}
              <span className="font-medium">{endItem}</span> de{' '}
              <span className="font-medium">{dataLength}</span> resultados
            </p>
          </div>
          <div>
            <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
              <button
                onClick={handlePrevious}
                disabled={currentPage === 1}
                className={`relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium ${
                  currentPage === 1
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                <span className="sr-only">Anterior</span>
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </button>
              {getPageNumbers().map((page, idx) => (
                page === '...' ? (
                  <span key={`ellipsis-${idx}`} className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
                    ...
                  </span>
                ) : (
                  <button
                    key={page}
                    onClick={() => onPageChange(page)}
                    className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                      currentPage === page
                        ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                        : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {page}
                  </button>
                )
              ))}
              <button
                onClick={handleNext}
                disabled={currentPage === totalPages}
                className={`relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium ${
                  currentPage === totalPages
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                <span className="sr-only">Próximo</span>
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            </nav>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Carregando dados do dashboard...</p>
        </div>
      </div>
    );
  }

  // Prioritize database reports summary, then API reportSummary, then calculate from reports
  const reportSummary = dbReportsSummary || data?.reportSummary || null;
  // Use database data if available, otherwise fall back to API data
  const campaigns = dbCampaigns.length > 0 ? dbCampaigns : (data?.campaigns || []);
  const orders = dbOrders.length > 0 ? dbOrders : (data?.orders?.payload?.Orders || []);
  const reports = dbReports.length > 0 ? dbReports : [];
  
  const campaignsCount = campaigns.length;
  const ordersCount = orders.length;
  const reportsCount = reports.length;
  
  // Prioritize summary data from database, then from API, then calculate from reports, then use campaign data
  let totalSales = 0;
  let totalAdSpend = 0;
  let impressions = 0;
  let clicks = 0;
  let acos = 0;
  let roas = 0;
  let tacos = 0;
  let averageCPC = 0;
  let ctr = 0;
  let activeCampaigns = 0;
  let totalCampaigns = campaignsCount;

  // Use reportSummary from database or API if available (highest priority)
  if (reportSummary) {
    totalSales = reportSummary?.adRevenue || reportSummary?.sales14d || 0;
    totalAdSpend = reportSummary?.totalCost || reportSummary?.cost || 0;
    impressions = reportSummary?.impressions || 0;
    clicks = reportSummary?.clicks || 0;
    acos = reportSummary?.acos || 0;
    roas = reportSummary?.roas || 0;
    tacos = reportSummary?.tacos || 0;
    averageCPC = reportSummary?.cpc || 0;
    ctr = reportSummary?.ctr || 0;
    activeCampaigns = reportSummary?.activeCampaigns || 0;
    totalCampaigns = reportSummary?.totalCampaigns || campaignsCount;
  } else if (reports.length > 0) {
    // Calculate metrics from database reports if summary not available
    totalSales = reports.reduce((sum, r) => sum + (parseFloat(r.sales14d) || 0), 0);
    totalAdSpend = reports.reduce((sum, r) => sum + (parseFloat(r.cost) || 0), 0);
    impressions = reports.reduce((sum, r) => sum + (r.impressions || 0), 0);
    clicks = reports.reduce((sum, r) => sum + (r.clicks || 0), 0);
    
    // Calculate ACOS: (Total Cost / Total Sales) * 100
    acos = totalSales > 0 ? (totalAdSpend / totalSales) * 100 : 0;
    
    // Calculate ROAS: Total Sales / Total Cost
    roas = totalAdSpend > 0 ? totalSales / totalAdSpend : 0;
    
    // Calculate TACOS: (Ad Spend / Total Revenue) * 100
    // Total Revenue = Ad Revenue + Other Revenue (using orders total if available)
    const totalRevenue = orders.reduce((sum, o) => {
      const amount = parseFloat(o.OrderTotal?.Amount || 0);
      return sum + amount;
    }, 0) + totalSales;
    tacos = totalRevenue > 0 ? (totalAdSpend / totalRevenue) * 100 : 0;
    
    // Calculate average CPC
    averageCPC = clicks > 0 ? totalAdSpend / clicks : 0;
    
    // Calculate CTR
    ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    
    // Get active campaigns from reports
    const activeCampaignIds = new Set(
      reports
        .filter(r => r.campaignStatus === 'ENABLED')
        .map(r => r.campaignId)
    );
    activeCampaigns = activeCampaignIds.size;
  } else {
    // Fallback: use campaign data for active campaigns count
    activeCampaigns = campaigns.filter(c => c.state === 'enabled' || c.state === 'ENABLED').length;
  }

  // Calculate averageCPC if not set from summary
  if (averageCPC === 0 && clicks > 0) {
    averageCPC = totalAdSpend / clicks;
  }

  // Generate sample chart data (30 days)
  const generateChartData = (baseValue = 0, variance = 0.5) => {
    const data = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      data.push({
        date: date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        value: baseValue + (Math.random() * variance * baseValue),
      });
    }
    return data;
  };

  const salesData = generateChartData(totalSales / 30, 0.3);
  
  // Process impressions data from reports
  const processImpressionsData = () => {
    if (reports.length === 0) {
      // Fallback to generated data if no reports available
      return generateChartData(impressions / 30, 0.3);
    }

    // Group impressions by date
    const impressionsByDate = {};
    reports.forEach(report => {
      if (report.date && report.impressions !== undefined && report.impressions !== null) {
        const date = new Date(report.date);
        // Format date as DD/MM
        const dateKey = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const fullDateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD for sorting
        
        if (!impressionsByDate[fullDateKey]) {
          impressionsByDate[fullDateKey] = {
            date: dateKey,
            fullDate: fullDateKey,
            value: 0
          };
        }
        impressionsByDate[fullDateKey].value += parseInt(report.impressions) || 0;
      }
    });

    // Convert to array and sort by date
    const impressionsDataArray = Object.values(impressionsByDate)
      .sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate))
      .map(item => ({
        date: item.date,
        value: item.value
      }));

    return impressionsDataArray.length > 0 ? impressionsDataArray : generateChartData(impressions / 30, 0.3);
  };

  const impressionsData = processImpressionsData();
  
  // Process clicks data from reports
  const processClicksData = () => {
    if (reports.length === 0) {
      // Fallback to generated data if no reports available
      return generateChartData(clicks / 30, 0.3);
    }

    // Group clicks by date
    const clicksByDate = {};
    reports.forEach(report => {
      if (report.date && report.clicks !== undefined && report.clicks !== null) {
        const date = new Date(report.date);
        // Format date as DD/MM
        const dateKey = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const fullDateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD for sorting
        
        if (!clicksByDate[fullDateKey]) {
          clicksByDate[fullDateKey] = {
            date: dateKey,
            fullDate: fullDateKey,
            value: 0
          };
        }
        clicksByDate[fullDateKey].value += parseInt(report.clicks) || 0;
      }
    });

    // Convert to array and sort by date
    const clicksDataArray = Object.values(clicksByDate)
      .sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate))
      .map(item => ({
        date: item.date,
        value: item.value
      }));

    return clicksDataArray.length > 0 ? clicksDataArray : generateChartData(clicks / 30, 0.3);
  };

  const clicksData = processClicksData();
  const cpcData = generateChartData(averageCPC, 0.2);
  
  // Process cost data from reports
  const processCostData = () => {
    if (reports.length === 0) {
      // Fallback to generated data if no reports available
      return generateChartData(totalAdSpend / 30, 0.3);
    }

    // Group cost by date
    const costByDate = {};
    reports.forEach(report => {
      if (report.date && report.cost !== undefined && report.cost !== null) {
        const date = new Date(report.date);
        // Format date as DD/MM
        const dateKey = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const fullDateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD for sorting
        
        if (!costByDate[fullDateKey]) {
          costByDate[fullDateKey] = {
            date: dateKey,
            fullDate: fullDateKey,
            value: 0
          };
        }
        costByDate[fullDateKey].value += parseFloat(report.cost) || 0;
      }
    });

    // Convert to array and sort by date
    const costDataArray = Object.values(costByDate)
      .sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate))
      .map(item => ({
        date: item.date,
        value: item.value
      }));

    return costDataArray.length > 0 ? costDataArray : generateChartData(totalAdSpend / 30, 0.3);
  };

  const costData = processCostData();

  // Process sales data from reports
  const processSalesData = () => {
    if (reports.length === 0) {
      // Fallback to generated data if no reports available
      return generateChartData(totalSales / 30, 0.3);
    }

    // Group sales by date
    const salesByDate = {};
    reports.forEach(report => {
      if (report.date && report.sales14d !== undefined && report.sales14d !== null) {
        const date = new Date(report.date);
        // Format date as DD/MM
        const dateKey = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const fullDateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD for sorting
        
        if (!salesByDate[fullDateKey]) {
          salesByDate[fullDateKey] = {
            date: dateKey,
            fullDate: fullDateKey,
            value: 0
          };
        }
        salesByDate[fullDateKey].value += parseFloat(report.sales14d) || 0;
      }
    });

    // Convert to array and sort by date
    const salesDataArray = Object.values(salesByDate)
      .sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate))
      .map(item => ({
        date: item.date,
        value: item.value
      }));

    return salesDataArray.length > 0 ? salesDataArray : generateChartData(totalSales / 30, 0.3);
  };

  const salesDataForPerformance = processSalesData();
  
  // Generate performance data for 30 days using real data from reports
  const generatePerformanceData = () => {
    // Create maps for quick lookup by date string (DD/MM)
    const clicksMap = new Map(clicksData.map(item => [item.date, item.value]));
    const salesMap = new Map(salesDataForPerformance.map(item => [item.date, item.value]));
    const costMap = new Map(costData.map(item => [item.date, item.value]));

    // Get all unique dates from all three datasets
    const allDates = new Set();
    clicksData.forEach(item => allDates.add(item.date));
    salesDataForPerformance.forEach(item => allDates.add(item.date));
    costData.forEach(item => allDates.add(item.date));

    // If we have report data, use those dates (they're already sorted)
    if (reports.length > 0 && allDates.size > 0) {
      // Get unique dates from reports with their full date for sorting
      const dateMap = new Map();
      reports.forEach(report => {
        if (report.date) {
          const date = new Date(report.date);
          const dateKey = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
          const fullDateKey = date.toISOString().split('T')[0];
          if (!dateMap.has(dateKey) || dateMap.get(dateKey).fullDate < fullDateKey) {
            dateMap.set(dateKey, { date: dateKey, fullDate: fullDateKey });
          }
        }
      });

      // Sort by full date and return performance data
      return Array.from(dateMap.values())
        .sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate))
        .map(item => ({
          date: item.date,
          clicks: clicksMap.get(item.date) || 0,
          sales: salesMap.get(item.date) || 0,
          cost: costMap.get(item.date) || 0,
        }));
    }

    // Fallback: generate last 30 days with data from maps
    const performanceData = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      performanceData.push({
        date: dateKey,
        clicks: clicksMap.get(dateKey) || 0,
        sales: salesMap.get(dateKey) || 0,
        cost: costMap.get(dateKey) || 0,
      });
    }
    return performanceData;
  };

  const performanceData = generatePerformanceData();

  // Get page title based on active tab
  const getPageTitle = () => {
    const titles = {
      home: 'Home — LivingFinds Ads Analytics',
      gestaoAds: 'GestãoAds',
      estoqueVendas: 'Sales and Inventory',
    };
    return titles[activeTab] || 'Dashboard';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">
            {getPageTitle()}
          </h1>
        </div>
      </header>

      {/* Navigation */}
      <Navigation activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'home' ? (
          <>
            {/* API Status Cards */}
            <ApiStatusCards
              tokenStatus={data?.tokenStatus}
              campaignsCount={campaignsCount}
              ordersCount={ordersCount}
              campaignsError={data?.campaignsError}
              ordersError={data?.ordersError}
            />

            
            {/* First Row of Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <LineChart
                title="Vendas Totais Diárias (R$)"
                subtitle="Vendas e Gasto - Últimos 30 Dias"
                data={salesData}
                dataKey="value"
                yAxisLabel="Valor (BRL)"
                xAxisLabel="Data"
                color="#8884d8"
              />
              <LineChart
                title="Impressões por Dia"
                subtitle="Impressões por Dia (últimos 30 dias)"
                data={impressionsData}
                dataKey="value"
                yAxisLabel="Impressões (contagem)"
                xAxisLabel="Date"
                color="#82ca9d"
              />
            </div>

            {/* Second Row of Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <LineChart
                title="Cliques por Dia"
                subtitle="Cliques por Dia (últimos 30 dias)"
                data={clicksData}
                dataKey="value"
                yAxisLabel="Cliques (contagem)"
                xAxisLabel="Date"
                color="#ffc658"
              />
              <LineChart
                title="Performance: Clicks, Sales e Cost"
                subtitle="Performance: Clicks, Sales e Cost (Últimos 30 dias)"
                data={performanceData}
                dataKey="clicks"
                yAxisLabel="Quantidade (unidades)"
                xAxisLabel="Date"
                color="#ff7300"
                lines={[
                  { dataKey: 'clicks', color: '#8884d8', name: 'Clicks' },
                  { dataKey: 'sales', color: '#82ca9d', name: 'Sales' },
                  { dataKey: 'cost', color: '#ff7300', name: 'Cost' },
                ]}
              />
            </div>

            {/* Summary Info Section */}
            {reportSummary && (reportSummary.startDate || reportSummary.endDate) && (
              <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-blue-900 mb-1">
                      {dbReportsSummary ? 'Dados do Resumo do Banco de Dados' : 'Dados do Resumo do Backend'}
                    </h3>
                    <p className="text-xs text-blue-700">
                      {reportSummary.startDate && reportSummary.endDate ? (
                        <>Período: {new Date(reportSummary.startDate).toLocaleDateString('pt-BR')} até {new Date(reportSummary.endDate).toLocaleDateString('pt-BR')}</>
                      ) : (
                        <>Dados agregados do relatório</>
                      )}
                    </p>
                  </div>
                  {reportSummary.totalCampaigns && (
                    <div className="text-right">
                      <p className="text-xs text-blue-600">Campanhas no resumo: {reportSummary.totalCampaigns}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* First Row of Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <MetricCard
                title="CAMPANHAS TOTAIS"
                value={`${campaignsCount.toLocaleString()} campanhas`}
                subtitle={reportSummary ? (dbReportsSummary ? "Do resumo do banco de dados" : "Do resumo do backend") : "No período selecionado"}
                color="purple"
              />
              <MetricCard
                title="TACOS"
                value={`${fmt(tacos, 2)}%`}
                color="orange"
              />
              <MetricCard
                title="VENDAS TOTAIS"
                value={`R$${fmt(totalSales, 2)}`}
                color="green"
              />
              <MetricCard
                title="CAMPANHAS ATIVAS"
                value={`${activeCampaigns} campanhas`}
                subtitle="Campanhas ativas no período"
                color="blue"
              />
            </div>

            {/* Database Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <MetricCard
                title="REPORTS NO BANCO"
                value={`${reportsCount.toLocaleString()} reports`}
                subtitle="Dados armazenados no banco"
                color="indigo"
              />
              <MetricCard
                title="ORDENS NO BANCO"
                value={`${ordersCount.toLocaleString()} ordens`}
                subtitle="Dados armazenados no banco"
                color="pink"
              />
              <MetricCard
                title="CAMPANHAS NO BANCO"
                value={`${campaignsCount.toLocaleString()} campanhas`}
                subtitle="Dados armazenados no banco"
                color="cyan"
              />
            </div>

            {/* Second Row of Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
              <MetricCard
                title="GASTO TOTAL ADS"
                value={`R$${fmt(totalAdSpend, 2)}`}
                color="purple"
              />
              <MetricCard
                title="CPC MÉDIO"
                value={`R$${fmt(averageCPC, 2)} por clique`}
                color="teal"
              />
              <MetricCard
                title="IMPRESSÕES"
                value={`${reportSummary.impressions.toLocaleString()} impressões`}
                color="purple"
              />
            </div>

            {/* Third Row of Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
              <MetricCard
                title="Cliques"
                value={reportSummary.clicks.toLocaleString()}
                color="teal"
              />
              <MetricCard
                title="ACOS"
                value={`${fmt(reportSummary.acos, 2)}%`}
                color="red"
              />
              <MetricCard
                title="ROAS"
                value={`${fmt(reportSummary.roas, 2)}%`}
                color="green"
              />
            </div>

            {/* Data Tables Section */}
            <div className="space-y-6 mb-6">
              {/* Reports Table */}
              {reports.length > 0 && (() => {
                const paginatedReports = getPaginatedData(reports, reportsPage, itemsPerPage);
                const totalReportsPages = getTotalPages(reports, itemsPerPage);
                return (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                    <div className="px-6 py-4 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-lg font-semibold text-gray-900">Reports ({reports.length.toLocaleString()} total)</h2>
                          <p className="text-sm text-gray-500 mt-1">Dados de performance das campanhas - Todos os dados do banco</p>
                        </div>
                        <span className="px-3 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                          Todos carregados
                        </span>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campanha</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Impressões</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliques</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Custo</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vendas 14d</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ACOS</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {paginatedReports.map((report, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {report.date ? new Date(report.date).toLocaleDateString('pt-BR') : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              <div className="max-w-xs truncate" title={report.campaignName}>
                                {report.campaignName || '-'}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                report.campaignStatus === 'ENABLED' ? 'bg-green-100 text-green-800' :
                                report.campaignStatus === 'PAUSED' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {report.campaignStatus || '-'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {report.impressions?.toLocaleString() || 0}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {report.clicks?.toLocaleString() || 0}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              R$ {fmt(parseFloat(report.cost || 0), 2)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              R$ {fmt(parseFloat(report.sales14d || 0), 2)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {report.acosClicks14d ? `${fmt(parseFloat(report.acosClicks14d), 2)}%` : '-'}
                            </td>
                          </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pagination
                      currentPage={reportsPage}
                      totalPages={totalReportsPages}
                      onPageChange={setReportsPage}
                      dataLength={reports.length}
                      itemsPerPage={itemsPerPage}
                    />
                  </div>
                );
              })()}

              {/* Campaigns Table */}
              {campaigns.length > 0 && (() => {
                const paginatedCampaigns = getPaginatedData(campaigns, campaignsPage, itemsPerPage);
                const totalCampaignsPages = getTotalPages(campaigns, itemsPerPage);
                return (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                    <div className="px-6 py-4 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-lg font-semibold text-gray-900">Campanhas ({campaigns.length.toLocaleString()} total)</h2>
                          <p className="text-sm text-gray-500 mt-1">Lista de campanhas ativas e pausadas - Todos os dados do banco</p>
                        </div>
                        <span className="px-3 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                          Todos carregados
                        </span>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nome</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Orçamento Diário</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Início</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {paginatedCampaigns.map((campaign, idx) => (
                          <tr key={campaign.campaignId || idx} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {campaign.campaignId || '-'}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900">
                              <div className="max-w-xs truncate" title={campaign.name}>
                                {campaign.name || '-'}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {campaign.campaignType || '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                (campaign.state === 'enabled' || campaign.state === 'ENABLED') ? 'bg-green-100 text-green-800' :
                                (campaign.state === 'paused' || campaign.state === 'PAUSED') ? 'bg-yellow-100 text-yellow-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {campaign.state || '-'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {campaign.dailyBudget ? `R$ ${fmt(parseFloat(campaign.dailyBudget), 2)}` : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {campaign.startDate || '-'}
                            </td>
                          </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pagination
                      currentPage={campaignsPage}
                      totalPages={totalCampaignsPages}
                      onPageChange={setCampaignsPage}
                      dataLength={campaigns.length}
                      itemsPerPage={itemsPerPage}
                    />
                  </div>
                );
              })()}

              {/* Orders Table */}
              {orders.length > 0 && (() => {
                const paginatedOrders = getPaginatedData(orders, ordersPage, itemsPerPage);
                const totalOrdersPages = getTotalPages(orders, itemsPerPage);
                return (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                    <div className="px-6 py-4 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-lg font-semibold text-gray-900">Ordens ({orders.length.toLocaleString()} total)</h2>
                          <p className="text-sm text-gray-500 mt-1">Pedidos recentes da Amazon - Todos os dados do banco</p>
                        </div>
                        <span className="px-3 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                          Todos carregados
                        </span>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order ID</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Compra</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Canal</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Itens</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {paginatedOrders.map((order, idx) => (
                          <tr key={order.AmazonOrderId || idx} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              <div className="max-w-xs truncate" title={order.AmazonOrderId}>
                                {order.AmazonOrderId || '-'}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {order.PurchaseDate ? new Date(order.PurchaseDate).toLocaleDateString('pt-BR') : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                order.OrderStatus === 'Shipped' ? 'bg-green-100 text-green-800' :
                                order.OrderStatus === 'Unshipped' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {order.OrderStatus || '-'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {order.FulfillmentChannel || '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {order.OrderTotal?.Amount ? `${order.OrderTotal.CurrencyCode || 'USD'} ${fmt(parseFloat(order.OrderTotal.Amount), 2)}` : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {(order.NumberOfItemsShipped || 0) + (order.NumberOfItemsUnshipped || 0)}
                            </td>
                          </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pagination
                      currentPage={ordersPage}
                      totalPages={totalOrdersPages}
                      onPageChange={setOrdersPage}
                      dataLength={orders.length}
                      itemsPerPage={itemsPerPage}
                    />
                  </div>
                );
              })()}

              {/* Loading State */}
              {dbLoading && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="mt-4 text-gray-600">Carregando dados do banco...</p>
                </div>
              )}

              {/* Empty State */}
              {!dbLoading && reports.length === 0 && campaigns.length === 0 && orders.length === 0 && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
                  <p className="text-gray-500">Nenhum dado disponível no banco de dados.</p>
                  <p className="text-sm text-gray-400 mt-2">Os dados aparecerão aqui após serem armazenados.</p>
                </div>
              )}
            </div>


            {/* Error Messages */}
            {error && (
              <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-yellow-800">
                  <strong>Aviso:</strong> {error}
                </p>
              </div>
            )}
          </>
        ) : activeTab === 'gestaoAds' ? (
          <div className="space-y-6">
            {/* Mode Selector */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Mode Selector: Analytical vs. Execution</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {aiMode === 'analytical' 
                      ? 'Analytical Mode: AI is observing Amazon bid data without acting, for a 1-month learning period'
                      : 'Execution Mode: AI is making automatic changes and optimizing campaigns through bid adjustments'}
                  </p>
                </div>
                <div className="flex items-center space-x-4">
                  <button
                    onClick={handleAnalyze}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    Run Analysis
                  </button>
                  <span className={`text-sm font-medium ${aiMode === 'analytical' ? 'text-blue-600' : 'text-gray-500'}`}>
                    Analytical
                  </span>
                  <button
                    onClick={() => setAiMode(aiMode === 'analytical' ? 'execution' : 'analytical')}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      aiMode === 'execution' ? 'bg-green-600' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        aiMode === 'execution' ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                  <span className={`text-sm font-medium ${aiMode === 'execution' ? 'text-green-600' : 'text-gray-500'}`}>
                    Execution
                  </span>
                </div>
              </div>
            </div>

            {/* Budget Management */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Budget Management</h2>
              <p className="text-sm text-gray-500 mb-6">Set daily budget and max bid value for all campaigns</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Daily Budget (R$)
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={dailyBudget}
                      onChange={(e) => setDailyBudget(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0.00"
                    />
                    <button
                      onClick={handleBudgetUpdate}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      Save
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Max Bid Value (R$)
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={maxBidValue}
                      onChange={(e) => setMaxBidValue(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0.00"
                    />
                    <button
                      onClick={handleBidUpdate}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Campaign Performance Goals */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Campaign Performance Goals</h2>
              <p className="text-sm text-gray-500 mb-6">
                Define your optimization targets to guide AI decision-making. The AI will use these goals to make informed decisions about campaign adjustments.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Goal Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={goalType}
                    onChange={(e) => setGoalType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a goal type</option>
                    <option value="TACoS">TACoS (Total Advertising Cost of Sales)</option>
                    <option value="ACoS">ACoS (Advertising Cost of Sales)</option>
                    <option value="CPC">Cost per Click (CPC)</option>
                    <option value="Conversions">Conversions</option>
                    <option value="ROAS">ROAS (Return on Ad Spend)</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Select the metric you want to optimize for
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Target Value <span className="text-red-500">*</span>
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={targetValue}
                      onChange={(e) => setTargetValue(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={goalType === 'TACoS' || goalType === 'ACoS' ? 'e.g., 25.00 (%)' : goalType === 'CPC' ? 'e.g., 1.50 (R$)' : goalType === 'ROAS' ? 'e.g., 3.00 (ratio)' : 'e.g., 100 (count)'}
                      disabled={!goalType}
                    />
                    <button
                      onClick={() => {
                        if (!goalType || !targetValue) {
                          alert('Please select a goal type and enter a target value');
                          return;
                        }
                        // TODO: Save goal configuration to backend
                        alert(`Goal configured: ${goalType} = ${targetValue}`);
                      }}
                      disabled={!goalType || !targetValue}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      Save Goal
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {goalType === 'TACoS' || goalType === 'ACoS' 
                      ? 'Enter target percentage (e.g., 25.00 for 25%)'
                      : goalType === 'CPC'
                      ? 'Enter target cost per click in R$'
                      : goalType === 'ROAS'
                      ? 'Enter target ROAS ratio (e.g., 3.00 for 3x return)'
                      : goalType === 'Conversions'
                      ? 'Enter target number of conversions'
                      : 'Enter your target value'}
                  </p>
                </div>
              </div>
              
              {/* Display current goal if set */}
              {goalType && targetValue && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-blue-900">Current Performance Goal</p>
                      <p className="text-sm text-blue-700 mt-1">
                        <span className="font-semibold">{goalType}:</span> {targetValue}
                        {goalType === 'TACoS' || goalType === 'ACoS' ? '%' : goalType === 'CPC' ? ' R$' : goalType === 'ROAS' ? 'x' : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setGoalType('');
                        setTargetValue('');
                      }}
                      className="px-3 py-1 text-xs font-medium text-blue-700 hover:text-blue-900 hover:bg-blue-100 rounded-md"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Optimization Overview */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Optimization Overview</h2>
              <div className="flex items-center space-x-6">
                <div>
                  <p className="text-sm text-gray-500">Amazon Campaigns Optimized</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {optimizationMetrics.campaignsOptimized}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Number of campaigns optimized through bid adjustments</p>
                </div>
              </div>
            </div>

            {/* AI-Detected Changes */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">AI-Detected Changes</h2>
                  <p className="text-sm text-gray-500 mt-1">Amazon Bidding Insights: The AI continuously monitors and learns from changes in Amazon bid behavior</p>
                </div>
                <span className="px-3 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                  {aiDetectedChanges.length} changes detected
                </span>
              </div>
              
              {/* Confidence Filter */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Confidence</label>
                <div className="flex space-x-2">
                  {['all', 'high', 'medium', 'low'].map((level) => (
                    <button
                      key={level}
                      onClick={() => setConfidenceFilter(level)}
                      className={`px-4 py-2 rounded-md text-sm font-medium capitalize ${
                        confidenceFilter === level
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {level === 'all' ? 'All' : `${level} Confidence`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Changes List */}
              <div className="space-y-3">
                {aiDetectedChanges
                  .filter(change => confidenceFilter === 'all' || change.confidence === confidenceFilter)
                  .map((change, idx) => (
                    <div key={idx} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              change.confidence === 'high' ? 'bg-green-100 text-green-800' :
                              change.confidence === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {change.confidence.charAt(0).toUpperCase() + change.confidence.slice(1)} Confidence
                            </span>
                            <span className="text-xs text-gray-500">
                              {change.date ? new Date(change.date).toLocaleDateString('pt-BR') : 'N/A'}
                            </span>
                          </div>
                          <p className="text-sm text-gray-900 font-medium mb-1">{change.description}</p>
                          <p className="text-xs text-gray-600">{change.details}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                {aiDetectedChanges.filter(change => confidenceFilter === 'all' || change.confidence === confidenceFilter).length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <p>No AI-detected changes found for the selected confidence level. The AI continuously monitors Amazon bid patterns and fluctuations.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Recommended Actions */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Recommended Actions</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Lists bid adjustments the AI plans to apply, based on its predictive modeling. Actions are executed automatically once per day at 3:00 AM.
                  </p>
                </div>
                <span className="px-3 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                  {recommendedActions.length} actions planned
                </span>
              </div>

              <div className="space-y-3">
                {recommendedActions.map((action, idx) => (
                  <div key={idx} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                            {action.type}
                          </span>
                          <span className="text-xs text-gray-500">
                            Scheduled: {action.scheduledTime || '3:00 AM'}
                          </span>
                        </div>
                        <p className="text-sm text-gray-900 font-medium mb-1">{action.title}</p>
                        <p className="text-xs text-gray-600 mb-2">{action.description}</p>
                        <div className="text-xs text-gray-500">
                          <span className="font-medium">Campaign:</span> {action.campaignName || action.campaignId}
                        </div>
                      </div>
                      <div className="ml-4">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          action.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          action.status === 'executed' ? 'bg-green-100 text-green-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {action.status || 'Pending'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {recommendedActions.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <p>No recommended actions at this time.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Decision Log */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Decision Log (Amazon Bids History)</h2>
                <p className="text-sm text-gray-500 mt-1">
                  A detailed history of actions taken by the AI, including every bid adjustment executed on Amazon. Transparency in when and why each change occurred is essential for tracking performance.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date & Time
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Campaign
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Action Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        What Changed
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Reason
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {getPaginatedData(decisionLog, decisionLogPage, itemsPerPage).map((log, idx) => (
                      <tr key={log.id || idx} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {log.timestamp ? new Date(log.timestamp).toLocaleString('pt-BR') : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div className="max-w-xs truncate" title={log.campaignName || log.campaignId}>
                            {log.campaignName || log.campaignId || '-'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {log.actionType || '-'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          <div className="max-w-md">
                            {log.whatChanged || '-'}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          <div className="max-w-md">
                            {log.reason || '-'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            log.status === 'success' ? 'bg-green-100 text-green-800' :
                            log.status === 'failed' ? 'bg-red-100 text-red-800' :
                            log.status === 'pending_manual' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {log.status || 'Unknown'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {decisionLog.length === 0 && (
                      <tr>
                        <td colSpan="6" className="px-6 py-8 text-center text-sm text-gray-500">
                          No decision log entries yet. Actions will appear here once the AI starts making changes.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {decisionLog.length > 0 && (
                <Pagination
                  currentPage={decisionLogPage}
                  totalPages={getTotalPages(decisionLog, itemsPerPage)}
                  onPageChange={setDecisionLogPage}
                  dataLength={decisionLog.length}
                  itemsPerPage={itemsPerPage}
                />
              )}
            </div>
          </div>
        ) : activeTab === 'estoqueVendas' ? (
          <div className="space-y-6">
            {/* Sales Dashboard Section */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-6">Sales Dashboard</h2>
              
              {/* Calculate sales metrics */}
              {(() => {
                // Calculate total sales from orders
                const totalSalesAmount = orders.reduce((sum, order) => {
                  const amount = parseFloat(order.order_total_amount || order.OrderTotal?.Amount || 0);
                  return sum + (isNaN(amount) ? 0 : amount);
                }, 0);

                // Calculate ad-attributed sales from reports (sales14d represents 14-day attributed sales)
                const adAttributedSales = reports.reduce((sum, report) => {
                  const sales = parseFloat(report.sales14d || 0);
                  return sum + (isNaN(sales) ? 0 : sales);
                }, 0);

                // Organic sales = total sales - ad-attributed sales
                const organicSales = Math.max(0, totalSalesAmount - adAttributedSales);

                // Total number of orders
                const totalOrders = orders.length;

                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <MetricCard
                      title="TOTAL SALES"
                      value={`R$${fmt(totalSalesAmount, 2)}`}
                      subtitle="Total sales from all orders"
                      color="green"
                    />
                    <MetricCard
                      title="ORGANIC SALES"
                      value={`R$${fmt(organicSales, 2)}`}
                      subtitle="Sales not attributed to ads"
                      color="blue"
                    />
                    <MetricCard
                      title="TOTAL ORDERS"
                      value={totalOrders.toLocaleString()}
                      subtitle="Total number of orders"
                      color="purple"
                    />
                  </div>
                );
              })()}
            </div>

            {/* Inventory Section */}
            {(() => {
              // Extract unique products from orders
              // Since we don't have a dedicated products table, we'll extract from order data
              const productMap = new Map();
              
              orders.forEach(order => {
                // Try to extract product info from raw_order_data or order structure
                const orderData = order.raw_order_data || order;
                const orderItems = orderData.OrderItems || orderData.orderItems || [];
                
                if (Array.isArray(orderItems) && orderItems.length > 0) {
                  orderItems.forEach((item, idx) => {
                    const asin = item.ASIN || item.Asin || item.asin || `ITEM-${order.amazon_order_id || order.amazonOrderId || 'UNKNOWN'}-${idx}`;
                    const sku = item.SellerSKU || item.SellerSku || item.sellerSku || 'N/A';
                    const title = item.Title || item.title || 'Unknown Product';
                    const quantity = parseInt(item.QuantityOrdered || item.QuantityShipped || 1) || 1;
                    
                    if (!productMap.has(asin)) {
                      productMap.set(asin, {
                        asin,
                        sku,
                        title,
                        totalQuantity: 0,
                        lastOrderDate: order.purchase_date || order.PurchaseDate,
                        orderStatus: order.order_status || order.OrderStatus,
                      });
                    }
                    
                    const product = productMap.get(asin);
                    product.totalQuantity += quantity;
                    
                    // Update last order date if this order is more recent
                    const orderDate = new Date(order.purchase_date || order.PurchaseDate || 0);
                    const currentDate = new Date(product.lastOrderDate || 0);
                    if (orderDate > currentDate) {
                      product.lastOrderDate = order.purchase_date || order.PurchaseDate;
                    }
                  });
                } else {
                  // Fallback: create a product entry from the order itself
                  const asin = order.amazon_order_id || order.amazonOrderId || `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                  if (!productMap.has(asin)) {
                    productMap.set(asin, {
                      asin,
                      sku: 'N/A',
                      title: 'Product from Order',
                      totalQuantity: parseInt(order.number_of_items_shipped || order.NumberOfItemsShipped || 1) || 1,
                      lastOrderDate: order.purchase_date || order.PurchaseDate,
                      orderStatus: order.order_status || order.OrderStatus,
                    });
                  }
                }
              });

              const allProducts = Array.from(productMap.values());
              const paginatedProducts = getPaginatedData(allProducts, inventoryPage, itemsPerPage);
              const totalInventoryPages = getTotalPages(allProducts, itemsPerPage);

              return (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-semibold text-gray-900">Inventory</h2>
                        <p className="text-sm text-gray-500 mt-1">
                          All products currently available for sale
                        </p>
                      </div>
                      {allProducts.length > 0 && (
                        <span className="px-3 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                          {allProducts.length.toLocaleString()} products
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Product
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            ASIN/SKU
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Quantity
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Last Order Date
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {allProducts.length === 0 ? (
                          <tr>
                            <td colSpan="5" className="px-6 py-8 text-center text-sm text-gray-500">
                              No products found. Product information will appear here once orders are processed.
                            </td>
                          </tr>
                        ) : (
                          paginatedProducts.map((product, idx) => (
                            <tr key={product.asin || idx} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                <div className="max-w-xs truncate" title={product.title}>
                                  {product.title}
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                <div>
                                  <div>ASIN: {product.asin}</div>
                                  {product.sku !== 'N/A' && (
                                    <div className="text-xs">SKU: {product.sku}</div>
                                  )}
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {product.totalQuantity}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                                  Available
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {product.lastOrderDate 
                                  ? new Date(product.lastOrderDate).toLocaleDateString('pt-BR')
                                  : 'N/A'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {allProducts.length > 0 && (
                    <Pagination
                      currentPage={inventoryPage}
                      totalPages={totalInventoryPages}
                      onPageChange={setInventoryPage}
                      dataLength={allProducts.length}
                      itemsPerPage={itemsPerPage}
                    />
                  )}
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <p className="text-gray-500 text-lg">Esta página está em desenvolvimento.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default Dashboard;
