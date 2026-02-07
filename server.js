const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

// Initialize database tables (snake_case)
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS entries (
        id SERIAL PRIMARY KEY,
        order_number INTEGER,
        name VARCHAR(100),
        phone_number VARCHAR(20),
        message TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'New',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS store_status (
        id SERIAL PRIMARY KEY,
        store_closed BOOLEAN DEFAULT false,
        notes TEXT
      )
    `);
    
    console.log('Database tables initialized (snake_case)');
  } catch (err) {
    console.error('Error initializing database:', err);
  } finally {
    client.release();
  }
}

// API Key middleware for store-status endpoints
function checkApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const VALID_KEY = process.env.STORE_ADMIN_KEY || 'bagel2024secret';
  
  if (!apiKey || apiKey !== VALID_KEY) {
    return res.status(403).json({ error: 'Unauthorized - Invalid API key' });
  }
  next();
}

// Helper: YYYY-MM-DD (UTC-safe for Postgres DATE)
function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

// Helper: next order number (starts at 100 daily)
async function getNextOrderNumber() {
  try {
    const today = getTodayDateString();

    const result = await pool.query(
      `SELECT MAX(order_number) AS max_order
       FROM entries
       WHERE DATE(created_at) = $1`,
      [today]
    );

    const maxOrder = result.rows[0]?.max_order;

    if (maxOrder === null || maxOrder === undefined) {
      return 100;
    }

    const parsed = parseInt(String(maxOrder), 10);
    return Number.isFinite(parsed) ? parsed + 1 : 100;

  } catch (err) {
    console.error('Error getting next order number:', err);
    throw err;
  }
}

// ------------------------------------------------------------
// Routes
// ------------------------------------------------------------

// POST /submit
app.post('/submit', async (req, res) => {
  try {
    const { name, phoneNumber, message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const orderNumber = await getNextOrderNumber();

    const result = await pool.query(
      `INSERT INTO entries
       (order_number, name, phone_number, message, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [orderNumber, name, phoneNumber, message, 'New']
    );

    const row = result.rows[0];

    // IMPORTANT: return REAL id + display orderNumber
    res.json({
      success: true,
      entry: {
        id: row.order_number, // Frontend expects orderNumber as id
        orderNumber: row.order_number,
        name: row.name,
        phoneNumber: row.phone_number,
        message: row.message,
        status: row.status,
        created_at: row.created_at
      }
    });

  } catch (err) {
    console.error('Error submitting entry:', err);
    res.status(500).json({ error: 'Failed to submit entry' });
  }
});

// GET /entries
app.get('/entries', async (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT
        id,
        order_number AS "orderNumber",
        name,
        phone_number AS "phoneNumber",
        message,
        status,
        created_at
      FROM entries
    `;
    const params = [];

    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json({ entries: result.rows });

  } catch (err) {
    console.error('Error fetching entries:', err);
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
});

// PUT /entries/:id/status
app.put('/entries/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const result = await pool.query(
      `UPDATE entries
       SET status = $1
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    const row = result.rows[0];

    res.json({
      success: true,
      entry: {
        id: row.id,
        orderNumber: row.order_number,
        name: row.name,
        phoneNumber: row.phone_number,
        message: row.message,
        status: row.status,
        created_at: row.created_at
      }
    });

  } catch (err) {
    console.error('Error updating entry:', err);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

// Store status endpoint - GET (Protected with API key)
app.get('/store-status', checkApiKey, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT store_closed, notes FROM store_status LIMIT 1'
    );
    
    if (result.rows.length === 0) {
      // If no row exists, create the initial row
      await pool.query(
        'INSERT INTO store_status (store_closed, notes) VALUES ($1, $2)',
        [false, '']
      );
      return res.json({ store_closed: false, notes: '' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching store status:', err);
    res.status(500).json({ error: 'Failed to fetch store status' });
  }
});

// Store status endpoint - PUT (Protected with API key)
app.put('/store-status', checkApiKey, async (req, res) => {
  try {
    const { store_closed, notes } = req.body;
    
    // Check if a row exists
    const checkResult = await pool.query('SELECT id FROM store_status LIMIT 1');
    
    if (checkResult.rows.length === 0) {
      // Insert first row
      const result = await pool.query(
        'INSERT INTO store_status (store_closed, notes) VALUES ($1, $2) RETURNING *',
        [store_closed, notes || '']
      );
      res.json({ success: true, status: result.rows[0] });
    } else {
      // Update the existing row
      const result = await pool.query(
        'UPDATE store_status SET store_closed = $1, notes = $2 WHERE id = $3 RETURNING *',
        [store_closed, notes || '', checkResult.rows[0].id]
      );
      res.json({ success: true, status: result.rows[0] });
    }
  } catch (err) {
    console.error('Error updating store status:', err);
    res.status(500).json({ error: 'Failed to update store status' });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'BagelBot backend is running' });
});

app.listen(port, async () => {
  console.log(`Server running on port ${port}`);
  await initDatabase();
});
