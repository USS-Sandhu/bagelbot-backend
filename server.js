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
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database table
async function initDatabase() {
  const client = await pool.connect();
  try {
    // We use "phoneNumber" in double quotes to preserve camelCase in Postgres
    await client.query(`
      CREATE TABLE IF NOT EXISTS entries (
        id SERIAL PRIMARY KEY,
        "orderNumber" INTEGER,
        name VARCHAR(100),
        "phoneNumber" VARCHAR(20),
        message TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'New',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Database table initialized with Name and phoneNumber fields');
  } catch (err) {
    console.error('Error initializing database:', err);
  } finally {
    client.release();
  }
}

// Helper function to get today's date string (YYYY-MM-DD)
function getTodayDateString() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// Helper function to get next order number for today
async function getNextOrderNumber() {
  try {
    const today = getTodayDateString();

    const result = await pool.query(
      `SELECT MAX("orderNumber") AS max_order
       FROM entries
       WHERE DATE(created_at) = $1`,
      [today]
    );

    const maxOrder = result.rows[0]?.max_order;

    // IMPORTANT: force numeric addition
    return maxOrder !== null
      ? Number(maxOrder) + 1
      : 100;

  } catch (err) {
    console.error('Error getting next order number:', err);
    throw err;
  }
}

// Routes
// POST /submit - Receive form data
app.post('/submit', async (req, res) => {
  try {
    const { name, phoneNumber, message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get the next order number for today
    const orderNumber = await getNextOrderNumber();
    
    const result = await pool.query(
      'INSERT INTO entries ("orderNumber", name, "phoneNumber", message, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [orderNumber, name, phoneNumber, message, 'New']
    );
    
    // Return orderNumber as id for frontend compatibility
    res.json({ 
      success: true, 
      entry: { 
        ...result.rows[0],
        id: result.rows[0].orderNumber 
      } 
    });
  } catch (err) {
    console.error('Error submitting entry:', err);
    res.status(500).json({ error: 'Failed to submit entry' });
  }
});

// GET /entries - Get entries by status
app.get('/entries', async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM entries';
    let params = [];
    
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

// PUT /entries/:id/status - Update entry status
app.put('/entries/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }
    const result = await pool.query(
      'UPDATE entries SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    res.json({ success: true, entry: result.rows[0] });
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
