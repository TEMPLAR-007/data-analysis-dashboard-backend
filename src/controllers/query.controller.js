const { pool, getTableSchema } = require('../utils/db');
const { generateSQL, formatQueryResults, fixSqlQuery } = require('../utils/openai');
const analysisController = require('./analysis.controller');

// Validate SQL query against specific rules
const validateSqlQuery = (sqlQuery) => {
    // Check if the query is SELECT only
    if (!sqlQuery.trim().toLowerCase().startsWith('select')) {
        return {
            valid: false,
            message: 'Only SELECT queries are allowed'
        };
    }

    // Check for SQL injection attempts
    const dangerousKeywords = [
        'insert', 'update', 'delete', 'drop', 'alter', 'create',
        'truncate', 'exec', 'execute', 'union', '--'
    ];

    const hasInjectionAttempt = dangerousKeywords.some(keyword =>
        sqlQuery.toLowerCase().includes(keyword)
    );

    if (hasInjectionAttempt) {
        return {
            valid: false,
            message: 'Query contains disallowed SQL keywords'
        };
    }

    // Check for basic syntax issues
    if (sqlQuery.includes('_FROM"') || sqlQuery.includes('"FROM')) {
        return {
            valid: false,
            message: 'Query contains syntax error with FROM clause'
        };
    }

    // Verify complete query structure
    if (!sqlQuery.toLowerCase().includes('from')) {
        return {
            valid: false,
            message: 'Query is missing FROM clause'
        };
    }

    return { valid: true };
};

// Execute SQL query safely with additional checks
const safeExecuteQuery = async (sqlQuery, tableSchema, tableName) => {
    try {
        console.log('Original SQL query:', sqlQuery);

        // Additional syntax check for common errors
        if (sqlQuery.includes('"_')) {
            sqlQuery = sqlQuery.replace(/"\_(.*?)"/g, '"$1"');
            console.log('Fixed underscore in quotes:', sqlQuery);
        }

        // Remove any trailing semicolons to avoid multi-statement execution
        sqlQuery = sqlQuery.trim().replace(/;+$/, '');

        // Validation
        const validation = validateSqlQuery(sqlQuery);
        if (!validation.valid) {
            console.error('SQL validation failed:', validation.message);
            throw new Error(`Invalid SQL query: ${validation.message}`);
        }

        // Execute the query
        console.log('Executing SQL query:', sqlQuery);
        const result = await pool.query(sqlQuery);
        console.log(`Query executed successfully. Rows returned: ${result.rows.length}`);
        return result;
    } catch (error) {
        // Check for specific PostgreSQL errors and provide clearer messages
        if (error.code === '42601') { // syntax error
            console.error('SQL syntax error:', error.message);

            // Try to extract position information for better debugging
            const position = error.position;
            if (position && sqlQuery) {
                const errorContext = sqlQuery.substring(
                    Math.max(0, parseInt(position) - 15),
                    Math.min(sqlQuery.length, parseInt(position) + 15)
                );
                console.error(`Error near: ...${errorContext}...`);
                console.error(`Error position: ${position}`);
            }
        } else if (error.code === '42P01') { // undefined table
            console.error('Table does not exist:', error.message);
        } else if (error.code === '42703') { // undefined column
            console.error('Column does not exist:', error.message);
        }

        throw error;
    }
};

// Get sample data for better context
const getSampleData = async (tableName, limit = 5) => {
    try {
        const sampleQuery = `SELECT * FROM "${tableName}" LIMIT $1`;
        const result = await pool.query(sampleQuery, [limit]);
        return result.rows;
    } catch (error) {
        console.error('Error getting sample data:', error);
        throw error;
    }
};

