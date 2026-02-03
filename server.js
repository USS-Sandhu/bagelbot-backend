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
       await client.query(`
         CREATE TABLE IF NOT EXISTS entries (
           id SERIAL PRIMARY KEY,
           message TEXT NOT NULL,
           status VARCHAR(20) DEFAULT 'New',
           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
         )
       `);
       console.log('Database table initialized');
     } catch (err) {
       console.error('Error initializing database:', err);
     } finally {
       client.release();
     }
   }

   // Routes

   // POST /submit - Receive form data
   app.post('/submit', async (req, res) => {
     try {
       const { message } = req.body;
       
       if (!message) {
         return res.status(400).json({ error: 'Message is required' });
       }

       const result = await pool.query(
         'INSERT INTO entries (message, status) VALUES ($1, $2) RETURNING *',
         [message, 'New']
       );

       res.json({ success: true, entry: result.rows[0] });
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

   // Health check
   app.get('/', (req, res) => {
     res.json({ status: 'BagelBot backend is running' });
   });

   // Start server
   app.listen(port, async () => {
     console.log(`Server running on port ${port}`);
     await initDatabase();
   });
```

   **.gitignore**:
```
   node_modules/
   .env