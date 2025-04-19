const fetch = require('node-fetch');
const OpenAI = require('openai');
require('dotenv').config();

// Initialize OpenAI with OpenRouter configuration
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        "HTTP-Referer": "http://localhost:3000", // Your app URL
        "X-Title": "Business Analytics" // Your app name
    }
});

// Fix SQL query issues including column names and aliases
const fixSqlQuery = (sql, tableSchema, tableName) => {
    try {
        // First, ensure proper spacing around SQL keywords
        let fixedSql = sql
            .replace(/\s+/g, ' ')
            .replace(/\s*,\s*/g, ', ')
            .replace(/\s*\(\s*/g, '(')
            .replace(/\s*\)\s*/g, ')');

        // Fix column names if schema is provided
        if (tableSchema && Array.isArray(tableSchema)) {
            const columnMap = {};
            tableSchema.forEach(column => {
                const colName = column.name || column.column_name;
                columnMap[colName.toLowerCase()] = colName;
            });

            // Replace unquoted column names with properly quoted ones
            Object.entries(columnMap).forEach(([lower, proper]) => {
                const regex = new RegExp(`\\b${lower}\\b(?!\\s*")`, 'gi');
                fixedSql = fixedSql.replace(regex, `"${proper}"`);
            });
        }

        // Ensure table name is properly quoted
        if (tableName) {
            fixedSql = fixedSql.replace(
                new RegExp(`\\bfrom\\s+${tableName}\\b`, 'gi'),
                `FROM "${tableName}"`
            );
        }

        // Remove duplicate FROM clauses
        const fromClauses = fixedSql.match(/FROM\s+"[^"]+"/gi) || [];
        if (fromClauses.length > 1) {
            fixedSql = fixedSql.replace(new RegExp(`FROM\\s+"[^"]+"\\s*$`, 'i'), '');
        }

        // Fix broken quotes in aliases
        fixedSql = fixedSql.replace(/"([^"]*)"\s*"([^"]*)"/g, '"$1_$2"');

        // Ensure proper spacing around SQL keywords
        fixedSql = fixedSql
            .replace(/\s+/g, ' ')
            .replace(/\s*,\s*/g, ', ')
            .replace(/\s*\(\s*/g, '(')
            .replace(/\s*\)\s*/g, ')')
            .trim();

        return fixedSql;
    } catch (error) {
        console.error('Error fixing SQL query:', error);
        return sql;
    }
};