// Process natural language query
const processQuery = async (req, res) => {
    try {
        // Accept either query or userQuery (for backward compatibility)
        const { query, userQuery, tableName } = req.body;
        const userQueryText = query || userQuery;

        if (!userQueryText) {
            return res.status(400).json({
                success: false,
                message: 'Query is required'
            });
        }

        console.log(`Processing query: "${userQueryText}"`);

        // If tableName is not provided, we need to find suitable tables
        if (!tableName) {
            console.log('No table specified, searching for suitable tables');

            // Get all available tables, excluding system tables
            const tablesResult = await pool.query(`
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_type = 'BASE TABLE'
                AND table_name NOT IN ('migrations', 'saved_queries', 'analysis_sessions', 'uploaded_files')
            `);

            if (tablesResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'No data tables available in the database. Please upload data first.'
                });
            }

            // If there's only one table, use it
            if (tablesResult.rows.length === 1) {
                const autoSelectedTable = tablesResult.rows[0].table_name;
                console.log(`Only one data table available, auto-selecting: ${autoSelectedTable}`);
                return processWithTable(req, res, userQueryText, autoSelectedTable);
            }

            // Try to find the most relevant table for the query
            // Get schemas for all tables to look for relevance
            const tableNames = tablesResult.rows.map(row => row.table_name);
            const relevanceScores = {};

            // Simple relevance scoring - check if query contains table name or column names
            for (const table of tableNames) {
                let score = 0;

                // Table name match (e.g., "sales" in "show me sales data")
                const tableWords = table.replace(/_/g, ' ').split(' ');
                for (const word of tableWords) {
                    if (word.length > 3 && userQueryText.toLowerCase().includes(word.toLowerCase())) {
                        score += 10;
                    }
                }

                // Get sample data to understand table content
                try {
                    const sampleData = await getSampleData(table, 1);
                    if (sampleData && sampleData.length > 0) {
                        // Check if sample data contains relevant information (e.g., product names)
                        const dataValues = Object.values(sampleData[0]).filter(val => typeof val === 'string');
                        for (const val of dataValues) {
                            if (val && val.length > 3 && userQueryText.toLowerCase().includes(val.toLowerCase())) {
                                score += 15; // Higher weight for actual data matches
                            }
                        }
                    }
                } catch (error) {
                    console.log(`Error getting sample data for ${table}:`, error.message);
                }

                // Get columns for this table to check for column matches
                const schemaResult = await pool.query(`
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                    AND table_name = $1
                `, [table]);

                // Keywords that indicate business data tables
                const businessKeywords = ['product', 'sale', 'order', 'customer', 'price', 'quantity', 'inventory', 'item'];

                for (const column of schemaResult.rows) {
                    // Check for column name match in query
                    if (userQueryText.toLowerCase().includes(column.column_name.toLowerCase())) {
                        score += 5;
                    }

                    // Business-related column names get bonus points
                    for (const keyword of businessKeywords) {
                        if (column.column_name.toLowerCase().includes(keyword)) {
                            score += 3;
                        }
                    }
                }

                relevanceScores[table] = score;
            }

            console.log('Table relevance scores:', relevanceScores);

            // Sort tables by relevance score
            const sortedTables = Object.entries(relevanceScores)
                .sort((a, b) => b[1] - a[1]);

            // If we have a clear winner with a non-zero score, use it
            if (sortedTables.length > 0 && sortedTables[0][1] > 0) {
                const bestTable = sortedTables[0][0];
                console.log(`Selected most relevant table: ${bestTable} with score ${sortedTables[0][1]}`);
                return processWithTable(req, res, userQueryText, bestTable);
            }

            // If no clear relevance, prioritize tables with business-like names
            // rather than just picking the first table alphabetically
            for (const tableName of tableNames) {
                const lowerTableName = tableName.toLowerCase();
                if (
                    lowerTableName.includes('sales') ||
                    lowerTableName.includes('order') ||
                    lowerTableName.includes('product') ||
                    lowerTableName.includes('customer') ||
                    lowerTableName.includes('inventory') ||
                    lowerTableName.includes('business')
                ) {
                    console.log(`No clear relevance, but found business table: ${tableName}`);
                    return processWithTable(req, res, userQueryText, tableName);
                }
            }

            // If still no match, use the first table as default
            const defaultTable = tableNames[0];
            console.log(`No clear table relevance, using default table: ${defaultTable}`);
            return processWithTable(req, res, userQueryText, defaultTable);
        }

        // If tableName is provided, use it directly
        return processWithTable(req, res, userQueryText, tableName);
    } catch (error) {
        console.error('Error executing query:', error);
        return res.status(500).json({
            success: false,
            message: `Error executing query: ${error.message}`
        });
    }
};

