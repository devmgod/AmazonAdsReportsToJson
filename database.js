import pkg from "pg";
import dotenv from "dotenv";

const { Pool } = pkg;

// Load environment variables
dotenv.config();

// PostgreSQL connection configuration
// Use DATABASE_URL if available, otherwise fall back to individual connection parameters
const dbConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
    }
  : {
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432"),
      database: process.env.DB_NAME || "amazon_ads_api",
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "postgres",
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
    };

// Create PostgreSQL connection pool
const pool = new Pool(dbConfig);

// Handle pool errors
pool.on("error", (err, client) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
  process.exit(-1);
});

/**
 * Test database connection
 * @returns {Promise<boolean>} True if connection successful, false otherwise
 */
export async function testDatabaseConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query("SELECT NOW()");
    const dbInfo = getDatabaseInfo();
    console.log("✓ PostgreSQL connection successful");
    console.log(`  Database: ${dbInfo.database}`);
    console.log(`  Host: ${dbInfo.host}`);
    console.log(`  Server time: ${result.rows[0].now}`);
    client.release();
    return true;
  } catch (error) {
    console.error("✗ PostgreSQL connection failed:", error.message);
    return false;
  }
}

/**
 * Get database connection info
 * @returns {Object} Database configuration info
 */
export function getDatabaseInfo() {
  if (process.env.DATABASE_URL) {
    // Parse DATABASE_URL to extract database and host info
    try {
      const url = new URL(process.env.DATABASE_URL);
      return {
        database: url.pathname.slice(1) || 'unknown', // Remove leading slash
        host: `${url.hostname}:${url.port || '5432'}`,
      };
    } catch (error) {
      return {
        database: 'unknown',
        host: 'unknown',
      };
    }
  }
  return {
    database: dbConfig.database,
    host: `${dbConfig.host}:${dbConfig.port}`,
  };
}

/**
 * Initialize campaigns table if it doesn't exist
 * @returns {Promise<boolean>} True if initialization successful, false otherwise
 */
