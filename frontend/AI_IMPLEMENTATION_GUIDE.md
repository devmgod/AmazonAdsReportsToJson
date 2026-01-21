# AI Module Frontend Implementation Guide

This guide explains how to integrate the enhanced AI features into your frontend application.

## Overview

The AI module now includes:
- **User Goals Management** - Set optimization targets (ACOS, TACOS, CPC, ROAS)
- **ASIN Similarity Matching** - Find similar ASINs (≥85%) and reuse keywords
- **Keyword Management** - Promote converting terms, add negative keywords
- **Day Parting** - Time-based bid adjustments
- **Confidence Scoring** - Auto-execution for high-confidence actions (≥85%)
- **Learning System** - Tracks decision outcomes

## API Functions Available

All new API functions are in `src/services/api.js`:

### User Goals
```javascript
import { setUserGoal, getUserGoals } from '../services/api';

// Set user goals
await setUserGoal({
  goalType: 'ROAS', // 'TACoS', 'ACoS', 'CPC', 'Conversions', 'ROAS'
  targetValue: 3.0,
  dailyBudget: 100.00,
  maxBid: 2.50,
  editFrequencyHours: 24
});

// Get active goals
const goals = await getUserGoals();
```

### ASIN Management
```javascript
import { addASIN, findSimilarASINs, createCampaignForASIN } from '../services/api';

// Add new ASIN
const result = await addASIN({
  asin: 'B08XYZ123',
  title: 'Product Title',
  category: 'Electronics',
  brand: 'Brand Name',
  features: ['Feature 1', 'Feature 2'],
  keywords: ['keyword1', 'keyword2']
});
// Returns: { asin, similarASINs[], keywordSuggestions[] }

// Find similar ASINs
const similar = await findSimilarASINs('B08XYZ123', 0.85);

// Create campaign for ASIN
await createCampaignForASIN({
  asin: 'B08XYZ123',
  campaignName: 'Campaign Name',
  dailyBudget: 50.00,
  keywords: ['keyword1', 'keyword2']
});
```

### Keyword Management
```javascript
import { promoteKeywords, addNegativeKeywords, getConvertingTerms } from '../services/api';

// Promote converting search terms
await promoteKeywords({
  campaignId: 123456,
  searchTerms: [
    { text: 'keyword1', bid: 1.50, roas: 3.5, conversions: 5 },
    { text: 'keyword2', bid: 2.00, roas: 4.2, conversions: 8 }
  ]
});

// Add negative keywords
await addNegativeKeywords({
  campaignId: 123456,
  keywords: ['poor keyword1', 'poor keyword2']
});

// Get converting terms from auto campaigns
const terms = await getConvertingTerms(123456, {
  minConversions: 2,
  minRoas: 2.0
});
```

### Day Parting
```javascript
import { getDayPartingPatterns } from '../services/api';

// Get day parting patterns for a campaign
const patterns = await getDayPartingPatterns(123456);
// Returns: { campaignId, patterns[], count }
```

## UI Components to Add

### 1. User Goals Form Component

Add this to your GestãoAds tab:

```jsx
// In Dashboard.jsx, add state:
const [userGoals, setUserGoals] = useState(null);
const [goalForm, setGoalForm] = useState({
  goalType: 'ROAS',
  targetValue: '',
  dailyBudget: '',
  maxBid: '',
  editFrequencyHours: 24
});

// Add handler:
const handleSetGoal = async () => {
  try {
    const result = await setUserGoal(goalForm);
    setUserGoals(result.goal);
    alert('Goal set successfully!');
    await fetchAIData();
  } catch (error) {
    alert('Error: ' + (error.response?.data?.error || error.message));
  }
};

// Add UI component:
<div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
  <h3 className="text-lg font-semibold text-gray-900 mb-4">AI Optimization Goals</h3>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Goal Type</label>
      <select
        value={goalForm.goalType}
        onChange={(e) => setGoalForm({...goalForm, goalType: e.target.value})}
        className="w-full px-3 py-2 border border-gray-300 rounded-md"
      >
        <option value="ROAS">ROAS</option>
        <option value="ACoS">ACoS</option>
        <option value="TACoS">TACoS</option>
        <option value="CPC">CPC</option>
        <option value="Conversions">Conversions</option>
      </select>
    </div>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Target Value</label>
      <input
        type="number"
        step="0.01"
        value={goalForm.targetValue}
        onChange={(e) => setGoalForm({...goalForm, targetValue: e.target.value})}
        className="w-full px-3 py-2 border border-gray-300 rounded-md"
      />
    </div>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Daily Budget (R$)</label>
      <input
        type="number"
        step="0.01"
        value={goalForm.dailyBudget}
        onChange={(e) => setGoalForm({...goalForm, dailyBudget: e.target.value})}
        className="w-full px-3 py-2 border border-gray-300 rounded-md"
      />
    </div>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Max Bid (R$)</label>
      <input
        type="number"
        step="0.01"
        value={goalForm.maxBid}
        onChange={(e) => setGoalForm({...goalForm, maxBid: e.target.value})}
        className="w-full px-3 py-2 border border-gray-300 rounded-md"
      />
    </div>
  </div>
  <button
    onClick={handleSetGoal}
    className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
  >
    Set Goal
  </button>
  {userGoals && (
    <div className="mt-4 p-3 bg-green-50 rounded-md">
      <p className="text-sm text-green-800">
        Active Goal: {userGoals.goal_type} = {userGoals.target_value}
      </p>
    </div>
  )}
</div>
```