// Helper function to process a query with a specific table
const processWithTable = async (req, res, userQueryText, tableName) => {
    try {
        console.log(`Processing query for table: ${tableName}`);

        // Get table schema and sample data for context
        const tableSchema = await getTableSchema(tableName);
        const sampleData = await getSampleData(tableName);

        if (tableSchema.length === 0) {
            return res.status(404).json({
                success: false,
                message: `Table '${tableName}' not found or has no columns`
            });
        }

        console.log(`Got table schema with ${tableSchema.length} columns and ${sampleData.length} sample rows`);

        // Generate SQL from natural language
        const sqlQuery = await generateSQL(userQueryText, tableSchema, sampleData, tableName);
        console.log('Generated SQL query:', sqlQuery);

        // Execute the generated SQL
        const queryResult = await safeExecuteQuery(sqlQuery, tableSchema, tableName);

        // Save query results for Phase 2 analysis
        const queryId = await analysisController.saveQueryResults(
            tableName,
            userQueryText,
            sqlQuery,
            queryResult.rows
        );

        // Format the results
        const formattedResults = formatQueryResults(userQueryText, queryResult);

        // Add query ID to response
        formattedResults.query_id = queryId;

        // Return the results
        return res.status(200).json({
            success: true,
            query: sqlQuery,
            original_query: userQueryText,
            selected_table: tableName,
            ...formattedResults
        });
    } catch (error) {
        console.error('Error executing query:', error);
        return res.status(500).json({
            success: false,
            message: `Error executing query: ${error.message}`
        });
    }
};

// Get table schema
const getSchema = async (req, res) => {
    try {
        const { tableName } = req.params;

        if (!tableName) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        // Get table schema
        const tableSchema = await getTableSchema(tableName);

        if (!tableSchema || tableSchema.length === 0) {
            return res.status(404).json({ error: `Table '${tableName}' not found` });
        }

        return res.status(200).json({
            table_name: tableName,
            columns: tableSchema
        });
    } catch (error) {
        console.error('Error getting schema:', error);
        return res.status(500).json({ error: error.message });
    }
};

// Execute raw SQL query (for development/testing)
const executeRawQuery = async (req, res) => {
    try {
        const { sqlQuery, tableName } = req.body;

        if (!sqlQuery) {
            return res.status(400).json({ error: 'SQL query is required' });
        }

        console.log(`Executing raw SQL query: ${sqlQuery}`);

        // Get table schema if tableName is provided
        let tableSchema = null;
        if (tableName) {
            try {
                tableSchema = await getTableSchema(tableName);
                validateSqlQuery(sqlQuery);
            } catch (validationError) {
                return res.status(400).json({ error: validationError.message });
            }
        }

        // Execute the SQL query with timeout
        let queryResult;
        try {
            queryResult = await safeExecuteQuery(sqlQuery, tableSchema, tableName);
        } catch (error) {
            return res.status(400).json({
                error: `Error executing SQL query: ${error.message}`,
                sql_query: sqlQuery
            });
        }

        return res.status(200).json({
            sql_query: sqlQuery,
            rows: queryResult.rows,
            rowCount: queryResult.rowCount
        });
    } catch (error) {
        console.error('Error executing raw query:', error);
        return res.status(500).json({ error: error.message });
    }
};

// Delete a saved query by ID
const deleteSavedQuery = async (req, res) => {
    try {
        const { queryId } = req.params;

        if (!queryId) {
            return res.status(400).json({
                success: false,
                message: 'Query ID is required'
            });
        }

        console.log(`Attempting to delete query with ID: ${queryId}`);

        // Check if the query exists first
        const checkQuery = await pool.query(
            'SELECT id FROM saved_queries WHERE id = $1',
            [queryId]
        );

        if (checkQuery.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: `Query with ID ${queryId} not found`
            });
        }

        // Delete the query
        await pool.query(
            'DELETE FROM saved_queries WHERE id = $1',
            [queryId]
        );

        return res.status(200).json({
            success: true,
            message: `Query with ID ${queryId} has been deleted successfully`
        });
    } catch (error) {
        console.error('Error deleting query:', error);
        return res.status(500).json({
            success: false,
            message: `Error deleting query: ${error.message}`
        });
    }
};