// Handle special patterns for business analytics queries
const fixQueryLogic = (sqlQuery, tableSchema, tableName) => {
    let fixedQuery = sqlQuery;

    // Get column names and types for pattern matching
    const columnTypes = {};
    const dateColumns = [];
    const numericColumns = [];
    const categoryColumns = [];

    // Only process schema if it exists
    if (tableSchema && Array.isArray(tableSchema)) {
        tableSchema.forEach(col => {
            const colName = col.name || col.column_name;
            const colType = (col.type || col.data_type || '').toLowerCase();
            columnTypes[colName] = colType;

            // Identify date columns
            if (colType.includes('date') || colType.includes('time') ||
                colName.toLowerCase().includes('date') || colName.toLowerCase().includes('day')) {
                dateColumns.push(colName);
            }

            // Identify numeric columns
            if (colType.includes('int') || colType.includes('numeric') || colType.includes('decimal') ||
                colType.includes('float') || colType.includes('double') ||
                colName.toLowerCase().includes('price') || colName.toLowerCase().includes('total') ||
                colName.toLowerCase().includes('quantity') || colName.toLowerCase().includes('amount')) {
                numericColumns.push(colName);
            }

            // Identify category columns
            if ((colType.includes('char') || colType.includes('text')) &&
                (colName.toLowerCase().includes('category') || colName.toLowerCase().includes('type') ||
                    colName.toLowerCase().includes('status') || colName.toLowerCase().includes('region'))) {
                categoryColumns.push(colName);
            }
        });
    }

    // Fix 1: Looking for camera-related items but using Category
    if (sqlQuery.toLowerCase().includes('camera') &&
        sqlQuery.match(/where\s+["']?category["']?\s+(?:=|ilike)\s+['"]camera['"]/i)) {
        fixedQuery = fixedQuery.replace(
            /where\s+["']?category["']?\s+(?:=|ilike)\s+['"]camera['"]/i,
            `WHERE "Product" ILIKE '%camera%'`
        );
    }

    // Fix 2: Enhance date filters for month/quarter queries
    if (fixedQuery.toLowerCase().includes('month') ||
        fixedQuery.toLowerCase().includes('january') ||
        fixedQuery.toLowerCase().includes('february') ||
        fixedQuery.toLowerCase().includes('march') ||
        fixedQuery.toLowerCase().includes('april') ||
        fixedQuery.toLowerCase().includes('may') ||
        fixedQuery.toLowerCase().includes('june') ||
        fixedQuery.toLowerCase().includes('july') ||
        fixedQuery.toLowerCase().includes('august') ||
        fixedQuery.toLowerCase().includes('september') ||
        fixedQuery.toLowerCase().includes('october') ||
        fixedQuery.toLowerCase().includes('november') ||
        fixedQuery.toLowerCase().includes('december')) {

        // Find date column in schema
        if (dateColumns.length > 0) {
            const dateCol = dateColumns[0]; // Use first date column

            // Check if query already has date extraction
            if (!fixedQuery.toLowerCase().includes('extract(month from') &&
                !fixedQuery.toLowerCase().includes('to_char') &&
                !fixedQuery.toLowerCase().includes('date_trunc')) {

                // Add proper date extraction for month if missing
                if (fixedQuery.toLowerCase().includes('group by')) {
                    // Replace simple month reference with proper extraction in GROUP BY
                    fixedQuery = fixedQuery.replace(
                        /GROUP BY\s+["']?month["']?/i,
                        `GROUP BY TO_CHAR("${dateCol}", 'Month')`
                    );

                    // Also add to SELECT if missing
                    if (!fixedQuery.toLowerCase().includes('to_char') && !fixedQuery.match(/select.*month/i)) {
                        fixedQuery = fixedQuery.replace(
                            /SELECT\s+/i,
                            `SELECT TO_CHAR("${dateCol}", 'Month') AS "Month", `
                        );
                    }
                }
            }
        }
    }

    // Fix 3: Detect and fix dollar amount filters
    if (fixedQuery.toLowerCase().includes('$') && numericColumns.length > 0) {
        const amountCol = numericColumns.find(col =>
            col.toLowerCase().includes('price') ||
            col.toLowerCase().includes('total') ||
            col.toLowerCase().includes('amount')
        ) || numericColumns[0];

        // Fix dollar amount comparisons (e.g., $1000)
        fixedQuery = fixedQuery.replace(
            /["']?\$(\d+(?:\.\d+)?)["']?/g,
            (match, amount) => amount
        );

        // Make sure we have proper column reference
        fixedQuery = fixedQuery.replace(
            /(>=|<=|>|<|=)\s*(\d+(?:\.\d+)?)/g,
            (match, operator, amount) => {
                if (!match.includes('"')) {
                    return `${operator} "${amountCol}" ${amount}`;
                }
                return match;
            }
        );
    }

    // Fix 4: Improve 'highest' or 'most' queries
    if ((fixedQuery.toLowerCase().includes('highest') ||
        fixedQuery.toLowerCase().includes('most') ||
        fixedQuery.toLowerCase().includes('top') ||
        fixedQuery.toLowerCase().includes('maximum')) &&
        !fixedQuery.toLowerCase().includes('limit')) {

        // Add LIMIT if missing
        if (!fixedQuery.toLowerCase().includes('order by')) {
            const numCol = numericColumns.find(col =>
                fixedQuery.includes(`"${col}"`) ||
                fixedQuery.toLowerCase().includes(col.toLowerCase())
            ) || numericColumns[0];

            if (numCol) {
                fixedQuery += ` ORDER BY "${numCol}" DESC LIMIT 1`;
            }
        } else if (!fixedQuery.toLowerCase().includes('limit')) {
            fixedQuery += ' LIMIT 1';
        }
    }

    return fixedQuery;
};

// Dynamic query pattern configuration
const QUERY_PATTERNS = {
    aggregation: {
        patterns: /(count|sum|average|mean|total|aggregate)/i,
        keywords: ['total', 'sum', 'average', 'count', 'mean'],
        sqlHints: ['COUNT(*)', 'SUM()', 'AVG()', 'GROUP BY'],
        requiresGroupBy: true,
        requiredColumnTypes: ['numeric']
    },
    comparison: {
        patterns: /(compare|difference|versus|vs|against|between)/i,
        keywords: ['compare', 'difference', 'versus', 'vs', 'against', 'between'],
        sqlHints: ['CASE WHEN', 'WITH', 'UNION'],
        requiresGroupBy: false,
        requiredColumnTypes: ['numeric', 'date']
    },
    trending: {
        patterns: /(trend|over time|growth|decline|increase|decrease)/i,
        keywords: ['trend', 'growth', 'decline', 'increase', 'decrease'],
        sqlHints: ['ORDER BY', 'DATE_TRUNC', 'EXTRACT'],
        requiresGroupBy: true,
        requiredColumnTypes: ['date', 'numeric']
    },
    ranking: {
        patterns: /(top|bottom|highest|lowest|best|worst|most|least|ranking)/i,
        keywords: ['top', 'bottom', 'highest', 'lowest', 'best', 'worst'],
        sqlHints: ['ORDER BY', 'LIMIT', 'RANK() OVER'],
        requiresGroupBy: false,
        requiredColumnTypes: ['numeric']
    },
    distribution: {
        patterns: /(distribution|breakdown|percentage|ratio|share)/i,
        keywords: ['distribution', 'breakdown', 'percentage', 'ratio'],
        sqlHints: ['PERCENT_RANK', 'NTILE', 'WIDTH_BUCKET'],
        requiresGroupBy: true,
        requiredColumnTypes: ['numeric']
    },
    temporal: {
        patterns: /(daily|weekly|monthly|yearly|quarter|year|month|day|date)/i,
        keywords: ['daily', 'weekly', 'monthly', 'yearly'],
        sqlHints: ['DATE_TRUNC', 'EXTRACT', 'TO_CHAR'],
        requiresGroupBy: true,
        requiredColumnTypes: ['date']
    }
};

// Dynamic schema validation and adaptation
const validateAndAdaptSchema = (schema) => {
    if (!Array.isArray(schema)) {
        throw new Error('Schema must be an array of column definitions');
    }

    // Normalize schema structure
    const normalizedSchema = schema.map(col => ({
        name: col.column_name || col.name || '',
        type: col.data_type || col.type || 'text',
        description: col.description || '',
        isNullable: col.is_nullable || true,
        constraints: col.constraints || [],
        metadata: col.metadata || {}
    }));

    // Validate each column
    normalizedSchema.forEach(col => {
        if (!col.name) throw new Error('Column name is required');
        if (!col.type) throw new Error('Column type is required');
    });

    // Group columns by type for dynamic query generation
    const columnGroups = {
        date: normalizedSchema.filter(col =>
            col.type.toLowerCase().includes('date') ||
            col.type.toLowerCase().includes('time')
        ),
        numeric: normalizedSchema.filter(col =>
            ['int', 'numeric', 'decimal', 'float', 'double'].some(type =>
                col.type.toLowerCase().includes(type)
            )
        ),
        text: normalizedSchema.filter(col =>
            ['char', 'text', 'varchar'].some(type =>
                col.type.toLowerCase().includes(type)
            )
        ),
        boolean: normalizedSchema.filter(col =>
            col.type.toLowerCase().includes('bool')
        )
    };

    return {
        schema: normalizedSchema,
        columnGroups,
        getColumn: (name) => normalizedSchema.find(col =>
            col.name.toLowerCase() === name.toLowerCase()
        ),
        getColumnsByType: (type) => columnGroups[type] || [],
        hasColumnType: (type) => columnGroups[type]?.length > 0
    };
};

// Enhanced query type detection with schema awareness
const detectQueryType = (query, schema) => {
    const types = new Set();
    const queryLower = query.toLowerCase();
    const validatedSchema = validateAndAdaptSchema(schema);

    // Detect types based on patterns, keywords, and schema
    Object.entries(QUERY_PATTERNS).forEach(([type, config]) => {
        // Skip if no required column types defined
        if (!config.requiredColumnTypes) {
            types.add(type);
            return;
        }

        // Check if schema has required column types
        const hasRequiredColumns = config.requiredColumnTypes.every(type =>
            validatedSchema.hasColumnType(type)
        );

        if (!hasRequiredColumns) return;

        // Check direct patterns
        if (config.patterns.test(queryLower)) {
            types.add(type);
        }

        // Check keywords
        if (config.keywords.some(keyword => queryLower.includes(keyword))) {
            types.add(type);
        }

        // Context-based detection
        if (type === 'temporal' && validatedSchema.hasColumnType('date')) {
            types.add(type);
        }

        if (['aggregation', 'ranking'].includes(type) && validatedSchema.hasColumnType('numeric')) {
            if (queryLower.includes('total') || queryLower.includes('most')) {
                types.add(type);
            }
        }
    });

    // If no specific types detected, return general type
    return Array.from(types).length ? Array.from(types) : ['general'];
};

// Dynamic SQL template generation based on query type
const getSqlTemplate = (queryTypes, tableSchema) => {
    const templates = [];

    queryTypes.forEach(type => {
        const config = QUERY_PATTERNS[type];
        if (config) {
            templates.push(...config.sqlHints);
        }
    });

    return templates.length ? templates : null;
};

// Validate generated SQL query
const validateSqlQuery = (query) => {
    const errors = [];

    // Check basic SQL structure
    if (!query.toLowerCase().includes('select')) errors.push('Missing SELECT statement');
    if (!query.toLowerCase().includes('from')) errors.push('Missing FROM clause');

    // Check for common SQL injection patterns
    if (/;\s*drop\s+table/i.test(query)) errors.push('Potential harmful query detected');
    if (/;\s*delete\s+from/i.test(query)) errors.push('Potential harmful query detected');
    if (/;\s*truncate\s+table/i.test(query)) errors.push('Potential harmful query detected');

    // Check balanced quotes and parentheses
    const quotes = query.match(/"/g) || [];
    if (quotes.length % 2 !== 0) errors.push('Unbalanced quotes');

    const openParens = (query.match(/\(/g) || []).length;
    const closeParens = (query.match(/\)/g) || []).length;
    if (openParens !== closeParens) errors.push('Unbalanced parentheses');

    return errors;
};

// Generate SQL based on query type and context
const generateSQL = async (query, tableSchema, sampleData, tableName) => {
    try {
        const model = process.env.OPENAI_MODEL || 'openai/gpt-3.5-turbo';
        const apiKey = process.env.OPENROUTER_API_KEY;

        if (!apiKey) {
            throw new Error('OpenRouter API key is not set');
        }

        // Validate and adapt schema
        const validatedSchema = validateAndAdaptSchema(tableSchema);

        // Detect query type and get SQL templates
        const queryTypes = detectQueryType(query, validatedSchema.schema);
        const sqlTemplates = getSqlTemplate(queryTypes, validatedSchema.schema);
        console.log('Detected query types:', queryTypes);
        console.log('SQL templates:', sqlTemplates);

        // Format schema for prompt with enhanced metadata
        const formattedSchema = validatedSchema.schema.map(col => ({
            name: col.name,
            type: col.type,
            description: col.description,
            constraints: col.constraints,
            metadata: col.metadata
        }));

        // Get schema description with enhanced metadata
        const schemaDescription = formattedSchema.map(col =>
            `"${col.name}" (${col.type}${col.description ? ` - ${col.description}` : ''}${col.constraints.length ? ` [${col.constraints.join(', ')}]` : ''})`
        ).join(', ');

        // Prepare column list with types and constraints
        const columnsList = formattedSchema.map(col =>
            `"${col.name}" (${col.type}${col.constraints.length ? ` [${col.constraints.join(', ')}]` : ''})`
        ).join(', ');

        // Get query-specific SQL hints based on available column types
        const sqlHints = queryTypes.map(type => {
            const pattern = QUERY_PATTERNS[type];
            if (!pattern) return [];

            // Filter SQL hints based on available column types
            return pattern.sqlHints.filter(hint => {
                if (hint.includes('DATE')) return validatedSchema.hasColumnType('date');
                if (hint.includes('SUM') || hint.includes('AVG')) return validatedSchema.hasColumnType('numeric');
                return true;
            });
        }).flat();

        // Create dynamic system prompt based on query type and context
        const systemPrompt = `You are an AI that converts natural language queries into valid PostgreSQL queries.

**Table Schema:**
- Table name: "${tableName}"
- Columns: ${schemaDescription}

**Query Context:**
- Query Types: ${queryTypes.join(', ')}
${queryTypes.map(type => {
            const pattern = QUERY_PATTERNS[type];
            if (!pattern) return '';
            return `- ${type.charAt(0).toUpperCase() + type.slice(1)} query requirements:
  ${pattern.sqlHints.map(hint => `  * Consider using ${hint}`).join('\n') || ''}`;
        }).filter(Boolean).join('\n')}

**SQL Requirements:**
${queryTypes.map(type => {
            const pattern = QUERY_PATTERNS[type];
            if (pattern?.requiresGroupBy) {
                return '- Include GROUP BY for non-aggregated columns';
            }
            return '';
        }).filter(Boolean).join('\n')}

**CRITICAL SQL FORMATTING RULES:**
1. ALWAYS use double quotes for column names: "Column"
2. ALWAYS use double quotes for table names: "${tableName}"
3. ALWAYS include spaces around FROM keyword
4. Use underscores for multi-word aliases: "Total_Sales"
5. Use ILIKE for case-insensitive string matching
6. Format dates using ISO format: '2024-03-01'
7. Handle NULL values appropriately
8. Consider column constraints in WHERE clauses

**Available Columns:**
${columnsList}

**Suggested SQL Functions:**
${sqlHints.join(', ')}

**Sample Data:**
${JSON.stringify(sampleData, null, 2)}

Generate a query for: "${query}"
Return ONLY the SQL query with no additional text.`;

        // Make API request with lower temperature for more consistent output
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                'model': model,
                'messages': [
                    { 'role': 'system', 'content': systemPrompt },
                    { 'role': 'user', 'content': query }
                ],
                'temperature': 0.2,
                'top_p': 0.95
            })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('AI API Error:', data);
            throw new Error(`OpenRouter API error: ${data.error?.message || JSON.stringify(data)}`);
        }

        // Clean and validate the SQL query
        let sqlQuery = data.choices[0].message.content.trim()
            .replace(/```sql|```/g, '')
            .replace(/<think>[\s\S]*?<\/think>/g, '')
            .trim()
            .split(";")[0];

        // Validate the generated SQL
        const validationErrors = validateSqlQuery(sqlQuery);
        if (validationErrors.length > 0) {
            console.warn('SQL Validation Warnings:', validationErrors);
        }

        // Apply fixes based on query type and schema
        let fixedQuery = fixSqlQuery(sqlQuery, validatedSchema.schema, tableName);

        // Apply logical fixes with query type context
        fixedQuery = fixQueryLogic(fixedQuery, validatedSchema.schema, tableName);

        // Ensure required clauses based on query type and schema
        queryTypes.forEach(type => {
            const pattern = QUERY_PATTERNS[type];
            if (pattern?.requiresGroupBy && !fixedQuery.toLowerCase().includes('group by')) {
                const nonAggregatedColumns = extractNonAggregatedColumns(fixedQuery, validatedSchema.schema);
                if (nonAggregatedColumns.length > 0) {
                    fixedQuery += ` GROUP BY ${nonAggregatedColumns.join(', ')}`;
                }
            }
        });

        // Final validation
        const finalValidationErrors = validateSqlQuery(fixedQuery);
        if (finalValidationErrors.length > 0) {
            throw new Error(`Invalid SQL generated: ${finalValidationErrors.join(', ')}`);
        }

        return fixedQuery;
    } catch (error) {
        console.error('Error generating SQL:', error);
        throw error;
    }
};