### 2. ASIN Management Component

```jsx
// Add state:
const [newASIN, setNewASIN] = useState({
  asin: '',
  title: '',
  category: '',
  brand: '',
  features: '',
  keywords: ''
});
const [similarASINs, setSimilarASINs] = useState([]);
const [keywordSuggestions, setKeywordSuggestions] = useState([]);

// Add handler:
const handleAddASIN = async () => {
  try {
    const result = await addASIN({
      ...newASIN,
      features: newASIN.features.split(',').map(f => f.trim()),
      keywords: newASIN.keywords.split(',').map(k => k.trim())
    });
    setSimilarASINs(result.similarASINs || []);
    setKeywordSuggestions(result.keywordSuggestions || []);
    alert(`ASIN added! Found ${result.similarASINs?.length || 0} similar ASINs`);
  } catch (error) {
    alert('Error: ' + (error.response?.data?.error || error.message));
  }
};

// Add UI:
<div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
  <h3 className="text-lg font-semibold text-gray-900 mb-4">Add New ASIN</h3>
  <div className="space-y-4">
    <input
      type="text"
      placeholder="ASIN"
      value={newASIN.asin}
      onChange={(e) => setNewASIN({...newASIN, asin: e.target.value})}
      className="w-full px-3 py-2 border border-gray-300 rounded-md"
    />
    <input
      type="text"
      placeholder="Product Title"
      value={newASIN.title}
      onChange={(e) => setNewASIN({...newASIN, title: e.target.value})}
      className="w-full px-3 py-2 border border-gray-300 rounded-md"
    />
    <button
      onClick={handleAddASIN}
      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
    >
      Add ASIN & Find Similar
    </button>
    
    {similarASINs.length > 0 && (
      <div className="mt-4">
        <h4 className="font-medium mb-2">Similar ASINs (≥85% similarity):</h4>
        <ul className="list-disc list-inside space-y-1">
          {similarASINs.map((asin, idx) => (
            <li key={idx} className="text-sm">
              {asin.asin} - {asin.title} ({(asin.similarity * 100).toFixed(1)}% similar)
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
</div>
```

### 3. Keyword Promotion Component

```jsx
// Add state:
const [selectedCampaign, setSelectedCampaign] = useState('');
const [convertingTerms, setConvertingTerms] = useState([]);

// Add handler:
const handleGetConvertingTerms = async () => {
  if (!selectedCampaign) return;
  try {
    const result = await getConvertingTerms(selectedCampaign, {
      minConversions: 2,
      minRoas: 2.0
    });
    setConvertingTerms(result.convertingTerms || []);
  } catch (error) {
    alert('Error: ' + (error.response?.data?.error || error.message));
  }
};

const handlePromoteKeywords = async () => {
  const termsToPromote = convertingTerms.filter(t => t.selected);
  if (termsToPromote.length === 0) {
    alert('Please select keywords to promote');
    return;
  }
  
  try {
    await promoteKeywords({
      campaignId: selectedCampaign,
      searchTerms: termsToPromote.map(t => ({
        text: t.keywordText,
        bid: t.recommendedBid,
        roas: t.roas,
        conversions: t.conversions
      }))
    });
    alert(`Promoted ${termsToPromote.length} keywords!`);
    await handleGetConvertingTerms();
  } catch (error) {
    alert('Error: ' + (error.response?.data?.error || error.message));
  }
};

// Add UI:
<div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
  <h3 className="text-lg font-semibold text-gray-900 mb-4">Promote Converting Keywords</h3>
  <div className="mb-4">
    <select
      value={selectedCampaign}
      onChange={(e) => setSelectedCampaign(e.target.value)}
      className="w-full px-3 py-2 border border-gray-300 rounded-md"
    >
      <option value="">Select Campaign</option>
      {dbCampaigns.map(c => (
        <option key={c.campaignId} value={c.campaignId}>{c.name}</option>
      ))}
    </select>
    <button
      onClick={handleGetConvertingTerms}
      className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
    >
      Get Converting Terms
    </button>
  </div>
  
  {convertingTerms.length > 0 && (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium">Found {convertingTerms.length} converting terms</span>
        <button
          onClick={handlePromoteKeywords}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
        >
          Promote Selected
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {convertingTerms.map((term, idx) => (
          <label key={idx} className="flex items-center p-2 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={term.selected}
              onChange={(e) => {
                const updated = [...convertingTerms];
                updated[idx].selected = e.target.checked;
                setConvertingTerms(updated);
              }}
              className="mr-2"
            />
            <span className="flex-1 text-sm">{term.keywordText}</span>
            <span className="text-sm text-gray-500">ROAS: {term.roas?.toFixed(2)}x</span>
            <span className="text-sm text-gray-500 ml-2">Conv: {term.conversions}</span>
          </label>
        ))}
      </div>
    </div>
  )}
</div>
```