// Get all saved queries with optional filters
const getAllSavedQueries = async (req, res) => {
    try {
        // Extract query parameters for filtering
        const { table, limit = 100, offset = 0, sortBy = 'created_at', sortDir = 'desc' } = req.query;

        // Validate sort direction
        if (!['asc', 'desc'].includes(sortDir.toLowerCase())) {
            return res.status(400).json({
                success: false,
                message: "Sort direction must be 'asc' or 'desc'"
            });
        }

        // Validate sorting column
        const validSortColumns = ['created_at', 'table_name', 'original_query'];
        if (!validSortColumns.includes(sortBy)) {
            return res.status(400).json({
                success: false,
                message: `Sort column must be one of: ${validSortColumns.join(', ')}`
            });
        }

        // Build the query
        let queryText = `
            SELECT id, table_name, original_query, sql_query, created_at,
                   jsonb_array_length(results) as result_count
            FROM saved_queries
        `;

        const queryParams = [];
        let paramCounter = 1;

        // Add table filter if provided
        if (table) {
            queryText += ` WHERE table_name = $${paramCounter}`;
            queryParams.push(table);
            paramCounter++;
        }

        // Add sorting and pagination
        queryText += ` ORDER BY ${sortBy} ${sortDir.toUpperCase()}
                       LIMIT $${paramCounter} OFFSET $${paramCounter + 1}`;
        queryParams.push(parseInt(limit), parseInt(offset));

        // Execute query
        const result = await pool.query(queryText, queryParams);

        // Get total count for pagination
        let countResult;
        if (table) {
            countResult = await pool.query(
                'SELECT COUNT(*) FROM saved_queries WHERE table_name = $1',
                [table]
            );
        } else {
            countResult = await pool.query('SELECT COUNT(*) FROM saved_queries');
        }

        const totalQueries = parseInt(countResult.rows[0].count);

        // Format the response
        return res.status(200).json({
            success: true,
            queries: result.rows.map(row => ({
                id: row.id,
                table_name: row.table_name,
                original_query: row.original_query,
                sql_query: row.sql_query,
                result_count: row.result_count,
                created_at: row.created_at
            })),
            pagination: {
                total: totalQueries,
                limit: parseInt(limit),
                offset: parseInt(offset),
                has_more: totalQueries > (parseInt(offset) + result.rows.length)
            }
        });
    } catch (error) {
        console.error('Error fetching saved queries:', error);
        return res.status(500).json({
            success: false,
            message: `Error fetching saved queries: ${error.message}`
        });
    }
};

// Get a specific saved query by ID
const getSavedQueryById = async (req, res) => {
    try {
        const { queryId } = req.params;

        if (!queryId) {
            return res.status(400).json({
                success: false,
                message: 'Query ID is required'
            });
        }

        console.log(`Fetching query with ID: ${queryId}`);

        // Get query details including results
        const queryResult = await pool.query(
            `SELECT id, table_name, original_query, sql_query, results, metadata, created_at
             FROM saved_queries
             WHERE id = $1`,
            [queryId]
        );

        if (queryResult.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: `Query with ID ${queryId} not found`
            });
        }

        const query = queryResult.rows[0];

        // Format the results similar to how processQuery does it
        // This creates the same structure with chart_data, answer, etc.
        const formattedResults = formatQueryResults(query.original_query, {
            rows: query.results
        });

        // Format the response with both raw and formatted data
        return res.status(200).json({
            success: true,
            query: {
                id: query.id,
                table_name: query.table_name,
                original_query: query.original_query,
                sql_query: query.sql_query,
                results: query.results,
                metadata: query.metadata,
                created_at: query.created_at
            },
            // Include the same fields that processQuery returns
            answer: formattedResults.answer,
            filtered_data: formattedResults.filtered_data,
            chart_data: formattedResults.chart_data,
            source: 'sql',
            query_id: query.id
        });
    } catch (error) {
        console.error(`Error fetching query ${req.params.queryId}:`, error);
        return res.status(500).json({
            success: false,
            message: `Error fetching query: ${error.message}`
        });
    }
};

module.exports = {
    processQuery,
    getSchema,
    executeRawQuery,
    processWithTable,
    deleteSavedQuery,
    getAllSavedQueries,
    getSavedQueryById
};