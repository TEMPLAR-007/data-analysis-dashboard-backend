const { Pool } = require('pg');

// Create a pool
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'business_data',
    password: 'postgres',  // Add your actual password here
    port: 5432,
});

// Connect function
const dbConnect = async () => {
    try {
        await pool.connect();
        console.log('Connected to PostgreSQL database');
    } catch (error) {
        console.error('Error connecting to database:', error);
        process.exit(1);
    }
};

// Query function
const query = async (text, params) => {
    try {
        const result = await pool.query(text, params);
        return result;
    } catch (error) {
        console.error('Error executing query:', error);
        throw error;
    }
};

// Check if a table exists
const tableExists = async (tableName) => {
    try {
        const result = await query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = $1
            )
        `, [tableName]);

        return result.rows[0].exists;
    } catch (error) {
        console.error(`Error checking if table ${tableName} exists:`, error);
        throw error;
    }
};

// Create table
const createTable = async (tableName, columns) => {
    try {
        // First check if the table already exists to avoid duplicate logs
        const exists = await tableExists(tableName);
        if (exists) {
            // If we get here, it means we've deliberately decided to recreate the table
            // (the check/drop in the controller already happened)
            console.log(`Recreating table ${tableName}`);
        }

        // Sanitize column names to ensure they're valid PostgreSQL identifiers
        const sanitizedColumns = columns.map(col => ({
            ...col,
            name: col.name.replace(/[^\w\s]/g, '_')
        }));

        const columnDefinitions = sanitizedColumns.map(col => {
            // Add quotes to column names to handle spaces and special characters
            const columnName = `"${col.name}"`;

            // Use proper PostgreSQL types
            let columnType = col.type;

            // Handle specific numeric types more explicitly
            if (columnType === 'NUMERIC') {
                // For price/cost columns, use numeric with precision
                if (col.name.toLowerCase().includes('price') ||
                    col.name.toLowerCase().includes('cost') ||
                    col.name.toLowerCase().includes('total') ||
                    col.name.toLowerCase().includes('amount')) {
                    columnType = 'NUMERIC(15,2)';
                }
            }

            return `${columnName} ${columnType}`;
        }).join(', ');

        // Create the table (using CREATE TABLE without IF NOT EXISTS to catch errors better)
        // We're handling existence check separately now
        const createTableQuery = `
            CREATE TABLE ${tableName} (
                ${columnDefinitions}
            )
        `;

        await query(createTableQuery);
        console.log(`Table ${tableName} created successfully`);
        return true;
    } catch (error) {
        console.error(`Error creating table ${tableName}:`, error);
        return false;
    }
};

// Get table schema
const getTableSchema = async (tableName) => {
    try {
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = $1
        `, [tableName]);
        return result.rows;
    } catch (error) {
        console.error('Error fetching table schema:', error);
        throw error;
    }
};

// Get sample data
const getSampleData = async (tableName, limit = 5) => {
    try {
        const result = await query(`SELECT * FROM ${tableName} LIMIT $1`, [limit]);
        return result.rows;
    } catch (error) {
        console.error(`Error getting sample data for table ${tableName}:`, error);
        throw error;
    }
};

module.exports = {
    dbConnect,
    query,
    createTable,
    getTableSchema,
    getSampleData,
    tableExists,
    pool
};