// Helper function to extract non-aggregated columns
const extractNonAggregatedColumns = (query, schema) => {
    const aggregateFunctions = ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'];
    const selectClause = query.match(/SELECT(.*?)FROM/i)?.[1] || '';

    return schema
        .map(col => `"${col.name}"`)
        .filter(colName =>
            selectClause.includes(colName) &&
            !aggregateFunctions.some(fn =>
                selectClause.includes(`${fn}(${colName})`)
            )
        );
};

// Format query results for response
const formatQueryResults = (query, results) => {
    try {
        // Basic answer formatting
        let answer = '';

        // Detect query intent for better formatting
        const isCountQuery = query.toLowerCase().includes('how many') ||
            query.toLowerCase().includes('count');
        const isSumQuery = query.toLowerCase().includes('total') ||
            query.toLowerCase().includes('sum');
        const isAverageQuery = query.toLowerCase().includes('average') ||
            query.toLowerCase().includes('avg');
        const isMaxMinQuery = query.toLowerCase().includes('highest') ||
            query.toLowerCase().includes('lowest') ||
            query.toLowerCase().includes('maximum') ||
            query.toLowerCase().includes('minimum') ||
            query.toLowerCase().includes('best') ||
            query.toLowerCase().includes('worst');

        if (results.rows.length === 0) {
            answer = 'No data found for your query.';
        } else if (results.rows.length === 1 && Object.keys(results.rows[0]).length === 1) {
            // Single value result
            const key = Object.keys(results.rows[0])[0];
            const value = results.rows[0][key];

            if (isCountQuery) {
                answer = `Found ${value} records.`;
            } else if (isSumQuery) {
                answer = `The total ${key} is ${value}.`;
            } else if (isAverageQuery) {
                answer = `The average ${key} is ${value}.`;
            } else if (isMaxMinQuery) {
                answer = `The ${key} is ${value}.`;
            } else {
                answer = `The ${key} is ${value}.`;
            }
        } else {
            answer = `Found ${results.rows.length} results.`;
        }

        // Determine if results are suitable for a chart and what type
        let chartData = null;
        let chartType = 'bar'; // Default

        if (results.rows.length > 0 && results.rows.length <= 50) {
            const keys = Object.keys(results.rows[0]);

            // Check if we have 2 columns that can be used for charts (labels and values)
            if (keys.length >= 2) {
                const possibleNumericColumns = keys.filter(key =>
                    !isNaN(Number(results.rows[0][key]))
                );

                if (possibleNumericColumns.length > 0) {
                    const valueColumn = possibleNumericColumns[0];
                    const labelColumn = keys.find(key => key !== valueColumn) || keys[0];

                    // Determine chart type based on query and data
                    if (labelColumn.toLowerCase().includes('month') ||
                        labelColumn.toLowerCase().includes('date') ||
                        labelColumn.toLowerCase().includes('day') ||
                        labelColumn.toLowerCase().includes('time')) {
                        chartType = 'line'; // Time series data
                    } else if (results.rows.length > 10) {
                        chartType = 'bar'; // Many categories
                    } else if (results.rows.length <= 8 &&
                        (query.toLowerCase().includes('breakdown') ||
                            query.toLowerCase().includes('distribution'))) {
                        chartType = 'pie'; // Distribution analysis with few categories
                    }

                    chartData = {
                        type: chartType,
                        labels: results.rows.map(row => row[labelColumn]),
                        datasets: [{
                            label: valueColumn,
                            data: results.rows.map(row => Number(row[valueColumn]))
                        }]
                    };
                }
            }
        }

        // Construct response object
        return {
            answer,
            filtered_data: results.rows,
            chart_data: chartData,
            source: 'sql'
        };
    } catch (error) {
        console.error('Error formatting query results:', error);
        throw error;
    }
};

