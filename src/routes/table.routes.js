const express = require('express');
const router = express.Router();
const { pool } = require('../utils/db');

// Get all tables
router.get('/', async (req, res) => {
    try {
        const query = `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
        `;
        const result = await pool.query(query);
        res.json({ success: true, tables: result.rows });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error fetching tables',
            details: error.message
        });
    }
});

// Get table details
router.get('/:tableName', async (req, res) => {
    try {
        const { tableName } = req.params;
        const query = `
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = $1
        `;
        const result = await pool.query(query, [tableName]);
        res.json({ success: true, schema: result.rows });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error fetching table details',
            details: error.message
        });
    }
});

// Delete table
router.delete('/:tableName', async (req, res) => {
    try {
        const { tableName } = req.params;
        const query = `DROP TABLE IF EXISTS "${tableName}"`;
        await pool.query(query);
        res.json({
            success: true,
            message: `Table ${tableName} deleted successfully`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error deleting table',
            details: error.message
        });
    }
});

module.exports = { tableRoutes: router };