export async function initializeCampaignsTable() {
  try {
    const client = await pool.connect();
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS campaigns (
        campaign_id BIGINT PRIMARY KEY,
        name VARCHAR(500),
        campaign_type VARCHAR(100),
        targeting_type VARCHAR(100),
        premium_bid_adjustment BOOLEAN,
        daily_budget NUMERIC(10, 2),
        start_date VARCHAR(20),
        state VARCHAR(50),
        bidding JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_campaigns_state ON campaigns(state);
      CREATE INDEX IF NOT EXISTS idx_campaigns_campaign_type ON campaigns(campaign_type);
      CREATE INDEX IF NOT EXISTS idx_campaigns_updated_at ON campaigns(updated_at);
    `;
    await client.query(createTableQuery);
    client.release();
    console.log("✓ Campaigns table initialized");
    return true;
  } catch (error) {
    console.error("✗ Failed to initialize campaigns table:", error.message);
    return false;
  }
}

/**
 * Store campaigns data in the database
 * Uses UPSERT (INSERT ... ON CONFLICT UPDATE) to handle duplicates
 * @param {Array} campaignsData - Array of campaign objects
 * @returns {Promise<Object>} Object with stored, updated, and total counts
 */
export async function storeCampaignsInDatabase(campaignsData) {
  if (!campaignsData || !Array.isArray(campaignsData) || campaignsData.length === 0) {
    console.log("No campaigns data to store");
    return { stored: 0, updated: 0 };
  }

  try {
    const client = await pool.connect();
    let stored = 0;
    let updated = 0;

    for (const campaign of campaignsData) {
      const upsertQuery = `
        INSERT INTO campaigns (
          campaign_id, name, campaign_type, targeting_type, 
          premium_bid_adjustment, daily_budget, start_date, 
          state, bidding, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
        ON CONFLICT (campaign_id) 
        DO UPDATE SET
          name = EXCLUDED.name,
          campaign_type = EXCLUDED.campaign_type,
          targeting_type = EXCLUDED.targeting_type,
          premium_bid_adjustment = EXCLUDED.premium_bid_adjustment,
          daily_budget = EXCLUDED.daily_budget,
          start_date = EXCLUDED.start_date,
          state = EXCLUDED.state,
          bidding = EXCLUDED.bidding,
          updated_at = CURRENT_TIMESTAMP
        RETURNING (xmax = 0) AS inserted;
      `;

      const result = await client.query(upsertQuery, [
        campaign.campaignId,
        campaign.name || null,
        campaign.campaignType || null,
        campaign.targetingType || null,
        campaign.premiumBidAdjustment || false,
        campaign.dailyBudget || null,
        campaign.startDate || null,
        campaign.state || null,
        JSON.stringify(campaign.bidding || null),
      ]);

      // Check if it was an insert (new) or update (existing)
      if (result.rows[0]?.inserted) {
        stored++;
      } else {
        updated++;
      }
    }

    client.release();
    console.log(`✓ Stored ${stored} new campaigns, updated ${updated} existing campaigns`);
    return { stored, updated, total: campaignsData.length };
  } catch (error) {
    console.error("✗ Failed to store campaigns in database:", error.message);
    throw error;
  }
}

/**
 * Get campaigns from the database with optional filters
 * @param {Object} filters - Filter options (state, campaignType, limit, offset)
 * @returns {Promise<Object>} Object with campaigns array and metadata
 */
export async function getCampaignsFromDatabase(filters = {}) {
  try {
    const client = await pool.connect();
    
    const state = filters.state;
    const campaignType = filters.campaignType;
    // Support 'all' or 0 to fetch all records, otherwise use limit or default to 100
    const limitParam = filters.limit;
    const limit = limitParam === 'all' || limitParam === '0' || limitParam === 0 
      ? null 
      : parseInt(limitParam || "100");
    const offset = parseInt(filters.offset || "0");
    
    let query = "SELECT * FROM campaigns WHERE 1=1";
    const params = [];
    let paramIndex = 1;
    
    if (state) {
      query += ` AND state = $${paramIndex}`;
      params.push(state);
      paramIndex++;
    }
    
    if (campaignType) {
      query += ` AND campaign_type = $${paramIndex}`;
      params.push(campaignType);
      paramIndex++;
    }
    
    query += ` ORDER BY updated_at DESC`;
    
    // Only add LIMIT and OFFSET if limit is specified
    if (limit !== null) {
      query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);
    } else if (offset > 0) {
      // If no limit but offset is specified, still add OFFSET
      query += ` OFFSET $${paramIndex}`;
      params.push(offset);
    }
    
    const result = await client.query(query, params);
    
    // Get total count for metadata (without limit/offset)
    let countQuery = "SELECT COUNT(*) as total FROM campaigns WHERE 1=1";
    const countParams = [];
    let countParamIndex = 1;
    
    if (state) {
      countQuery += ` AND state = $${countParamIndex}`;
      countParams.push(state);
      countParamIndex++;
    }
    
    if (campaignType) {
      countQuery += ` AND campaign_type = $${countParamIndex}`;
      countParams.push(campaignType);
      countParamIndex++;
    }
    
    const countResult = await client.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].total);
    
    // Transform database rows to match API response format
    const campaigns = result.rows.map(row => ({
      campaignId: row.campaign_id,
      name: row.name,
      campaignType: row.campaign_type,
      targetingType: row.targeting_type,
      premiumBidAdjustment: row.premium_bid_adjustment,
      dailyBudget: row.daily_budget ? parseFloat(row.daily_budget) : null,
      startDate: row.start_date,
      state: row.state,
      bidding: row.bidding,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
    
    client.release();
    
    return {
      campaigns,
      total: campaigns.length,
      totalCount,
      limit: limit || 'all',
      offset
    };
  } catch (error) {
    console.error("✗ Failed to get campaigns from database:", error.message);
    throw error;
  }
}

/**
 * Initialize orders table if it doesn't exist
 * @returns {Promise<boolean>} True if initialization successful, false otherwise
 */
export async function initializeOrdersTable() {
  try {
    const client = await pool.connect();
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS orders (
        amazon_order_id VARCHAR(50) PRIMARY KEY,
        seller_order_id VARCHAR(50),
        purchase_date TIMESTAMP,
        last_update_date TIMESTAMP,
        order_status VARCHAR(50),
        fulfillment_channel VARCHAR(50),
        sales_channel VARCHAR(100),
        order_channel VARCHAR(100),
        ship_service_level VARCHAR(100),
        order_total_amount NUMERIC(10, 2),
        order_total_currency_code VARCHAR(10),
        number_of_items_shipped INTEGER,
        number_of_items_unshipped INTEGER,
        payment_method VARCHAR(50),
        payment_method_details JSONB,
        marketplace_id VARCHAR(50),
        buyer_info JSONB,
        shipping_address JSONB,
        order_type VARCHAR(50),
        earliest_ship_date TIMESTAMP,
        latest_ship_date TIMESTAMP,
        earliest_delivery_date TIMESTAMP,
        latest_delivery_date TIMESTAMP,
        is_business_order BOOLEAN,
        is_prime BOOLEAN,
        is_global_express_enabled BOOLEAN,
        is_sold_by_ab BOOLEAN,
        is_iba BOOLEAN,
        replaced_order_id VARCHAR(50),
        is_replacement_order BOOLEAN,
        promise_response_due_date TIMESTAMP,
        is_estimated_ship_date_set BOOLEAN,
        is_access_point_order BOOLEAN,
        has_automated_shipping_settings BOOLEAN,
        easy_ship_shipment_status VARCHAR(50),
        electronic_invoice_status VARCHAR(50),
        raw_order_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_orders_order_status ON orders(order_status);
      CREATE INDEX IF NOT EXISTS idx_orders_purchase_date ON orders(purchase_date);
      CREATE INDEX IF NOT EXISTS idx_orders_marketplace_id ON orders(marketplace_id);
      CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_channel ON orders(fulfillment_channel);
      CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON orders(updated_at);
    `;
    await client.query(createTableQuery);
    
    // Add missing columns if table already existed (migration support)
    // Define all columns that should exist in the orders table
    const requiredColumns = [
      { name: 'order_channel', type: 'VARCHAR(100)' },
      { name: 'order_total_currency_code', type: 'VARCHAR(10)' },
      { name: 'seller_order_id', type: 'VARCHAR(50)' },
      { name: 'purchase_date', type: 'TIMESTAMP' },
      { name: 'last_update_date', type: 'TIMESTAMP' },
      { name: 'order_status', type: 'VARCHAR(50)' },
      { name: 'fulfillment_channel', type: 'VARCHAR(50)' },
      { name: 'sales_channel', type: 'VARCHAR(100)' },
      { name: 'ship_service_level', type: 'VARCHAR(100)' },
      { name: 'order_total_amount', type: 'NUMERIC(10, 2)' },
      { name: 'number_of_items_shipped', type: 'INTEGER' },
      { name: 'number_of_items_unshipped', type: 'INTEGER' },
      { name: 'payment_method', type: 'VARCHAR(50)' },
      { name: 'payment_method_details', type: 'JSONB' },
      { name: 'marketplace_id', type: 'VARCHAR(50)' },
      { name: 'buyer_info', type: 'JSONB' },
      { name: 'shipping_address', type: 'JSONB' },
      { name: 'order_type', type: 'VARCHAR(50)' },
      { name: 'earliest_ship_date', type: 'TIMESTAMP' },
      { name: 'latest_ship_date', type: 'TIMESTAMP' },
      { name: 'earliest_delivery_date', type: 'TIMESTAMP' },
      { name: 'latest_delivery_date', type: 'TIMESTAMP' },
      { name: 'is_business_order', type: 'BOOLEAN' },
      { name: 'is_prime', type: 'BOOLEAN' },
      { name: 'is_global_express_enabled', type: 'BOOLEAN' },
      { name: 'is_sold_by_ab', type: 'BOOLEAN' },
      { name: 'is_iba', type: 'BOOLEAN' },
      { name: 'replaced_order_id', type: 'VARCHAR(50)' },
      { name: 'is_replacement_order', type: 'BOOLEAN' },
      { name: 'promise_response_due_date', type: 'TIMESTAMP' },
      { name: 'is_estimated_ship_date_set', type: 'BOOLEAN' },
      { name: 'is_access_point_order', type: 'BOOLEAN' },
      { name: 'has_automated_shipping_settings', type: 'BOOLEAN' },
      { name: 'easy_ship_shipment_status', type: 'VARCHAR(50)' },
      { name: 'electronic_invoice_status', type: 'VARCHAR(50)' },
      { name: 'raw_order_data', type: 'JSONB' },
      { name: 'created_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
    ];
    
    // Check which columns exist
    const existingColumnsQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'orders';
    `;
    const existingColumnsResult = await client.query(existingColumnsQuery);
    const existingColumns = new Set(existingColumnsResult.rows.map(row => row.column_name));
    
    // Add missing columns
    let addedCount = 0;
    for (const column of requiredColumns) {
      if (!existingColumns.has(column.name)) {
        try {
          await client.query(`ALTER TABLE orders ADD COLUMN ${column.name} ${column.type};`);
          console.log(`✓ Added missing column: ${column.name}`);
          addedCount++;
        } catch (error) {
          console.error(`✗ Failed to add column ${column.name}:`, error.message);
        }
      }
    }
    
    if (addedCount > 0) {
      console.log(`✓ Migration complete: Added ${addedCount} missing column(s) to orders table`);
    }
    
    client.release();
    console.log("✓ Orders table initialized");
    return true;
  } catch (error) {
    console.error("✗ Failed to initialize orders table:", error.message);
    return false;
  }
}

/**
 * Store orders data in the database
 * Uses UPSERT (INSERT ... ON CONFLICT UPDATE) to handle duplicates
 * @param {Array} ordersData - Array of order objects from Amazon SP-API
 * @returns {Promise<Object>} Object with stored, updated, and total counts
 */
export async function storeOrdersInDatabase(ordersData) {
  if (!ordersData || !Array.isArray(ordersData) || ordersData.length === 0) {
    console.log("No orders data to store");
    return { stored: 0, updated: 0 };
  }

  try {
    const client = await pool.connect();
    let stored = 0;
    let updated = 0;

    for (const order of ordersData) {
      const upsertQuery = `
        INSERT INTO orders (
          amazon_order_id, seller_order_id, purchase_date, last_update_date,
          order_status, fulfillment_channel, sales_channel, order_channel,
          ship_service_level, order_total_amount, order_total_currency_code,
          number_of_items_shipped, number_of_items_unshipped, payment_method,
          payment_method_details, marketplace_id, buyer_info, shipping_address,
          order_type, earliest_ship_date, latest_ship_date,
          earliest_delivery_date, latest_delivery_date, is_business_order,
          is_prime, is_global_express_enabled, is_sold_by_ab, is_iba,
          replaced_order_id, is_replacement_order, promise_response_due_date,
          is_estimated_ship_date_set, is_access_point_order,
          has_automated_shipping_settings, easy_ship_shipment_status,
          electronic_invoice_status, raw_order_data, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
          $29, $30, $31, $32, $33, $34, $35, $36, $37, CURRENT_TIMESTAMP
        )
        ON CONFLICT (amazon_order_id) 
        DO UPDATE SET
          seller_order_id = EXCLUDED.seller_order_id,
          purchase_date = EXCLUDED.purchase_date,
          last_update_date = EXCLUDED.last_update_date,
          order_status = EXCLUDED.order_status,
          fulfillment_channel = EXCLUDED.fulfillment_channel,
          sales_channel = EXCLUDED.sales_channel,
          order_channel = EXCLUDED.order_channel,
          ship_service_level = EXCLUDED.ship_service_level,
          order_total_amount = EXCLUDED.order_total_amount,
          order_total_currency_code = EXCLUDED.order_total_currency_code,
          number_of_items_shipped = EXCLUDED.number_of_items_shipped,
          number_of_items_unshipped = EXCLUDED.number_of_items_unshipped,
          payment_method = EXCLUDED.payment_method,
          payment_method_details = EXCLUDED.payment_method_details,
          marketplace_id = EXCLUDED.marketplace_id,
          buyer_info = EXCLUDED.buyer_info,
          shipping_address = EXCLUDED.shipping_address,
          order_type = EXCLUDED.order_type,
          earliest_ship_date = EXCLUDED.earliest_ship_date,
          latest_ship_date = EXCLUDED.latest_ship_date,
          earliest_delivery_date = EXCLUDED.earliest_delivery_date,
          latest_delivery_date = EXCLUDED.latest_delivery_date,
          is_business_order = EXCLUDED.is_business_order,
          is_prime = EXCLUDED.is_prime,
          is_global_express_enabled = EXCLUDED.is_global_express_enabled,
          is_sold_by_ab = EXCLUDED.is_sold_by_ab,
          is_iba = EXCLUDED.is_iba,
          replaced_order_id = EXCLUDED.replaced_order_id,
          is_replacement_order = EXCLUDED.is_replacement_order,
          promise_response_due_date = EXCLUDED.promise_response_due_date,
          is_estimated_ship_date_set = EXCLUDED.is_estimated_ship_date_set,
          is_access_point_order = EXCLUDED.is_access_point_order,
          has_automated_shipping_settings = EXCLUDED.has_automated_shipping_settings,
          easy_ship_shipment_status = EXCLUDED.easy_ship_shipment_status,
          electronic_invoice_status = EXCLUDED.electronic_invoice_status,
          raw_order_data = EXCLUDED.raw_order_data,
          updated_at = CURRENT_TIMESTAMP
        RETURNING (xmax = 0) AS inserted;
      `;

      // Helper function to parse ISO date string to Date or null
      const parseDate = (dateString) => {
        if (!dateString) return null;
        try {
          return new Date(dateString);
        } catch {
          return null;
        }
      };

      // Parse order total amount
      const orderTotalAmount = order.OrderTotal?.Amount 
        ? parseFloat(order.OrderTotal.Amount) 
        : null;

      const result = await client.query(upsertQuery, [
        order.AmazonOrderId || null,
        order.SellerOrderId || null,
        parseDate(order.PurchaseDate),
        parseDate(order.LastUpdateDate),
        order.OrderStatus || null,
        order.FulfillmentChannel || null,
        order.SalesChannel || null,
        order.OrderChannel || null,
        order.ShipServiceLevel || null,
        orderTotalAmount,
        order.OrderTotal?.CurrencyCode || null,
        order.NumberOfItemsShipped || null,
        order.NumberOfItemsUnshipped || null,
        order.PaymentMethod || null,
        order.PaymentMethodDetails ? JSON.stringify(order.PaymentMethodDetails) : null,
        order.MarketplaceId || null,
        order.BuyerInfo ? JSON.stringify(order.BuyerInfo) : null,
        order.ShippingAddress ? JSON.stringify(order.ShippingAddress) : null,
        order.OrderType || null,
        parseDate(order.EarliestShipDate),
        parseDate(order.LatestShipDate),
        parseDate(order.EarliestDeliveryDate),
        parseDate(order.LatestDeliveryDate),
        order.IsBusinessOrder || false,
        order.IsPrime || false,
        order.IsGlobalExpressEnabled || false,
        order.IsSoldByAB || false,
        order.IsIBA || false,
        order.ReplacedOrderId || null,
        order.IsReplacementOrder || false,
        parseDate(order.PromiseResponseDueDate),
        order.IsEstimatedShipDateSet || false,
        order.IsAccessPointOrder || false,
        order.HasAutomatedShippingSettings || false,
        order.EasyShipShipmentStatus || null,
        order.ElectronicInvoiceStatus || null,
        JSON.stringify(order), // Store full order object as raw_order_data
      ]);

      // Check if it was an insert (new) or update (existing)
      if (result.rows[0]?.inserted) {
        stored++;
      } else {
        updated++;
      }
    }

    client.release();
    console.log(`✓ Stored ${stored} new orders, updated ${updated} existing orders`);
    return { stored, updated, total: ordersData.length };
  } catch (error) {
    console.error("✗ Failed to store orders in database:", error.message);
    throw error;
  }
}

/**
 * Get orders from the database with optional filters
 * @param {Object} filters - Filter options (orderStatus, marketplaceId, fulfillmentChannel, limit, offset, startDate, endDate)
 * @returns {Promise<Object>} Object with orders array and metadata
 */
export async function getOrdersFromDatabase(filters = {}) {
  try {
    const client = await pool.connect();
    
    const orderStatus = filters.orderStatus;
    const marketplaceId = filters.marketplaceId;
    const fulfillmentChannel = filters.fulfillmentChannel;
    // Support 'all' or 0 to fetch all records, otherwise use limit or default to 100
    const limitParam = filters.limit;
    const limit = limitParam === 'all' || limitParam === '0' || limitParam === 0 
      ? null 
      : parseInt(limitParam || "100");
    const offset = parseInt(filters.offset || "0");
    const startDate = filters.startDate;
    const endDate = filters.endDate;
    
    let query = "SELECT * FROM orders WHERE 1=1";
    const params = [];
    let paramIndex = 1;
    
    if (orderStatus) {
      query += ` AND order_status = $${paramIndex}`;
      params.push(orderStatus);
      paramIndex++;
    }
    
    if (marketplaceId) {
      query += ` AND marketplace_id = $${paramIndex}`;
      params.push(marketplaceId);
      paramIndex++;
    }
    
    if (fulfillmentChannel) {
      query += ` AND fulfillment_channel = $${paramIndex}`;
      params.push(fulfillmentChannel);
      paramIndex++;
    }
    
    if (startDate) {
      query += ` AND purchase_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      query += ` AND purchase_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    
    query += ` ORDER BY purchase_date DESC`;
    
    // Only add LIMIT and OFFSET if limit is specified
    if (limit !== null) {
      query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);
    } else if (offset > 0) {
      // If no limit but offset is specified, still add OFFSET
      query += ` OFFSET $${paramIndex}`;
      params.push(offset);
    }
    
    const result = await client.query(query, params);
    
    // Get total count for metadata (without limit/offset)
    let countQuery = "SELECT COUNT(*) as total FROM orders WHERE 1=1";
    const countParams = [];
    let countParamIndex = 1;
    
    if (orderStatus) {
      countQuery += ` AND order_status = $${countParamIndex}`;
      countParams.push(orderStatus);
      countParamIndex++;
    }
    
    if (marketplaceId) {
      countQuery += ` AND marketplace_id = $${countParamIndex}`;
      countParams.push(marketplaceId);
      countParamIndex++;
    }
    
    if (fulfillmentChannel) {
      countQuery += ` AND fulfillment_channel = $${countParamIndex}`;
      countParams.push(fulfillmentChannel);
      countParamIndex++;
    }
    
    if (startDate) {
      countQuery += ` AND purchase_date >= $${countParamIndex}`;
      countParams.push(startDate);
      countParamIndex++;
    }
    
    if (endDate) {
      countQuery += ` AND purchase_date <= $${countParamIndex}`;
      countParams.push(endDate);
      countParamIndex++;
    }
    
    const countResult = await client.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].total);
    
    // Transform database rows to match API response format
    const orders = result.rows.map(row => ({
      AmazonOrderId: row.amazon_order_id,
      SellerOrderId: row.seller_order_id,
      PurchaseDate: row.purchase_date,
      LastUpdateDate: row.last_update_date,
      OrderStatus: row.order_status,
      FulfillmentChannel: row.fulfillment_channel,
      SalesChannel: row.sales_channel,
      OrderChannel: row.order_channel,
      ShipServiceLevel: row.ship_service_level,
      OrderTotal: {
        Amount: row.order_total_amount?.toString() || "0",
        CurrencyCode: row.order_total_currency_code || "USD"
      },
      NumberOfItemsShipped: row.number_of_items_shipped,
      NumberOfItemsUnshipped: row.number_of_items_unshipped,
      PaymentMethod: row.payment_method,
      PaymentMethodDetails: row.payment_method_details,
      MarketplaceId: row.marketplace_id,
      BuyerInfo: row.buyer_info,
      ShippingAddress: row.shipping_address,
      OrderType: row.order_type,
      EarliestShipDate: row.earliest_ship_date,
      LatestShipDate: row.latest_ship_date,
      EarliestDeliveryDate: row.earliest_delivery_date,
      LatestDeliveryDate: row.latest_delivery_date,
      IsBusinessOrder: row.is_business_order,
      IsPrime: row.is_prime,
      IsGlobalExpressEnabled: row.is_global_express_enabled,
      IsSoldByAB: row.is_sold_by_ab,
      IsIBA: row.is_iba,
      ReplacedOrderId: row.replaced_order_id,
      IsReplacementOrder: row.is_replacement_order,
      PromiseResponseDueDate: row.promise_response_due_date,
      IsEstimatedShipDateSet: row.is_estimated_ship_date_set,
      IsAccessPointOrder: row.is_access_point_order,
      HasAutomatedShippingSettings: row.has_automated_shipping_settings,
      EasyShipShipmentStatus: row.easy_ship_shipment_status,
      ElectronicInvoiceStatus: row.electronic_invoice_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
    
    client.release();
    
    return {
      orders,
      total: orders.length,
      totalCount,
      limit: limit || 'all',
      offset
    };
  } catch (error) {
    console.error("✗ Failed to get orders from database:", error.message);
    throw error;
  }
}

/**
 * Get reports from the database
 * @param {Object} filters - Filter options
 * @param {string} filters.reportId - Filter by report ID
 * @param {string} filters.campaignId - Filter by campaign ID
 * @param {string} filters.campaignStatus - Filter by campaign status
 * @param {string} filters.startDate - Filter reports from this date (ISO format)
 * @param {string} filters.endDate - Filter reports until this date (ISO format)
 * @param {number} filters.limit - Limit number of results (default: 100)
 * @param {number} filters.offset - Offset for pagination (default: 0)
 * @returns {Promise<Object>} Object with reports array and metadata
 */
export async function getReportsFromDatabase(filters = {}) {
  try {
    const client = await pool.connect();
    
    const reportId = filters.reportId;
    const campaignId = filters.campaignId;
    const campaignStatus = filters.campaignStatus;
    // Support 'all' or 0 to fetch all records, otherwise use limit or default to 100
    const limitParam = filters.limit;
    const limit = limitParam === 'all' || limitParam === '0' || limitParam === 0 
      ? null 
      : parseInt(limitParam || "100");
    const offset = parseInt(filters.offset || "0");
    const startDate = filters.startDate;
    const endDate = filters.endDate;
    
    let query = "SELECT * FROM reports WHERE 1=1";
    const params = [];
    let paramIndex = 1;
    
    if (reportId) {
      query += ` AND report_id = $${paramIndex}`;
      params.push(reportId);
      paramIndex++;
    }
    
    if (campaignId) {
      query += ` AND campaign_id = $${paramIndex}`;
      params.push(campaignId);
      paramIndex++;
    }
    
    if (campaignStatus) {
      query += ` AND campaign_status = $${paramIndex}`;
      params.push(campaignStatus);
      paramIndex++;
    }
    
    if (startDate) {
      query += ` AND report_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      query += ` AND report_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    
    query += ` ORDER BY report_date DESC, created_at DESC`;
    
    // Only add LIMIT and OFFSET if limit is specified
    if (limit !== null) {
      query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);
    } else if (offset > 0) {
      // If no limit but offset is specified, still add OFFSET
      query += ` OFFSET $${paramIndex}`;
      params.push(offset);
    }
    
    const result = await client.query(query, params);
    
    // Get total count for metadata (without limit/offset)
    let countQuery = "SELECT COUNT(*) as total FROM reports WHERE 1=1";
    const countParams = [];
    let countParamIndex = 1;
    
    if (reportId) {
      countQuery += ` AND report_id = $${countParamIndex}`;
      countParams.push(reportId);
      countParamIndex++;
    }
    
    if (campaignId) {
      countQuery += ` AND campaign_id = $${countParamIndex}`;
      countParams.push(campaignId);
      countParamIndex++;
    }
    
    if (campaignStatus) {
      countQuery += ` AND campaign_status = $${countParamIndex}`;
      countParams.push(campaignStatus);
      countParamIndex++;
    }
    
    if (startDate) {
      countQuery += ` AND report_date >= $${countParamIndex}`;
      countParams.push(startDate);
      countParamIndex++;
    }
    
    if (endDate) {
      countQuery += ` AND report_date <= $${countParamIndex}`;
      countParams.push(endDate);
      countParamIndex++;
    }
    
    const countResult = await client.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].total);
    
    // Transform database rows to match API response format
    const reports = result.rows.map(row => ({
      id: row.id,
      reportId: row.report_id,
      date: row.report_date,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      campaignStatus: row.campaign_status,
      campaignBudgetAmount: row.campaign_budget_amount ? parseFloat(row.campaign_budget_amount) : null,
      campaignBudgetCurrencyCode: row.campaign_budget_currency_code,
      campaignBudgetType: row.campaign_budget_type,
      campaignBiddingStrategy: row.campaign_bidding_strategy,
      impressions: row.impressions,
      clicks: row.clicks,
      cost: row.cost ? parseFloat(row.cost) : null,
      costPerClick: row.cost_per_click ? parseFloat(row.cost_per_click) : null,
      clickThroughRate: row.click_through_rate ? parseFloat(row.click_through_rate) : null,
      sales1d: row.sales1d ? parseFloat(row.sales1d) : null,
      sales7d: row.sales7d ? parseFloat(row.sales7d) : null,
      sales14d: row.sales14d ? parseFloat(row.sales14d) : null,
      sales30d: row.sales30d ? parseFloat(row.sales30d) : null,
      purchases1d: row.purchases1d,
      purchases7d: row.purchases7d,
      purchases14d: row.purchases14d,
      purchases30d: row.purchases30d,
      unitsSoldClicks1d: row.units_sold_clicks1d,
      unitsSoldClicks7d: row.units_sold_clicks7d,
      unitsSoldClicks14d: row.units_sold_clicks14d,
      unitsSoldClicks30d: row.units_sold_clicks30d,
      unitsSoldSameSku1d: row.units_sold_same_sku1d,
      unitsSoldSameSku7d: row.units_sold_same_sku7d,
      unitsSoldSameSku14d: row.units_sold_same_sku14d,
      unitsSoldSameSku30d: row.units_sold_same_sku30d,
      attributedSalesSameSku1d: row.attributed_sales_same_sku1d ? parseFloat(row.attributed_sales_same_sku1d) : null,
      attributedSalesSameSku7d: row.attributed_sales_same_sku7d ? parseFloat(row.attributed_sales_same_sku7d) : null,
      attributedSalesSameSku14d: row.attributed_sales_same_sku14d ? parseFloat(row.attributed_sales_same_sku14d) : null,
      attributedSalesSameSku30d: row.attributed_sales_same_sku30d ? parseFloat(row.attributed_sales_same_sku30d) : null,
      acosClicks14d: row.acos_clicks14d ? parseFloat(row.acos_clicks14d) : null,
      roasClicks14d: row.roas_clicks14d ? parseFloat(row.roas_clicks14d) : null,
      topOfSearchImpressionShare: row.top_of_search_impression_share ? parseFloat(row.top_of_search_impression_share) : null,
      rawRowData: row.raw_row_data,
      createdAt: row.created_at
    }));
    
    client.release();
    
    return {
      reports,
      total: reports.length,
      totalCount,
      limit: limit || 'all',
      offset
    };
  } catch (error) {
    console.error("✗ Failed to get reports from database:", error.message);
    throw error;
  }
}

/**
 * Get database connection test result
 * @returns {Promise<Object>} Database connection status and info
 */
export async function getDatabaseTestResult() {
  try {
    const client = await pool.connect();
    const result = await client.query("SELECT NOW() as current_time, version() as version");
    client.release();
    
    const dbInfo = getDatabaseInfo();
    return {
      success: true,
      message: "Database connection successful",
      database: dbInfo.database,
      host: dbInfo.host,
      currentTime: result.rows[0].current_time,
      version: result.rows[0].version,
    };
  } catch (error) {
    const dbInfo = getDatabaseInfo();
    return {
      success: false,
      error: error?.message || "Database connection error",
      database: dbInfo.database,
      host: dbInfo.host,
    };
  }
}

/**
 * Initialize report_single table if it doesn't exist
 * @returns {Promise<boolean>} True if initialization successful, false otherwise
 */
export async function initializeReportSingleTable() {
  try {
    const client = await pool.connect();
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS report_single (
        report_id VARCHAR(255) PRIMARY KEY,
        report_type_id VARCHAR(100) NOT NULL DEFAULT 'spCampaigns',
        start_date DATE NOT NULL,
        end_date DATE,
        configuration JSONB NOT NULL,
        status VARCHAR(50),
        status_details VARCHAR(255),
        url TEXT,
        file_size INTEGER,
        expiration_date TIMESTAMP,
        raw_response_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Add report_type_id column if it doesn't exist (for existing tables)
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'report_single' AND column_name = 'report_type_id'
        ) THEN
          ALTER TABLE report_single ADD COLUMN report_type_id VARCHAR(100) NOT NULL DEFAULT 'spCampaigns';
        END IF;
      END $$;
      
      -- Add start_date column if it doesn't exist (for existing tables)
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'report_single' AND column_name = 'start_date'
        ) THEN
          ALTER TABLE report_single ADD COLUMN start_date DATE;
          -- Set a default value for existing rows
          UPDATE report_single SET start_date = CURRENT_DATE WHERE start_date IS NULL;
          -- Then make it NOT NULL
          ALTER TABLE report_single ALTER COLUMN start_date SET NOT NULL;
        END IF;
      END $$;
      
      -- Add end_date column if it doesn't exist (for existing tables)
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'report_single' AND column_name = 'end_date'
        ) THEN
          ALTER TABLE report_single ADD COLUMN end_date DATE;
        END IF;
      END $$;
      
      -- Add configuration column if it doesn't exist (for existing tables)
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'report_single' AND column_name = 'configuration'
        ) THEN
          ALTER TABLE report_single ADD COLUMN configuration JSONB;
          -- Set a default empty JSON object for existing rows
          UPDATE report_single SET configuration = '{}'::jsonb WHERE configuration IS NULL;
          -- Then make it NOT NULL
          ALTER TABLE report_single ALTER COLUMN configuration SET NOT NULL;
        END IF;
      END $$;
      
      CREATE INDEX IF NOT EXISTS idx_report_single_status ON report_single(status);
      CREATE INDEX IF NOT EXISTS idx_report_single_created_at ON report_single(created_at);
      CREATE INDEX IF NOT EXISTS idx_report_single_updated_at ON report_single(updated_at);
    `;
    await client.query(createTableQuery);
    client.release();
    console.log("✓ Report single table initialized");
    return true;
  } catch (error) {
    console.error("✗ Failed to initialize report_single table:", error.message);
    return false;
  }
}

/**
 * Store report single data in the database
 * Uses UPSERT (INSERT ... ON CONFLICT UPDATE) to handle duplicates
 * @param {Object} reportData - Report object from Amazon Ads API
 * @returns {Promise<Object>} Object with stored, updated status
 */
export async function storeReportSingleInDatabase(reportData) {
  if (!reportData || !reportData.reportId) {
    console.log("No report data to store or missing reportId");
    return { stored: false, updated: false };
  }

  try {
    const client = await pool.connect();
    
    // Extract report_type_id from report data
    // It can be in configuration.reportTypeId or we use default
    const reportTypeId = reportData.configuration?.reportTypeId || 
                        reportData.reportTypeId || 
                        'spCampaigns';
    
    // Extract start_date and end_date from report data
    // They can be in the root level or in configuration
    // Also check in the raw_response_data if we stored it previously
    let startDate = reportData.startDate || 
                   reportData.configuration?.startDate || 
                   null;
    let endDate = reportData.endDate || 
                 reportData.configuration?.endDate || 
                 null;
    
    // If not found, try to extract from raw_response_data if it exists
    // (This handles cases where the API response structure might be different)
    if (!startDate && reportData.raw_response_data) {
      try {
        const rawData = typeof reportData.raw_response_data === 'string' 
          ? JSON.parse(reportData.raw_response_data) 
          : reportData.raw_response_data;
        startDate = rawData.startDate || rawData.configuration?.startDate || null;
        endDate = rawData.endDate || rawData.configuration?.endDate || null;
      } catch (e) {
        // Ignore parsing errors
      }
    }
    
    // Validate start_date is present (required)
    if (!startDate) {
      // Provide a helpful error message with available fields
      const availableFields = Object.keys(reportData).join(', ');
      throw new Error(`startDate is required but not found in report data. Available fields: ${availableFields}`);
    }
    
    // Extract configuration from report data
    // It should be in reportData.configuration, or we use an empty object as fallback
    let configuration = reportData.configuration || {};
    
    // If configuration is not found, try to extract from raw_response_data
    if (!reportData.configuration && reportData.raw_response_data) {
      try {
        const rawData = typeof reportData.raw_response_data === 'string' 
          ? JSON.parse(reportData.raw_response_data) 
          : reportData.raw_response_data;
        configuration = rawData.configuration || {};
      } catch (e) {
        // Ignore parsing errors, use empty object
        configuration = {};
      }
    }
    
    // Ensure configuration is an object (not null/undefined)
    if (!configuration || typeof configuration !== 'object') {
      configuration = {};
    }
    
    const upsertQuery = `
      INSERT INTO report_single (
        report_id, report_type_id, start_date, end_date, configuration, status, status_details, url, file_size,
        expiration_date, raw_response_data, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (report_id) 
      DO UPDATE SET
        report_type_id = EXCLUDED.report_type_id,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        configuration = EXCLUDED.configuration,
        status = EXCLUDED.status,
        status_details = EXCLUDED.status_details,
        url = EXCLUDED.url,
        file_size = EXCLUDED.file_size,
        expiration_date = EXCLUDED.expiration_date,
        raw_response_data = EXCLUDED.raw_response_data,
        updated_at = CURRENT_TIMESTAMP
        -- Note: created_at is NOT updated on conflict to preserve original creation time
      RETURNING (xmax = 0) AS inserted;
    `;

    // Helper function to parse ISO date string to YYYY-MM-DD format for DATE columns
    const parseDateOnly = (dateString) => {
      if (!dateString) return null;
      try {
        // Handle both ISO date strings (YYYY-MM-DD) and full ISO datetime strings
        const date = new Date(dateString);
        // Return date in YYYY-MM-DD format for DATE column
        return date.toISOString().split('T')[0];
      } catch {
        return null;
      }
    };
    
    // Helper function to parse ISO date string to Date object for TIMESTAMP columns
    const parseTimestamp = (dateString) => {
      if (!dateString) return null;
      try {
        return new Date(dateString);
      } catch {
        return null;
      }
    };

    const result = await client.query(upsertQuery, [
      reportData.reportId || null,
      reportTypeId,
      parseDateOnly(startDate),
      parseDateOnly(endDate),
      JSON.stringify(configuration), // Store configuration as JSONB
      reportData.status || null,
      reportData.statusDetails || null,
      reportData.url || null,
      reportData.fileSize || null,
      parseTimestamp(reportData.expirationDate),
      JSON.stringify(reportData), // Store full response as raw_response_data
    ]);

    const wasInserted = result.rows[0]?.inserted;
    client.release();
    
    if (wasInserted) {
      console.log(`✓ Stored new report_single: ${reportData.reportId}`);
      return { stored: true, updated: false };
    } else {
      console.log(`✓ Updated existing report_single: ${reportData.reportId}`);
      return { stored: false, updated: true };
    }
  } catch (error) {
    console.error("✗ Failed to store report_single in database:", error.message);
    throw error;
  }
}

/**
 * Initialize reports table if it doesn't exist
 * This table stores individual report rows with metrics
 * Also handles migration from old schema (date column) to new schema (report_date column)
 * @returns {Promise<boolean>} True if initialization successful, false otherwise
 */
export async function initializeReportsTable() {
  try {
    const client = await pool.connect();
    
    // First, create the table if it doesn't exist
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        report_id VARCHAR(255) NOT NULL,
        report_date DATE NOT NULL,
        campaign_id BIGINT,
        campaign_name VARCHAR(500),
        campaign_status VARCHAR(50),
        campaign_budget_amount NUMERIC(10, 2),
        campaign_budget_currency_code VARCHAR(10),
        campaign_budget_type VARCHAR(50),
        campaign_bidding_strategy VARCHAR(100),
        impressions INTEGER,
        clicks INTEGER,
        cost NUMERIC(10, 2),
        cost_per_click NUMERIC(10, 2),
        click_through_rate NUMERIC(10, 4),
        sales1d NUMERIC(10, 2),
        sales7d NUMERIC(10, 2),
        sales14d NUMERIC(10, 2),
        sales30d NUMERIC(10, 2),
        purchases1d INTEGER,
        purchases7d INTEGER,
        purchases14d INTEGER,
        purchases30d INTEGER,
        units_sold_clicks1d INTEGER,
        units_sold_clicks7d INTEGER,
        units_sold_clicks14d INTEGER,
        units_sold_clicks30d INTEGER,
        units_sold_same_sku1d INTEGER,
        units_sold_same_sku7d INTEGER,
        units_sold_same_sku14d INTEGER,
        units_sold_same_sku30d INTEGER,
        attributed_sales_same_sku1d NUMERIC(10, 2),
        attributed_sales_same_sku7d NUMERIC(10, 2),
        attributed_sales_same_sku14d NUMERIC(10, 2),
        attributed_sales_same_sku30d NUMERIC(10, 2),
        acos_clicks14d NUMERIC(10, 4),
        roas_clicks14d NUMERIC(10, 4),
        top_of_search_impression_share NUMERIC(10, 4),
        raw_row_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await client.query(createTableQuery);
    
    // Check if table has old 'date' column and migrate if needed
    const checkColumnsQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'reports' 
      AND column_name IN ('date', 'report_date');
    `;
    const columnResult = await client.query(checkColumnsQuery);
    const columnNames = columnResult.rows.map(row => row.column_name);
    
    if (columnNames.includes('date') && !columnNames.includes('report_date')) {
      // Migrate: rename date to report_date
      console.log("Migrating reports table: renaming 'date' column to 'report_date'...");
      await client.query(`ALTER TABLE reports RENAME COLUMN date TO report_date;`);
      await client.query(`ALTER TABLE reports ALTER COLUMN report_date SET NOT NULL;`);
    } else if (!columnNames.includes('report_date')) {
      // Add report_date column if it doesn't exist
      console.log("Adding 'report_date' column to reports table...");
      await client.query(`ALTER TABLE reports ADD COLUMN report_date DATE;`);
      // If date column exists, copy its values
      if (columnNames.includes('date')) {
        await client.query(`UPDATE reports SET report_date = date WHERE report_date IS NULL;`);
        await client.query(`ALTER TABLE reports DROP COLUMN date;`);
      }
      await client.query(`ALTER TABLE reports ALTER COLUMN report_date SET NOT NULL;`);
    }
    
    // Ensure the unique constraint exists with correct columns
    // Drop any existing unique constraints that might use old column names
    const findConstraintsQuery = `
      SELECT conname 
      FROM pg_constraint 
      WHERE conrelid = 'reports'::regclass 
      AND contype = 'u';
    `;
    const constraintResult = await client.query(findConstraintsQuery);
    
    // Drop existing unique constraints (we'll recreate the correct one)
    for (const row of constraintResult.rows) {
      try {
        await client.query(`ALTER TABLE reports DROP CONSTRAINT IF EXISTS ${row.conname} CASCADE;`);
      } catch (err) {
        // Ignore errors
        console.log(`Note: ${err.message}`);
      }
    }
    
    // Create the correct unique constraint
    try {
      await client.query(`
        ALTER TABLE reports 
        ADD CONSTRAINT reports_report_id_report_date_campaign_id_key 
        UNIQUE (report_id, report_date, campaign_id);
      `);
      console.log("✓ Created unique constraint on (report_id, report_date, campaign_id)");
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log("✓ Unique constraint already exists");
      } else {
        console.warn(`Warning: Could not create unique constraint: ${err.message}`);
      }
    }
    
    // Create indexes if they don't exist
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reports_report_id ON reports(report_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reports_report_date ON reports(report_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reports_campaign_id ON reports(campaign_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);`);
    
    client.release();
    console.log("✓ Reports table initialized and migrated");
    return true;
  } catch (error) {
    console.error("✗ Failed to initialize reports table:", error.message);
    return false;
  }
}

/**
 * Store report rows data in the database
 * Uses UPSERT (INSERT ... ON CONFLICT UPDATE) to handle duplicates
 * @param {string} reportId - Report ID from report_single table
 * @param {Array} reportRows - Array of report row objects
 * @returns {Promise<Object>} Object with stored, updated, and total counts
 */
export async function storeReportsInDatabase(reportId, reportRows) {
  if (!reportId) {
    console.log("No report ID provided");
    return { stored: 0, updated: 0 };
  }

  if (!reportRows || !Array.isArray(reportRows) || reportRows.length === 0) {
    console.log("No report rows data to store");
    return { stored: 0, updated: 0 };
  }

  try {
    const client = await pool.connect();
    let stored = 0;
    let updated = 0;
    let skipped = 0;

    // Use a transaction for better error handling
    await client.query('BEGIN');

    try {
      for (const row of reportRows) {
      const upsertQuery = `
        INSERT INTO reports (
          report_id, report_date, campaign_id, campaign_name, campaign_status,
          campaign_budget_amount, campaign_budget_currency_code, campaign_budget_type,
          campaign_bidding_strategy, impressions, clicks, cost, cost_per_click,
          click_through_rate, sales1d, sales7d, sales14d, sales30d,
          purchases1d, purchases7d, purchases14d, purchases30d,
          units_sold_clicks1d, units_sold_clicks7d, units_sold_clicks14d, units_sold_clicks30d,
          units_sold_same_sku1d, units_sold_same_sku7d, units_sold_same_sku14d, units_sold_same_sku30d,
          attributed_sales_same_sku1d, attributed_sales_same_sku7d, attributed_sales_same_sku14d, attributed_sales_same_sku30d,
          acos_clicks14d, roas_clicks14d, top_of_search_impression_share,
          raw_row_data, created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
          $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, CURRENT_TIMESTAMP
        )
        ON CONFLICT (report_id, report_date, campaign_id)
        DO UPDATE SET
          campaign_name = EXCLUDED.campaign_name,
          campaign_status = EXCLUDED.campaign_status,
          campaign_budget_amount = EXCLUDED.campaign_budget_amount,
          campaign_budget_currency_code = EXCLUDED.campaign_budget_currency_code,
          campaign_budget_type = EXCLUDED.campaign_budget_type,
          campaign_bidding_strategy = EXCLUDED.campaign_bidding_strategy,
          impressions = EXCLUDED.impressions,
          clicks = EXCLUDED.clicks,
          cost = EXCLUDED.cost,
          cost_per_click = EXCLUDED.cost_per_click,
          click_through_rate = EXCLUDED.click_through_rate,
          sales1d = EXCLUDED.sales1d,
          sales7d = EXCLUDED.sales7d,
          sales14d = EXCLUDED.sales14d,
          sales30d = EXCLUDED.sales30d,
          purchases1d = EXCLUDED.purchases1d,
          purchases7d = EXCLUDED.purchases7d,
          purchases14d = EXCLUDED.purchases14d,
          purchases30d = EXCLUDED.purchases30d,
          units_sold_clicks1d = EXCLUDED.units_sold_clicks1d,
          units_sold_clicks7d = EXCLUDED.units_sold_clicks7d,
          units_sold_clicks14d = EXCLUDED.units_sold_clicks14d,
          units_sold_clicks30d = EXCLUDED.units_sold_clicks30d,
          units_sold_same_sku1d = EXCLUDED.units_sold_same_sku1d,
          units_sold_same_sku7d = EXCLUDED.units_sold_same_sku7d,
          units_sold_same_sku14d = EXCLUDED.units_sold_same_sku14d,
          units_sold_same_sku30d = EXCLUDED.units_sold_same_sku30d,
          attributed_sales_same_sku1d = EXCLUDED.attributed_sales_same_sku1d,
          attributed_sales_same_sku7d = EXCLUDED.attributed_sales_same_sku7d,
          attributed_sales_same_sku14d = EXCLUDED.attributed_sales_same_sku14d,
          attributed_sales_same_sku30d = EXCLUDED.attributed_sales_same_sku30d,
          acos_clicks14d = EXCLUDED.acos_clicks14d,
          roas_clicks14d = EXCLUDED.roas_clicks14d,
          top_of_search_impression_share = EXCLUDED.top_of_search_impression_share,
          raw_row_data = EXCLUDED.raw_row_data
        RETURNING (xmax = 0) AS inserted;
      `;

      // Helper function to parse date string to Date or null
      const parseDate = (dateString) => {
        if (!dateString) return null;
        try {
          // Handle both ISO date strings (YYYY-MM-DD) and Date objects
          const date = new Date(dateString);
          // Check if date is valid
          if (isNaN(date.getTime())) {
            return null;
          }
          return date;
        } catch {
          return null;
        }
      };

      // Helper function to parse numeric value
      const parseNumeric = (value) => {
        if (value === null || value === undefined) return null;
        const num = parseFloat(value);
        return isNaN(num) ? null : num;
      };

      // Helper function to parse integer value
      const parseIntValue = (value) => {
        if (value === null || value === undefined) return null;
        const num = parseInt(value);
        return isNaN(num) ? null : num;
      };

        // Parse date - try both 'date' and 'report_date' fields
        const reportDate = parseDate(row.date) || parseDate(row.report_date);
        if (!reportDate) {
          console.warn(`Skipping row with missing or invalid date. Row data:`, JSON.stringify(row));
          skipped++;
          continue; // Skip this row if date is missing
        }

        try {
          const result = await client.query(upsertQuery, [
            reportId,
            reportDate,
            row.campaignId ? parseInt(row.campaignId) : null,
            row.campaignName || null,
            row.campaignStatus || null,
            parseNumeric(row.campaignBudgetAmount),
            row.campaignBudgetCurrencyCode || null,
            row.campaignBudgetType || null,
            row.campaignBiddingStrategy || null,
            parseIntValue(row.impressions),
            parseIntValue(row.clicks),
            parseNumeric(row.cost),
            parseNumeric(row.costPerClick),
            parseNumeric(row.clickThroughRate),
            parseNumeric(row.sales1d),
            parseNumeric(row.sales7d),
            parseNumeric(row.sales14d),
            parseNumeric(row.sales30d),
            parseIntValue(row.purchases1d),
            parseIntValue(row.purchases7d),
            parseIntValue(row.purchases14d),
            parseIntValue(row.purchases30d),
            parseIntValue(row.unitsSoldClicks1d),
            parseIntValue(row.unitsSoldClicks7d),
            parseIntValue(row.unitsSoldClicks14d),
            parseIntValue(row.unitsSoldClicks30d),
            parseIntValue(row.unitsSoldSameSku1d),
            parseIntValue(row.unitsSoldSameSku7d),
            parseIntValue(row.unitsSoldSameSku14d),
            parseIntValue(row.unitsSoldSameSku30d),
            parseNumeric(row.attributedSalesSameSku1d),
            parseNumeric(row.attributedSalesSameSku7d),
            parseNumeric(row.attributedSalesSameSku14d),
            parseNumeric(row.attributedSalesSameSku30d),
            parseNumeric(row.acosClicks14d),
            parseNumeric(row.roasClicks14d),
            parseNumeric(row.topOfSearchImpressionShare),
            JSON.stringify(row), // Store full row object as raw_row_data
          ]);

          // Check if it was an insert (new) or update (existing)
          if (result.rows[0]?.inserted) {
            stored++;
          } else {
            updated++;
          }
        } catch (rowError) {
        // Handle individual row errors
        if (rowError.message.includes('duplicate key') || 
            rowError.message.includes('unique constraint') ||
            rowError.message.includes('reports_pkey')) {
          // Skip duplicate rows
          skipped++;
          console.warn(`Skipping duplicate row: report_id=${reportId}, date=${row.date || row.report_date}, campaign_id=${row.campaignId}`);
        } else {
          // For other errors, log and skip
          skipped++;
          console.warn(`Error inserting row, skipping: ${rowError.message}`);
        }
        // Continue with next row
        continue;
      }
    }
    } catch (innerError) {
      // If there's an error in the transaction, rollback will happen in outer catch
      throw innerError;
    }

    await client.query('COMMIT');
    client.release();
    console.log(`✓ Stored ${stored} new report rows, updated ${updated} existing report rows, skipped ${skipped} rows`);
    return { stored, updated, skipped, total: reportRows.length };
  } catch (error) {
    // Rollback transaction on error
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error("Error during rollback:", rollbackError.message);
    }
    if (client) {
      client.release();
    }
    console.error("✗ Failed to store reports in database:", error.message);
    throw error;
  }
}

/**
 * Initialize AI decision log table
 * Stores all AI decisions and actions taken
 */
export async function initializeAIDecisionLogTable() {
  try {
    const client = await pool.connect();
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ai_decision_log (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        campaign_id BIGINT,
        campaign_name VARCHAR(500),
        action_type VARCHAR(100),
        what_changed TEXT,
        reason TEXT,
        status VARCHAR(50),
        old_value JSONB,
        new_value JSONB,
        confidence VARCHAR(20),
        ai_mode VARCHAR(20) DEFAULT 'analytical',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_ai_decision_log_campaign_id ON ai_decision_log(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_ai_decision_log_timestamp ON ai_decision_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_ai_decision_log_status ON ai_decision_log(status);
    `;
    await client.query(createTableQuery);
    client.release();
    console.log("✓ AI Decision Log table initialized");
    return true;
  } catch (error) {
    console.error("✗ Failed to initialize AI Decision Log table:", error.message);
    return false;
  }
}

/**
 * Initialize AI detected changes table
 * Stores patterns and changes detected by AI
 */
export async function initializeAIDetectedChangesTable() {
  try {
    const client = await pool.connect();
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ai_detected_changes (
        id SERIAL PRIMARY KEY,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        description TEXT NOT NULL,
        details TEXT,
        confidence VARCHAR(20) CHECK (confidence IN ('high', 'medium', 'low')),
        campaign_id BIGINT,
        pattern_type VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_ai_detected_changes_confidence ON ai_detected_changes(confidence);
      CREATE INDEX IF NOT EXISTS idx_ai_detected_changes_date ON ai_detected_changes(date);
      CREATE INDEX IF NOT EXISTS idx_ai_detected_changes_campaign_id ON ai_detected_changes(campaign_id);
    `;
    await client.query(createTableQuery);
    client.release();
    console.log("✓ AI Detected Changes table initialized");
    return true;
  } catch (error) {
    console.error("✗ Failed to initialize AI Detected Changes table:", error.message);
    return false;
  }
}

/**
 * Initialize recommended actions table
 * Stores AI-recommended actions to be executed
 */
export async function initializeRecommendedActionsTable() {
  try {
    const client = await pool.connect();
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS recommended_actions (
        id SERIAL PRIMARY KEY,
        type VARCHAR(100) NOT NULL,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        campaign_id BIGINT,
        campaign_name VARCHAR(500),
        scheduled_time VARCHAR(20) DEFAULT '3:00 AM',
        status VARCHAR(50) DEFAULT 'pending',
        action_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        executed_at TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_recommended_actions_status ON recommended_actions(status);
      CREATE INDEX IF NOT EXISTS idx_recommended_actions_campaign_id ON recommended_actions(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_recommended_actions_created_at ON recommended_actions(created_at);
    `;
    await client.query(createTableQuery);
    client.release();
    console.log("✓ Recommended Actions table initialized");
    return true;
  } catch (error) {
    console.error("✗ Failed to initialize Recommended Actions table:", error.message);
    return false;
  }
}

/**
 * Store AI decision in the database
 */
export async function storeAIDecision(decision) {
  try {
    const client = await pool.connect();
    const insertQuery = `
      INSERT INTO ai_decision_log (
        timestamp, campaign_id, campaign_name, action_type, 
        what_changed, reason, status, old_value, new_value, 
        confidence, ai_mode
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *;
    `;
    const result = await client.query(insertQuery, [
      decision.timestamp || new Date(),
      decision.campaignId || null,
      decision.campaignName || null,
      decision.actionType || null,
      decision.whatChanged || null,
      decision.reason || null,
      decision.status || 'pending',
      JSON.stringify(decision.oldValue || {}),
      JSON.stringify(decision.newValue || {}),
      decision.confidence || null,
      decision.aiMode || 'analytical'
    ]);
    client.release();
    return result.rows[0];
  } catch (error) {
    console.error("✗ Failed to store AI decision:", error.message);
    throw error;
  }
}

/**
 * Get AI decision log from database
 */
export async function getAIDecisionLog(queryParams = {}) {
  try {
    const client = await pool.connect();
    let query = "SELECT * FROM ai_decision_log WHERE 1=1";
    const params = [];
    let paramCount = 1;

    if (queryParams.campaignId) {
      query += ` AND campaign_id = $${paramCount++}`;
      params.push(queryParams.campaignId);
    }

    if (queryParams.startDate) {
      query += ` AND timestamp >= $${paramCount++}`;
      params.push(queryParams.startDate);
    }

    if (queryParams.endDate) {
      query += ` AND timestamp <= $${paramCount++}`;
      params.push(queryParams.endDate);
    }

    if (queryParams.status) {
      query += ` AND status = $${paramCount++}`;
      params.push(queryParams.status);
    }

    query += " ORDER BY timestamp DESC";

    // Handle limit
    if (queryParams.limit && queryParams.limit !== 'all' && queryParams.limit !== '0') {
      const limit = parseInt(queryParams.limit) || 100;
      query += ` LIMIT $${paramCount++}`;
      params.push(limit);
    }

    if (queryParams.offset) {
      query += ` OFFSET $${paramCount++}`;
      params.push(parseInt(queryParams.offset) || 0);
    }

    const result = await client.query(query, params);
    const totalCountResult = await client.query("SELECT COUNT(*) FROM ai_decision_log");
    const totalCount = parseInt(totalCountResult.rows[0].count);

    client.release();
    return {
      decisions: result.rows.map(row => ({
        ...row,
        oldValue: row.old_value ? JSON.parse(row.old_value) : null,
        newValue: row.new_value ? JSON.parse(row.new_value) : null
      })),
      totalCount
    };
  } catch (error) {
    console.error("✗ Failed to get AI decision log:", error.message);
    throw error;
  }
}

/**
 * Store AI detected change
 */
export async function storeAIDetectedChange(change) {
  try {
    const client = await pool.connect();
    const insertQuery = `
      INSERT INTO ai_detected_changes (
        date, description, details, confidence, campaign_id, pattern_type
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const result = await client.query(insertQuery, [
      change.date || new Date(),
      change.description,
      change.details || null,
      change.confidence || 'medium',
      change.campaignId || null,
      change.patternType || null
    ]);
    client.release();
    return result.rows[0];
  } catch (error) {
    console.error("✗ Failed to store AI detected change:", error.message);
    throw error;
  }
}

/**
 * Get AI detected changes from database
 */
export async function getAIDetectedChanges(queryParams = {}) {
  try {
    const client = await pool.connect();
    let query = "SELECT * FROM ai_detected_changes WHERE 1=1";
    const params = [];
    let paramCount = 1;

    if (queryParams.confidence && queryParams.confidence !== 'all') {
      query += ` AND confidence = $${paramCount++}`;
      params.push(queryParams.confidence);
    }

    if (queryParams.campaignId) {
      query += ` AND campaign_id = $${paramCount++}`;
      params.push(queryParams.campaignId);
    }

    query += " ORDER BY date DESC";

    if (queryParams.limit && queryParams.limit !== 'all' && queryParams.limit !== '0') {
      const limit = parseInt(queryParams.limit) || 100;
      query += ` LIMIT $${paramCount++}`;
      params.push(limit);
    }

    const result = await client.query(query, params);
    client.release();
    return result.rows;
  } catch (error) {
    console.error("✗ Failed to get AI detected changes:", error.message);
    throw error;
  }
}

/**
 * Store recommended action
 */
export async function storeRecommendedAction(action) {
  try {
    const client = await pool.connect();
    const insertQuery = `
      INSERT INTO recommended_actions (
        type, title, description, campaign_id, campaign_name, 
        scheduled_time, status, action_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    const result = await client.query(insertQuery, [
      action.type,
      action.title,
      action.description || null,
      action.campaignId || null,
      action.campaignName || null,
      action.scheduledTime || '3:00 AM',
      action.status || 'pending',
      JSON.stringify(action.actionData || {})
    ]);
    client.release();
    return result.rows[0];
  } catch (error) {
    console.error("✗ Failed to store recommended action:", error.message);
    throw error;
  }
}

/**
 * Get recommended actions from database
 */
export async function getRecommendedActions(queryParams = {}) {
  try {
    const client = await pool.connect();
    let query = "SELECT * FROM recommended_actions WHERE 1=1";
    const params = [];
    let paramCount = 1;

    if (queryParams.status) {
      query += ` AND status = $${paramCount++}`;
      params.push(queryParams.status);
    }

    query += " ORDER BY created_at DESC";

    if (queryParams.limit && queryParams.limit !== 'all' && queryParams.limit !== '0') {
      const limit = parseInt(queryParams.limit) || 100;
      query += ` LIMIT $${paramCount++}`;
      params.push(limit);
    }

    const result = await client.query(query, params);
    client.release();
    return result.rows.map(row => ({
      ...row,
      actionData: row.action_data ? JSON.parse(row.action_data) : null
    }));
  } catch (error) {
    console.error("✗ Failed to get recommended actions:", error.message);
    throw error;
  }
}

/**
 * Update recommended action status
 */
export async function updateRecommendedActionStatus(actionId, status, executedAt = null) {
  try {
    const client = await pool.connect();
    const updateQuery = `
      UPDATE recommended_actions 
      SET status = $1, executed_at = $2
      WHERE id = $3
      RETURNING *;
    `;
    const result = await client.query(updateQuery, [
      status,
      executedAt || new Date(),
      actionId
    ]);
    client.release();
    return result.rows[0];
  } catch (error) {
    console.error("✗ Failed to update recommended action status:", error.message);
    throw error;
  }
}

// Export pool for advanced use cases if needed
export { pool };