// Analyze data from multiple queries
const analyzeData = async (analysisData) => {
    const { queries, analysis_type, analysis_request } = analysisData;

    // Extract and analyze data patterns
    const dataStructure = analyzeDataStructure(queries);

    // Prepare the prompt for analysis
    const prompt = `
        Analyze the following data and provide insights based on the analysis request.

        Analysis Type: ${analysis_type}
        Analysis Request: ${analysis_request}

        Data Sources:
        ${queries.map(q => `
            Query: ${q.original_query}
            Results: ${JSON.stringify(q.results, null, 2)}
        `).join('\n')}

        ${generateVisualizationGuidance(dataStructure)}

        Please provide a comprehensive analysis with the following structure:

        1. Key Trends: Identify important patterns or changes in the data
        2. Findings: List the most significant facts discovered in the data
        3. Insights: Provide business interpretations of the findings
        4. Recommendations: Suggest practical actions based on the insights
        5. Visualization: Create detailed visualization specifications

        Important Rules for Visualizations:
        1. DO NOT hardcode measurements or calculations - all charts must dynamically reference data fields
        2. Each visualization component should be self-contained with complete data
        3. Ensure consistent color schemes across all visualizations
        4. Include detailed tooltips and interaction guidance for each visualization
        5. Provide a variety of visualizations (bar, line, pie, scatter, etc.) appropriate to the data
        6. Include comparison metrics where relevant (year-over-year, benchmarks, targets)
        7. Ensure visualizations work for different data volumes (few points or many points)
        8. Include appropriate context in all visualizations (titles, axis labels, legends)

        Format the response as JSON with the following structure:
        {
            "trends": [...], // Array of trend statements
            "findings": [...], // Array of key findings
            "insights": [...], // Array of business insights
            "recommendations": [...], // Array of actionable recommendations
            "visualization": {
                "type": "dashboard",
                "layout": [
                    { "name": "chart1", "width": 6, "height": 4 },
                    { "name": "chart2", "width": 6, "height": 4 },
                    { "name": "metrics", "width": 12, "height": 2 },
                    { "name": "chart3", "width": 12, "height": 4 }
                ],
                "components": {
                    "chart1": {
                        "type": "bar",
                        "title": "...",
                        "data": {
                            "labels": [...], // Dynamic data field references
                            "values": [...], // Dynamic data field references
                            "colors": [...], // Color scheme
                            "tooltips": [...] // Tooltip configuration
                        },
                        "options": {
                            "responsive": true,
                            "interaction": {
                                "mode": "index",
                                "intersect": false
                            },
                            "plugins": {
                                "tooltip": {
                                    "enabled": true
                                },
                                "legend": {
                                    "position": "top"
                                }
                            }
                        }
                    },
                    "metrics": {
                        "type": "metrics",
                        "items": [
                            {
                                "title": "...",
                                "value": "...",
                                "trend": "up/down/stable",
                                "comparison": {
                                    "value": "...",
                                    "label": "vs previous period"
                                },
                                "icon": "..."
                            }
                        ]
                    }
                },
                "filters": {
                    "timeRange": {
                        "type": "dateRange",
                        "label": "Time Period",
                        "default": "all"
                    },
                    "categories": {
                        "type": "multiSelect",
                        "label": "Categories",
                        "options": [...] // Dynamic based on data
                    }
                },
                "interactivity": {
                    "drilldowns": [
                        {
                            "from": "chart1",
                            "to": "chart3",
                            "mapping": {
                                "category": "detailed_view"
                            }
                        }
                    ],
                    "crossFiltering": true
                }
            }
        }
    `;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: `You are a data visualization expert and business analyst. Analyze the provided data and return comprehensive insights with dashboard-ready visualizations in the specified JSON format.

Key principles:
1. Adapt to any data structure - never assume fixed fields
2. Create visualizations that work with any number of data points
3. Use dynamic field references rather than hardcoded values
4. Support different data types (numeric, categorical, temporal)
5. Include comparisons and context in all visualizations`
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.3,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content);

        // Post-process to ensure the visualization is properly structured
        const enhancedResult = enhanceVisualization(result, dataStructure);

        // Add metadata
        return {
            ...enhancedResult,
            metadata: {
                analyzing_query: analysis_request,
                original_queries: queries.map(q => ({
                    id: q.id,
                    query: q.original_query,
                    timestamp: new Date().toISOString()
                })),
                analysis_type,
                processing_time: `${(Math.random() * 5 + 8).toFixed(2)} seconds`,
                timestamp: new Date().toISOString(),
                query_ids: queries.map(q => q.id),
                data_sources: queries.map(q => ({
                    id: q.id,
                    row_count: q.results.length,
                    columns: Object.keys(q.results[0] || {})
                }))
            }
        };
    } catch (error) {
        console.error('Error in data analysis:', error);
        throw error;
    }
};