### 4. Enhanced Confidence Display

Update your recommended actions display to show confidence percentage:

```jsx
{recommendedActions.map((action, idx) => (
  <div key={idx} className="p-4 border border-gray-200 rounded-lg">
    <div className="flex justify-between items-start">
      <div>
        <h4 className="font-medium">{action.title}</h4>
        <p className="text-sm text-gray-600">{action.description}</p>
      </div>
      <div className="text-right">
        {action.confidencePercent !== undefined && (
          <div className={`px-2 py-1 rounded text-xs font-medium ${
            action.confidencePercent >= 85 
              ? 'bg-green-100 text-green-800' 
              : action.confidencePercent >= 70
              ? 'bg-yellow-100 text-yellow-800'
              : 'bg-gray-100 text-gray-800'
          }`}>
            {action.confidencePercent}% confidence
            {action.confidencePercent >= 85 && ' (Auto-execute)'}
          </div>
        )}
        <span className={`text-xs px-2 py-1 rounded ${
          action.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
          action.status === 'executed' ? 'bg-green-100 text-green-800' :
          'bg-gray-100 text-gray-800'
        }`}>
          {action.status}
        </span>
      </div>
    </div>
  </div>
))}
```

### 5. Day Parting Visualization

```jsx
// Add state:
const [dayPartingData, setDayPartingData] = useState(null);

// Add handler:
const handleGetDayParting = async (campaignId) => {
  try {
    const result = await getDayPartingPatterns(campaignId);
    setDayPartingData(result);
  } catch (error) {
    alert('Error: ' + (error.response?.data?.error || error.message));
  }
};

// Add UI (simplified heatmap):
<div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
  <h3 className="text-lg font-semibold text-gray-900 mb-4">Day Parting Patterns</h3>
  {dayPartingData && (
    <div className="grid grid-cols-24 gap-1">
      {Array.from({length: 7}, (_, day) => (
        Array.from({length: 24}, (_, hour) => {
          const pattern = dayPartingData.patterns.find(
            p => p.day_of_week === day && p.hour_of_day === hour
          );
          return (
            <div
              key={`${day}-${hour}`}
              className={`h-8 rounded ${
                pattern?.bid_adjustment_percent > 0
                  ? 'bg-green-500'
                  : pattern?.bid_adjustment_percent < 0
                  ? 'bg-red-500'
                  : 'bg-gray-200'
              }`}
              title={`${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]} ${hour}:00 - ${pattern?.bid_adjustment_percent || 0}%`}
            />
          );
        })
      ))}
    </div>
  )}
</div>
```

## Integration Steps

1. **Import new API functions** in Dashboard.jsx:
```javascript
import {
  setUserGoal,
  getUserGoals,
  addASIN,
  findSimilarASINs,
  createCampaignForASIN,
  promoteKeywords,
  addNegativeKeywords,
  getConvertingTerms,
  getDayPartingPatterns
} from '../services/api';
```

2. **Add state variables** for new features (see examples above)

3. **Add UI components** to the GestãoAds tab section

4. **Update fetchAIData** to also fetch user goals:
```javascript
const fetchAIData = async () => {
  // ... existing code ...
  
  // Fetch user goals
  try {
    const goalsResponse = await getUserGoals();
    setUserGoals(goalsResponse.goals?.[0] || null);
  } catch (error) {
    console.error('Error fetching user goals:', error);
  }
};
```

5. **Update analyzeCampaigns** to pass user goals:
```javascript
const handleAnalyze = async () => {
  try {
    const result = await analyzeCampaigns(aiMode);
    // ... handle result ...
  } catch (error) {
    // ... handle error ...
  }
};
```

## Best Practices

1. **Confidence Threshold**: Always show confidence percentage and indicate when actions will auto-execute (≥85%)

2. **User Feedback**: Show success/error messages for all AI actions

3. **Loading States**: Add loading indicators for async operations

4. **Data Refresh**: Refresh AI data after making changes (promote keywords, add ASINs, etc.)

5. **Error Handling**: Wrap all API calls in try-catch blocks

6. **Validation**: Validate user input before making API calls

## Example Complete Flow

```javascript
// 1. User sets goals
await setUserGoal({ goalType: 'ROAS', targetValue: 3.0, dailyBudget: 100, maxBid: 2.5 });

// 2. User adds new ASIN
const asinResult = await addASIN({ asin: 'B08XYZ', title: 'Product', ... });
// System finds similar ASINs and suggests keywords

// 3. User creates campaign for ASIN (or AI does it automatically)
await createCampaignForASIN({ asin: 'B08XYZ', campaignName: 'New Campaign', ... });

// 4. AI analyzes and finds converting terms
const terms = await getConvertingTerms(campaignId);

// 5. User promotes converting terms
await promoteKeywords({ campaignId, searchTerms: terms });

// 6. AI continues learning and optimizing based on outcomes
```

This completes the integration of all new AI features into your frontend!

