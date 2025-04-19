const { parseFile } = require('../utils/parser');
const { createTable, query, tableExists, pool, getTableSchema, getSampleData } = require('../utils/db');
const fs = require('fs');
const path = require('path');

// Handle file upload
const uploadFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { originalname, path: filePath } = req.file;
        let tableName = req.body.tableName;

        // If no table name provided, use the file name without extension
        if (!tableName) {
            tableName = originalname.split('.')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_');
        }

        // Check if table already exists and handle overwrite option
        const overwrite = req.body.overwrite === 'true' || req.body.overwrite === true;
        const exists = await tableExists(tableName);

        if (exists && !overwrite) {
            fs.unlinkSync(filePath); // Clean up uploaded file
            return res.status(409).json({
                error: `Table '${tableName}' already exists. Set 'overwrite=true' to replace it.`,
                tableExists: true,
                tableName
            });
        } else if (exists && overwrite) {
            // Drop the existing table if overwrite is requested
            await dropTable(tableName);
        }

        // Parse file to get data and inferred schema
        const { data, columns } = await parseFile(filePath);

        if (!data || data.length === 0) {
            fs.unlinkSync(filePath); // Clean up uploaded file
            return res.status(400).json({ error: 'File is empty or could not be parsed' });
        }

        // Create table in PostgreSQL
        const tableCreated = await createTable(tableName, columns);

        if (!tableCreated) {
            fs.unlinkSync(filePath); // Clean up uploaded file
            return res.status(500).json({ error: 'Failed to create table in database' });
        }

        // Insert data into the table
        const { insertCount, errorCount } = await insertData(tableName, columns, data);

        // Clean up uploaded file
        fs.unlinkSync(filePath);

        return res.status(200).json({
            success: true,
            message: `File uploaded and processed. Created table '${tableName}' with ${insertCount} rows inserted and ${errorCount} rows skipped due to errors.`,
            tableName,
            rowCount: insertCount,
            errorCount: errorCount,
            columns: columns.map(col => ({ name: col.name, type: col.type }))
        });
    } catch (error) {
        console.error('Error uploading file:', error);

        // Clean up uploaded file if it exists
        if (req.file && req.file.path) {
            fs.unlinkSync(req.file.path);
        }

        return res.status(500).json({ error: error.message });
    }
};

// Drop an existing table
const dropTable = async (tableName) => {
    try {
        await query(`DROP TABLE IF EXISTS ${tableName}`);
        console.log(`Table ${tableName} dropped`);
        return true;
    } catch (error) {
        console.error(`Error dropping table ${tableName}:`, error);
        throw error;
    }
};

// Delete a table endpoint
const deleteTable = async (req, res) => {
    try {
        const { tableName } = req.params;

        if (!tableName) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        // Check if table exists
        const exists = await tableExists(tableName);

        if (!exists) {
            return res.status(404).json({
                error: `Table '${tableName}' not found`,
                exists: false
            });
        }

        // Drop the table
        await dropTable(tableName);

        return res.status(200).json({
            success: true,
            message: `Table '${tableName}' has been deleted`
        });
    } catch (error) {
        console.error('Error deleting table:', error);
        return res.status(500).json({ error: error.message });
    }
};

// Get table details including schema and sample data
const getTableDetails = async (req, res) => {
    try {
        const { tableName } = req.params;

        if (!tableName) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        // Check if table exists
        const exists = await tableExists(tableName);

        if (!exists) {
            return res.status(404).json({
                error: `Table '${tableName}' not found`,
                exists: false
            });
        }

        // Get table schema
        const schema = await getTableSchema(tableName);

        // Get row count
        const countResult = await query(`SELECT COUNT(*) FROM ${tableName}`);
        const rowCount = parseInt(countResult.rows[0].count, 10);

        // Get sample data (5 rows by default)
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 5;
        const sampleData = await getSampleData(tableName, Math.min(limit, 100)); // Cap at 100 rows

        return res.status(200).json({
            tableName,
            schema,
            rowCount,
            sampleData
        });
    } catch (error) {
        console.error(`Error getting table details for ${req.params.tableName}:`, error);
        return res.status(500).json({ error: error.message });
    }
};

// Insert data into the table with improved error handling
const insertData = async (tableName, columns, data) => {
    let insertCount = 0;
    let errorCount = 0;

    // Using a client from the pool for transaction
    const client = await pool.connect();

    try {
        // Begin transaction
        await client.query('BEGIN');

        // Process in batches of 100 records
        const batchSize = 100;

        for (let i = 0; i < data.length; i += batchSize) {
            const batch = data.slice(i, i + batchSize);

            // Skip empty batches
            if (batch.length === 0) continue;

            // Generate column names for the query
            const columnNames = columns.map(col => `"${col.name}"`).join(', ');

            // For each record in the batch
            for (const record of batch) {
                try {
                    // Generate placeholders and values for the query
                    const placeholders = [];
                    const values = [];
                    let paramIndex = 1;

                    for (const col of columns) {
                        placeholders.push(`$${paramIndex}`);

                        // Handle value conversion based on column type
                        let value = record[col.name];

                        if (value === undefined || value === null || value === '') {
                            value = null;
                        } else if (col.type === 'NUMERIC' && typeof value === 'string') {
                            // Clean up currency formatting
                            value = value.replace(/[$,]/g, '');
                        } else if (col.type === 'INTEGER' && typeof value === 'string') {
                            // Convert to integer
                            value = parseInt(value, 10);
                        }

                        values.push(value);
                        paramIndex++;
                    }

                    // Construct and execute the query
                    const insertQuery = `
                        INSERT INTO ${tableName} (${columnNames})
                        VALUES (${placeholders.join(', ')})
                    `;

                    await client.query(insertQuery, values);
                    insertCount++;
                } catch (err) {
                    // Log the error but continue with next record
                    console.error(`Error inserting row ${i + insertCount + errorCount}:`, err.message);
                    errorCount++;
                }
            }
        }

        // Commit transaction
        await client.query('COMMIT');

        return { insertCount, errorCount };
    } catch (error) {
        // Rollback on error
        await client.query('ROLLBACK');
        console.error(`Error in batch insertion process for table ${tableName}:`, error);
        return { insertCount, errorCount };
    } finally {
        // Release client back to pool
        client.release();
    }
};

// List available tables
const listTables = async (req, res) => {
    try {
        const tablesQuery = `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
        `;

        const result = await query(tablesQuery);

        return res.status(200).json({
            tables: result.rows.map(row => row.table_name)
        });
    } catch (error) {
        console.error('Error listing tables:', error);
        return res.status(500).json({ error: error.message });
    }
};

module.exports = {
    uploadFile,
    listTables,
    deleteTable,
    getTableDetails
};