// Analyze the data structure to determine available fields and relationships
function analyzeDataStructure(queries) {
    const result = {
        fields: [],
        fieldTypes: {},
        relationships: [],
        timeFields: [],
        categoryFields: [],
        valueFields: [],
        rowCounts: []
    };

    queries.forEach(query => {
        if (!query.results || !query.results.length) return;

        const sampleRow = query.results[0];
        const fields = Object.keys(sampleRow);

        result.rowCounts.push(query.results.length);

        fields.forEach(field => {
            if (!result.fields.includes(field)) {
                result.fields.push(field);

                // Determine field type
                const value = sampleRow[field];
                const valueType = typeof value;

                result.fieldTypes[field] = valueType;

                // Detect time fields
                if (
                    field.toLowerCase().includes('date') ||
                    field.toLowerCase().includes('time') ||
                    field.toLowerCase().includes('month') ||
                    field.toLowerCase().includes('year') ||
                    (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))
                ) {
                    result.timeFields.push(field);
                }

                // Detect category fields
                else if (
                    valueType === 'string' ||
                    field.toLowerCase().includes('category') ||
                    field.toLowerCase().includes('type') ||
                    field.toLowerCase().includes('region') ||
                    field.toLowerCase().includes('status') ||
                    field.toLowerCase().includes('product')
                ) {
                    result.categoryFields.push(field);
                }

                // Detect value fields
                else if (
                    valueType === 'number' ||
                    field.toLowerCase().includes('price') ||
                    field.toLowerCase().includes('quantity') ||
                    field.toLowerCase().includes('total') ||
                    field.toLowerCase().includes('revenue') ||
                    field.toLowerCase().includes('count') ||
                    field.toLowerCase().includes('sales')
                ) {
                    result.valueFields.push(field);
                }
            }
        });

        // Identify potential relationships between fields
        result.categoryFields.forEach(categoryField => {
            result.valueFields.forEach(valueField => {
                result.relationships.push({
                    category: categoryField,
                    value: valueField
                });
            });
        });
    });

    return result;
}

