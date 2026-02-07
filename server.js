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

// Initialize database table (snake_case)
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
    console.log('Database table initialized (snake_case)');
  } catch (err) {
    console.error('Error initializing database:', err);
  } finally {
    client.release();
  }
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

app.get('/', (req, res) => {
  res.json({ status: 'BagelBot backend is running' });
});

app.listen(port, async () => {
  console.log(`Server running on port ${port}`);
  await initDatabase();
});
