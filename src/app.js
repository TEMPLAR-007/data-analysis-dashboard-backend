require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { uploadRoutes } = require('./routes/upload.routes');
const { queryRoutes } = require('./routes/query.routes');
const { tableRoutes } = require('./routes/table.routes');
const analysisRoutes = require('./routes/analysis.routes');
const cleanupRoutes = require('./routes/cleanup.routes');
const runMigrations = require('./database/migrate');
const { pool } = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database and run migrations
async function initializeDatabase() {
    try {
        // Test database connection
        await pool.connect();
        console.log('Database connection established');

        // Run migrations
        await runMigrations();
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Failed to initialize database:', error);
        process.exit(1);
    }
}

// Routes
app.use('/api/upload', uploadRoutes);
app.use('/api/query', queryRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/analyze', analysisRoutes);
app.use('/api/cleanup', cleanupRoutes);

// Health check route
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Server is running' });
});

// Start server
app.listen(PORT, async () => {
    await initializeDatabase();
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;