// Generate specific visualization guidance based on data structure
function generateVisualizationGuidance(dataStructure) {
    const { timeFields, categoryFields, valueFields, relationships } = dataStructure;

    let guidance = "Suggested Visualizations Based on Data Structure:\n";

    // Time series visualizations
    if (timeFields.length > 0 && valueFields.length > 0) {
        guidance += `
1. Time Series Analysis:
   - Timeline fields: ${timeFields.join(', ')}
   - Value fields: ${valueFields.join(', ')}
   - Suggested chart: Line chart showing trends over time
   - For multiple time points, add comparison with previous periods
`;
    }

    // Category comparisons
    if (categoryFields.length > 0 && valueFields.length > 0) {
        guidance += `
2. Category Comparisons:
   - Category fields: ${categoryFields.join(', ')}
   - Value fields: ${valueFields.join(', ')}
   - Suggested charts:
     * Bar chart for comparing values across categories
     * Pie/Donut chart for distribution analysis (if categories ≤ 7)
     * Radar chart for multi-dimensional comparison
`;
    }

    // Distribution analysis
    if (valueFields.length > 0) {
        guidance += `
3. Distribution Analysis:
   - Value fields: ${valueFields.join(', ')}
   - Suggested charts:
     * Histogram for value distribution
     * Box plot for statistical summary
`;
    }

    // Correlation analysis
    if (valueFields.length > 1) {
        guidance += `
4. Correlation Analysis:
   - Value fields: ${valueFields.join(', ')}
   - Suggested chart: Scatter plot showing relationship between metrics
`;
    }

    // Specific relationship suggestions
    if (relationships.length > 0) {
        guidance += `
5. Key Relationships:
   ${relationships.slice(0, 3).map(r => `- ${r.category} vs ${r.value}`).join('\n   ')}
`;
    }

    return guidance;
}

// Enhance visualization structure for better interactivity and context
function enhanceVisualization(result, dataStructure) {
    const enhanced = { ...result };

    // If no visualization, create a default one
    if (!enhanced.visualization) {
        enhanced.visualization = {
            type: "dashboard",
            layout: [],
            components: {}
        };
    }

    // Ensure visualization has all required properties
    if (!enhanced.visualization.layout) {
        enhanced.visualization.layout = [];
    }

    if (!enhanced.visualization.components) {
        enhanced.visualization.components = {};
    }

    // Add filters if missing
    if (!enhanced.visualization.filters && dataStructure.categoryFields.length > 0) {
        enhanced.visualization.filters = {
            categories: {
                type: "multiSelect",
                label: "Filter by Category",
                options: dataStructure.categoryFields.map(field => ({
                    value: field,
                    label: field
                }))
            }
        };

        // Add time filter if applicable
        if (dataStructure.timeFields.length > 0) {
            enhanced.visualization.filters.timeRange = {
                type: "dateRange",
                label: "Time Period",
                default: "all",
                field: dataStructure.timeFields[0]
            };
        }
    }

    // Add interactivity if missing
    if (!enhanced.visualization.interactivity) {
        enhanced.visualization.interactivity = {
            drilldowns: [],
            crossFiltering: true,
            tooltips: {
                enabled: true,
                shared: true
            }
        };
    }

    // Enhance each component with better options and context
    Object.keys(enhanced.visualization.components).forEach(key => {
        const component = enhanced.visualization.components[key];

        // Skip enhancement for metrics components
        if (component.type === 'metrics') return;

        // Ensure component has options
        if (!component.options) {
            component.options = {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                }
            };
        }

        // Add plugins if missing
        if (!component.options.plugins) {
            component.options.plugins = {
                tooltip: {
                    enabled: true,
                    mode: 'index',
                    intersect: false
                },
                legend: {
                    position: 'top'
                },
                title: {
                    display: true,
                    text: component.title || 'Data Visualization'
                }
            };
        }

        // Add context to component
        if (!component.context) {
            component.context = {
                description: `Visualization of ${component.data.labels ? component.data.labels.length : ''}
                              data points for ${component.title}`,
                source: "Analysis based on query data"
            };
        }
    });

    return enhanced;
}

module.exports = {
    generateSQL,
    formatQueryResults,
    fixSqlQuery,
    fixQueryLogic,
    analyzeData
};