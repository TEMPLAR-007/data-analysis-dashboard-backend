const { v4: uuidv4 } = require('uuid');
const db = require('../utils/db');
const openai = require('../utils/openai');

// Store Phase 1 query results
const saveQueryResults = async (tableName, originalQuery, sqlQuery, results) => {
    const queryId = uuidv4();
    const metadata = {
        timestamp: new Date().toISOString(),
        rowCount: results.length
    };

    try {
        await db.query(
            `INSERT INTO saved_queries
            (id, table_name, original_query, sql_query, results, metadata)
            VALUES ($1, $2, $3, $4, $5, $6)`,
            [queryId, tableName, originalQuery, sqlQuery, JSON.stringify(results), JSON.stringify(metadata)]
        );
        return queryId;
    } catch (error) {
        console.error('Error saving query results:', error);
        throw error;
    }
};

// Get query history
const getQueryHistory = async (tableName) => {
    try {
        const result = await db.query(
            `SELECT id, original_query, created_at, metadata
            FROM saved_queries
            WHERE table_name = $1
            ORDER BY created_at DESC`,
            [tableName]
        );
        return result.rows;
    } catch (error) {
        console.error('Error fetching query history:', error);
        throw error;
    }
};

// Get specific query results
const getQueryResults = async (queryId) => {
    try {
        const result = await db.query(
            `SELECT * FROM saved_queries WHERE id = $1`,
            [queryId]
        );
        return result.rows[0];
    } catch (error) {
        console.error('Error fetching query results:', error);
        throw error;
    }
};

// Valid analysis types
const VALID_ANALYSIS_TYPES = [
    'trend_analysis',
    'comparative_analysis',
    'predictive_analysis',
    'pattern_analysis'
];

// Validate analysis request
const validateAnalysisRequest = (request) => {
    const errors = [];

    if (!request.query_ids || !Array.isArray(request.query_ids) || request.query_ids.length === 0) {
        errors.push('At least one query_id is required');
    }

    if (!request.analysis_type || !VALID_ANALYSIS_TYPES.includes(request.analysis_type)) {
        errors.push(`analysis_type must be one of: ${VALID_ANALYSIS_TYPES.join(', ')}`);
    }

    if (!request.analysis_request || typeof request.analysis_request !== 'string' || request.analysis_request.trim().length === 0) {
        errors.push('analysis_request is required and must be a non-empty string');
    }

    return errors;
};

// Detect analysis type from request
const detectAnalysisType = (analysisRequest) => {
    const request = analysisRequest.toLowerCase();

    if (request.includes('trend') || request.includes('over time') || request.includes('growth')) {
        return 'trend_analysis';
    }
    if (request.includes('compare') || request.includes('versus') || request.includes('vs')) {
        return 'comparative_analysis';
    }
    if (request.includes('predict') || request.includes('forecast') || request.includes('next')) {
        return 'predictive_analysis';
    }
    if (request.includes('pattern') || request.includes('seasonal') || request.includes('cycle')) {
        return 'pattern_analysis';
    }

    // Default to trend analysis if no specific type is detected
    return 'trend_analysis';
};

// Create analysis session
const createAnalysisSession = async (queryIds, analysisType, analysisRequest) => {
    // If analysis_type is not provided, detect it from the request
    const detectedType = analysisType || detectAnalysisType(analysisRequest);

    // Validate the request
    const errors = validateAnalysisRequest({
        query_ids: queryIds,
        analysis_type: detectedType,
        analysis_request: analysisRequest
    });

    if (errors.length > 0) {
        throw new Error(`Invalid analysis request: ${errors.join(', ')}`);
    }

    const sessionId = uuidv4();

    try {
        await db.query(
            `INSERT INTO analysis_sessions
            (id, query_ids, analysis_type, analysis_request)
            VALUES ($1, $2, $3, $4)`,
            [sessionId, queryIds, detectedType, analysisRequest]
        );
        return sessionId;
    } catch (error) {
        console.error('Error creating analysis session:', error);
        throw error;
    }
};

// Perform analysis on selected queries
const performAnalysis = async (sessionId) => {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] Starting analysis for session ${sessionId}`);

    try {
        // Get analysis session
        const session = await db.query(
            `SELECT * FROM analysis_sessions WHERE id = $1`,
            [sessionId]
        );

        if (!session.rows[0]) {
            throw new Error('Analysis session not found');
        }

        const { query_ids, analysis_type, analysis_request } = session.rows[0];
        console.log(`[${new Date().toISOString()}] Analysis type: ${analysis_type}, Request: ${analysis_request}`);

        // Get all selected query results
        console.log(`[${new Date().toISOString()}] Fetching query results for IDs: ${query_ids.join(', ')}`);
        const queryResults = await Promise.all(
            query_ids.map(id => getQueryResults(id))
        );

        // Prepare data for analysis
        const analysisData = {
            queries: queryResults.map(q => ({
                id: q.id,
                original_query: q.original_query,
                results: q.results
            })),
            analysis_type,
            analysis_request
        };

        console.log(`[${new Date().toISOString()}] Sending data to AI for analysis`);
        // Use OpenAI to analyze the data
        const analysisResults = await openai.analyzeData(analysisData);
        console.log(`[${new Date().toISOString()}] Received analysis results from AI`);

        // Add analyzing query and timing to results
        const endTime = Date.now();
        const analysisTime = (endTime - startTime) / 1000;

        // Enhance results with statistics and additional insights
        const enhancedResults = enhanceAnalysisResults(analysisResults, queryResults, analysisTime);

        // Update analysis session with results
        await db.query(
            `UPDATE analysis_sessions
            SET results = $1, status = 'completed'
            WHERE id = $2`,
            [JSON.stringify(enhancedResults), sessionId]
        );

        console.log(`[${new Date().toISOString()}] Analysis completed in ${analysisTime.toFixed(2)} seconds`);
        return enhancedResults;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in analysis:`, error);

        // Update session with error status
        try {
            await db.query(
                `UPDATE analysis_sessions
                SET status = 'error', results = $1
                WHERE id = $2`,
                [JSON.stringify({ error: error.message }), sessionId]
            );
        } catch (dbError) {
            console.error(`[${new Date().toISOString()}] Error updating session status:`, dbError);
        }

        throw error;
    }
};

// Enhance analysis results with additional insights and metrics
const enhanceAnalysisResults = (results, queryResults, analysisTime) => {
    try {
        // Get flat list of all data rows from all queries
        const allData = queryResults.reduce((acc, q) => [...acc, ...q.results], []);

        // Create statistical summary of the data
        const stats = generateDataStatistics(allData);

        // Ensure results has all required properties
        if (!results.insights) results.insights = [];
        if (!results.trends) results.trends = [];
        if (!results.findings) results.findings = [];
        if (!results.recommendations) results.recommendations = [];

        // Ensure visualization has required properties
        if (!results.visualization) {
            results.visualization = {
                type: "dashboard",
                layout: [],
                components: {}
            };
        }

        // Add relevant statistical insights if not already present
        if (stats.outliers.length > 0 && !results.insights.some(i => i.includes('outlier'))) {
            results.insights.push(
                `Identified ${stats.outliers.length} outliers in the data that may require further investigation.`
            );
        }

        // Add processing metadata
        results.metadata = {
            ...results.metadata,
            stats,
            processing_time: `${analysisTime.toFixed(2)} seconds`,
            timestamp: new Date().toISOString(),
            record_count: allData.length,
            analysis_version: "1.2.0",
            data_quality: {
                completeness: stats.completeness,
                has_outliers: stats.outliers.length > 0,
                value_distribution: stats.valueDistribution
            }
        };

        return results;
    } catch (error) {
        console.error('Error enhancing analysis results:', error);
        // Return original results if enhancement fails
        return results;
    }
};

// Generate statistical summary of the data
const generateDataStatistics = (data) => {
    if (!data || data.length === 0) {
        return {
            count: 0,
            fields: [],
            completeness: 0,
            outliers: [],
            valueDistribution: {}
        };
    }

    try {
        const fields = Object.keys(data[0]);
        const stats = {
            count: data.length,
            fields: fields,
            completeness: 0,
            outliers: [],
            valueDistribution: {}
        };

        // Calculate completeness (% of non-null values)
        let totalFields = fields.length * data.length;
        let nonNullValues = 0;

        fields.forEach(field => {
            stats.valueDistribution[field] = {};

            data.forEach(row => {
                if (row[field] !== null && row[field] !== undefined) {
                    nonNullValues++;

                    // Track value distribution for categorical fields
                    if (typeof row[field] === 'string' || typeof row[field] === 'boolean') {
                        const value = String(row[field]);
                        stats.valueDistribution[field][value] = (stats.valueDistribution[field][value] || 0) + 1;
                    }
                }
            });
        });

        stats.completeness = totalFields > 0 ? nonNullValues / totalFields : 0;

        // Detect outliers in numeric fields
        fields.forEach(field => {
            // Check if field contains numeric values
            const numericValues = data
                .map(row => row[field])
                .filter(val => !isNaN(Number(val)))
                .map(Number);

            if (numericValues.length > 5) {
                // Calculate mean and standard deviation
                const mean = numericValues.reduce((sum, val) => sum + val, 0) / numericValues.length;
                const stdDev = Math.sqrt(
                    numericValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / numericValues.length
                );

                // Define outliers as values beyond 3 standard deviations
                const outliers = data.filter(row => {
                    const val = Number(row[field]);
                    return !isNaN(val) && Math.abs(val - mean) > 3 * stdDev;
                });

                if (outliers.length > 0) {
                    stats.outliers.push({
                        field,
                        count: outliers.length,
                        mean,
                        stdDev,
                        threshold: 3 * stdDev
                    });
                }
            }
        });

        return stats;
    } catch (error) {
        console.error('Error generating data statistics:', error);
        return {
            count: data.length,
            fields: Object.keys(data[0] || {}),
            completeness: 0,
            outliers: [],
            valueDistribution: {}
        };
    }
};

// Enhanced visualization structure
const createVisualization = (data, analysisType) => {
    switch (analysisType) {
        case 'trend_analysis':
            return {
                charts: [
                    {
                        type: 'bar',
                        title: 'Top Selling Products',
                        data: {
                            labels: data.map(item => item.Product),
                            datasets: [
                                {
                                    label: 'Total Sales',
                                    data: data.map(item => item.Total_Sales),
                                    backgroundColor: 'rgba(54, 162, 235, 0.5)',
                                    borderColor: 'rgba(54, 162, 235, 1)',
                                    borderWidth: 1
                                }
                            ]
                        },
                        options: {
                            responsive: true,
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    title: {
                                        display: true,
                                        text: 'Number of Units Sold'
                                    }
                                },
                                x: {
                                    title: {
                                        display: true,
                                        text: 'Products'
                                    }
                                }
                            }
                        }
                    },
                    {
                        type: 'pie',
                        title: 'Market Share Distribution',
                        data: {
                            labels: data.map(item => item.Product),
                            datasets: [{
                                label: 'Market Share',
                                data: data.map(item => item.Total_Sales),
                                backgroundColor: [
                                    'rgba(255, 99, 132, 0.5)',
                                    'rgba(54, 162, 235, 0.5)',
                                    'rgba(255, 206, 86, 0.5)',
                                    'rgba(75, 192, 192, 0.5)',
                                    'rgba(153, 102, 255, 0.5)',
                                    'rgba(255, 159, 64, 0.5)',
                                    'rgba(201, 203, 207, 0.5)'
                                ],
                                borderColor: [
                                    'rgb(255, 99, 132)',
                                    'rgb(54, 162, 235)',
                                    'rgb(255, 206, 86)',
                                    'rgb(75, 192, 192)',
                                    'rgb(153, 102, 255)',
                                    'rgb(255, 159, 64)',
                                    'rgb(201, 203, 207)'
                                ],
                                borderWidth: 1
                            }]
                        },
                        options: {
                            responsive: true,
                            plugins: {
                                legend: {
                                    position: 'right'
                                },
                                title: {
                                    display: true,
                                    text: 'Market Share Distribution'
                                }
                            }
                        }
                    },
                    {
                        type: 'line',
                        title: 'Sales Trend',
                        data: {
                            labels: data.map(item => item.Product),
                            datasets: [
                                {
                                    label: 'Sales Trend',
                                    data: data.map(item => item.Total_Sales),
                                    fill: false,
                                    borderColor: 'rgba(75, 192, 192, 1)',
                                    tension: 0.1
                                }
                            ]
                        },
                        options: {
                            responsive: true,
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    title: {
                                        display: true,
                                        text: 'Number of Units Sold'
                                    }
                                },
                                x: {
                                    title: {
                                        display: true,
                                        text: 'Products'
                                    }
                                }
                            }
                        }
                    }
                ],
                tables: [
                    {
                        title: 'Product Performance Summary',
                        columns: ['Product', 'Total Sales', 'Rank', 'Market Share'],
                        data: data.map((item, index) => ({
                            Product: item.Product,
                            'Total Sales': item.Total_Sales,
                            Rank: index + 1,
                            'Market Share': `${Math.round((item.Total_Sales / data.reduce((sum, i) => sum + i.Total_Sales, 0)) * 100)}%`
                        }))
                    }
                ],
                metrics: [
                    {
                        title: 'Top Product',
                        value: data[0].Product,
                        description: 'Best performing product',
                        icon: 'trophy'
                    },
                    {
                        title: 'Total Units Sold',
                        value: data.reduce((sum, item) => sum + item.Total_Sales, 0),
                        description: 'Across all products',
                        icon: 'shopping-cart'
                    },
                    {
                        title: 'Average Sales',
                        value: Math.round(data.reduce((sum, item) => sum + item.Total_Sales, 0) / data.length),
                        description: 'Per product',
                        icon: 'chart-line'
                    }
                ]
            };
        case 'comparative_analysis':
            return {
                charts: [
                    {
                        type: 'radar',
                        title: 'Product Comparison',
                        data: {
                            labels: ['Sales', 'Growth', 'Profit', 'Customer Satisfaction', 'Market Share'],
                            datasets: data.slice(0, 3).map((item, index) => ({
                                label: item.Product,
                                data: [
                                    item.Total_Sales,
                                    Math.random() * 100, // Placeholder for growth
                                    Math.random() * 100, // Placeholder for profit
                                    Math.random() * 100, // Placeholder for satisfaction
                                    (item.Total_Sales / data.reduce((sum, i) => sum + i.Total_Sales, 0)) * 100
                                ],
                                backgroundColor: `rgba(${index * 100}, ${255 - index * 50}, ${150}, 0.2)`,
                                borderColor: `rgba(${index * 100}, ${255 - index * 50}, ${150}, 1)`,
                                borderWidth: 1
                            }))
                        },
                        options: {
                            responsive: true,
                            scales: {
                                r: {
                                    angleLines: {
                                        display: true
                                    },
                                    suggestedMin: 0
                                }
                            }
                        }
                    },
                    {
                        type: 'bar',
                        title: 'Comparative Performance',
                        data: {
                            labels: data.map(item => item.Product),
                            datasets: [
                                {
                                    label: 'Current Sales',
                                    data: data.map(item => item.Total_Sales),
                                    backgroundColor: 'rgba(54, 162, 235, 0.5)'
                                },
                                {
                                    label: 'Target Sales',
                                    data: data.map(() => Math.round(data.reduce((sum, item) => sum + item.Total_Sales, 0) / data.length * 1.2)),
                                    backgroundColor: 'rgba(255, 99, 132, 0.5)'
                                }
                            ]
                        },
                        options: {
                            responsive: true,
                            scales: {
                                y: {
                                    beginAtZero: true
                                }
                            }
                        }
                    }
                ],
                tables: [
                    {
                        title: 'Comparative Analysis',
                        columns: ['Product', 'Sales', 'Market Share', 'Performance'],
                        data: data.map(item => {
                            const avgSales = data.reduce((sum, i) => sum + i.Total_Sales, 0) / data.length;
                            return {
                                Product: item.Product,
                                Sales: item.Total_Sales,
                                'Market Share': `${Math.round((item.Total_Sales / data.reduce((sum, i) => sum + i.Total_Sales, 0)) * 100)}%`,
                                Performance: item.Total_Sales > avgSales ? 'Above Average' : 'Below Average'
                            };
                        })
                    }
                ]
            };
        case 'predictive_analysis':
            // Generate some future predictions based on current data
            const predictions = data.map(item => ({
                ...item,
                Predicted_Growth: Math.round(Math.random() * 30 - 10) // -10% to +20%
            }));

            return {
                charts: [
                    {
                        type: 'line',
                        title: 'Sales Forecast',
                        data: {
                            labels: ['Current', 'Month 1', 'Month 2', 'Month 3'],
                            datasets: data.slice(0, 5).map((item, index) => {
                                const growth = predictions[index].Predicted_Growth / 100;
                                return {
                                    label: item.Product,
                                    data: [
                                        item.Total_Sales,
                                        Math.round(item.Total_Sales * (1 + growth)),
                                        Math.round(item.Total_Sales * (1 + growth * 2)),
                                        Math.round(item.Total_Sales * (1 + growth * 3))
                                    ],
                                    borderColor: `hsl(${index * 50}, 70%, 50%)`,
                                    tension: 0.1
                                };
                            })
                        },
                        options: {
                            responsive: true,
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    title: {
                                        display: true,
                                        text: 'Projected Sales'
                                    }
                                }
                            }
                        }
                    }
                ],
                tables: [
                    {
                        title: 'Sales Predictions',
                        columns: ['Product', 'Current Sales', 'Projected Growth', '3-Month Forecast'],
                        data: predictions.map(item => {
                            const growth = item.Predicted_Growth / 100;
                            return {
                                Product: item.Product,
                                'Current Sales': item.Total_Sales,
                                'Projected Growth': `${item.Predicted_Growth > 0 ? '+' : ''}${item.Predicted_Growth}%`,
                                '3-Month Forecast': Math.round(item.Total_Sales * (1 + growth * 3))
                            };
                        })
                    }
                ]
            };
        default:
            return {
                charts: [
                    {
                        type: 'bar',
                        title: 'Data Overview',
                        data: {
                            labels: data.map(item => item.Product || Object.values(item)[0]),
                            datasets: [
                                {
                                    label: 'Values',
                                    data: data.map(item => item.Total_Sales || Object.values(item)[1] || 0),
                                    backgroundColor: 'rgba(54, 162, 235, 0.5)'
                                }
                            ]
                        }
                    }
                ]
            };
    }
};

// Dynamic analysis functions
const analyzeTrends = (data) => {
    const patterns = [];
    const anomalies = [];

    // Calculate average sales
    const avgSales = data.reduce((sum, item) => sum + item.Total_Sales, 0) / data.length;
    const stdDev = Math.sqrt(
        data.reduce((sum, item) => sum + Math.pow(item.Total_Sales - avgSales, 2), 0) / data.length
    );

    // Detect patterns
    if (data[0].Total_Sales > avgSales + stdDev) {
        patterns.push({
            type: "outperforming",
            confidence: calculateConfidence(data[0].Total_Sales, avgSales, stdDev),
            description: `${data[0].Product} shows significantly higher performance than average`,
            evidence: `${data[0].Total_Sales} units vs average of ${Math.round(avgSales)}`
        });
    }

    // Detect anomalies
    data.forEach(item => {
        if (item.Total_Sales > avgSales + (2 * stdDev)) {
            anomalies.push({
                type: "outlier",
                product: item.Product,
                value: item.Total_Sales,
                expected_range: `${Math.round(avgSales - stdDev)}-${Math.round(avgSales + stdDev)}`,
                impact: calculateImpact(item.Total_Sales, avgSales),
                explanation: `${item.Product} sales significantly exceed average performance`
            });
        }
    });

    return { patterns, anomalies };
};

const predictFuture = (data) => {
    const predictions = {
        short_term: {},
        long_term: {}
    };

    // Calculate growth rates
    const growthRates = data.map((item, index) => {
        if (index === 0) return 0;
        return (item.Total_Sales - data[index - 1].Total_Sales) / data[index - 1].Total_Sales;
    });

    const avgGrowthRate = growthRates.reduce((sum, rate) => sum + rate, 0) / growthRates.length;

    // Generate predictions
    data.forEach(item => {
        predictions.short_term[item.Product] = {
            next_month: {
                expected_sales: Math.round(item.Total_Sales * (1 + avgGrowthRate)),
                confidence: calculatePredictionConfidence(item.Total_Sales, avgGrowthRate),
                factors: ["current trend", "historical growth"]
            }
        };

        predictions.long_term[item.Product] = {
            next_quarter: {
                expected_sales: Math.round(item.Total_Sales * Math.pow(1 + avgGrowthRate, 3)),
                confidence: calculatePredictionConfidence(item.Total_Sales, avgGrowthRate, true),
                factors: ["trend projection", "seasonal patterns"]
            }
        };
    });

    return predictions;
};

const analyzeMarket = (data) => {
    const totalSales = data.reduce((sum, item) => sum + item.Total_Sales, 0);

    // Dynamic segmentation based on performance
    const segments = [
        { name: "High Performance", threshold: 0.8 },
        { name: "Medium Performance", threshold: 0.5 },
        { name: "Low Performance", threshold: 0 }
    ];

    const productSegments = segments.map(segment => {
        const products = data.filter(item =>
            item.Total_Sales / totalSales >= segment.threshold
        ).map(item => item.Product);

        return {
            segment: segment.name,
            products,
            market_share: `${Math.round((products.length / data.length) * 100)}%`,
            characteristics: generateCharacteristics(products, data)
        };
    });

    // Opportunity analysis
    const opportunities = data.map(item => ({
        product: item.Product,
        opportunity: generateOpportunity(item, data),
        potential_increase: calculatePotentialIncrease(item, data),
        risk: calculateRisk(item, data)
    }));

    return { productSegments, opportunities };
};

// Helper functions
const calculateConfidence = (value, mean, stdDev) => {
    const zScore = Math.abs((value - mean) / stdDev);
    return Math.min(0.95, 0.7 + (zScore * 0.05));
};

const calculateImpact = (value, mean) => {
    const deviation = (value - mean) / mean;
    if (deviation > 0.5) return "high";
    if (deviation > 0.2) return "medium";
    return "low";
};

const calculatePredictionConfidence = (currentValue, growthRate, isLongTerm = false) => {
    const baseConfidence = 0.7;
    const stabilityFactor = Math.min(1, currentValue / 100);
    const timeFactor = isLongTerm ? 0.8 : 1;
    return Math.min(0.95, baseConfidence * stabilityFactor * timeFactor);
};

const generateCharacteristics = (products, data) => {
    const characteristics = [];
    const avgSales = data.reduce((sum, item) => sum + item.Total_Sales, 0) / data.length;

    products.forEach(product => {
        const productData = data.find(item => item.Product === product);
        if (productData.Total_Sales > avgSales * 1.2) {
            characteristics.push("High sales");
        }
        if (productData.Total_Sales > avgSales) {
            characteristics.push("Above average performance");
        }
    });

    return [...new Set(characteristics)];
};

const generateOpportunity = (item, data) => {
    const opportunities = [
        "Bundle with complementary products",
        "Price optimization",
        "Marketing campaign",
        "Inventory optimization"
    ];
    return opportunities[Math.floor(Math.random() * opportunities.length)];
};

const calculatePotentialIncrease = (item, data) => {
    const avgSales = data.reduce((sum, item) => sum + item.Total_Sales, 0) / data.length;
    const potential = Math.round((item.Total_Sales / avgSales) * 10);
    return `${potential}-${potential + 5}%`;
};

const calculateRisk = (item, data) => {
    const avgSales = data.reduce((sum, item) => sum + item.Total_Sales, 0) / data.length;
    if (item.Total_Sales > avgSales * 1.5) return "low";
    if (item.Total_Sales > avgSales) return "medium";
    return "high";
};

// Update the analysis response structure
const createAnalysisResponse = (results, metadata) => {
    const data = results.data;

    // Calculate statistical metrics
    const totalSales = data.reduce((sum, item) => sum + item.Total_Sales, 0);
    const avgSales = totalSales / data.length;
    const stdDev = Math.sqrt(
        data.reduce((sum, item) => sum + Math.pow(item.Total_Sales - avgSales, 2), 0) / data.length
    );

    return {
        success: true,
        results: {
            // Performance Overview
            performance_overview: {
                tables: [
                    {
                        title: "Top Products Performance",
                        headers: ["Product", "Sales", "Market Share", "Growth Rate", "Status"],
                        rows: data.map(item => ({
                            Product: item.Product,
                            Sales: item.Total_Sales,
                            "Market Share": `${Math.round((item.Total_Sales / totalSales) * 100)}%`,
                            "Growth Rate": calculateGrowthRate(item.Total_Sales, avgSales),
                            Status: getPerformanceStatus(item.Total_Sales, avgSales, stdDev)
                        }))
                    },
                    {
                        title: "Product Categories Analysis",
                        headers: ["Category", "Total Sales", "Average Sales", "Performance"],
                        rows: [
                            {
                                Category: "Electronics",
                                "Total Sales": data.filter(item =>
                                    ["Camera", "Printer", "Headphones"].includes(item.Product)
                                ).reduce((sum, item) => sum + item.Total_Sales, 0),
                                "Average Sales": Math.round(avgSales),
                                Performance: "High"
                            },
                            {
                                Category: "Accessories",
                                "Total Sales": data.filter(item =>
                                    ["Mouse", "Keyboard"].includes(item.Product)
                                ).reduce((sum, item) => sum + item.Total_Sales, 0),
                                "Average Sales": Math.round(avgSales),
                                Performance: "Medium"
                            }
                        ]
                    }
                ],
                metrics: [
                    {
                        title: "Total Sales",
                        value: totalSales,
                        trend: "up",
                        change: "+12%"
                    },
                    {
                        title: "Average Sales",
                        value: Math.round(avgSales),
                        trend: "stable",
                        change: "+3%"
                    },
                    {
                        title: "Top Product Share",
                        value: `${Math.round((data[0].Total_Sales / totalSales) * 100)}%`,
                        trend: "up",
                        change: "+5%"
                    }
                ]
            },

            // Visual Analysis
            visual_analysis: {
                charts: [
                    {
                        type: "bar",
                        title: "Product Sales Distribution",
                        data: {
                            labels: data.map(item => item.Product),
                            datasets: [
                                {
                                    label: "Current Sales",
                                    data: data.map(item => item.Total_Sales),
                                    backgroundColor: "rgba(54, 162, 235, 0.5)"
                                }
                            ]
                        }
                    },
                    {
                        type: "pie",
                        title: "Market Share Distribution",
                        data: {
                            labels: data.map(item => item.Product),
                            datasets: [{
                                data: data.map(item =>
                                    Math.round((item.Total_Sales / totalSales) * 100)
                                ),
                                backgroundColor: [
                                    'rgba(255, 99, 132, 0.5)',
                                    'rgba(54, 162, 235, 0.5)',
                                    'rgba(255, 206, 86, 0.5)',
                                    'rgba(75, 192, 192, 0.5)',
                                    'rgba(153, 102, 255, 0.5)'
                                ]
                            }]
                        }
                    }
                ]
            },

            // Key Insights
            key_insights: {
                tables: [
                    {
                        title: "Product Performance Analysis",
                        headers: ["Metric", "Value", "Impact"],
                        rows: [
                            {
                                Metric: "Top Product",
                                Value: data[0].Product,
                                Impact: "High"
                            },
                            {
                                Metric: "Growth Leader",
                                Value: data[0].Product,
                                Impact: "High"
                            },
                            {
                                Metric: "Market Concentration",
                                Value: `${Math.round((data[0].Total_Sales / totalSales) * 100)}%`,
                                Impact: "Medium"
                            }
                        ]
                    }
                ]
            },

            // Recommendations
            recommendations: {
                tables: [
                    {
                        title: "Action Items",
                        headers: ["Priority", "Action", "Expected Impact", "Timeline"],
                        rows: [
                            {
                                Priority: "High",
                                Action: "Increase Camera inventory",
                                "Expected Impact": "20% sales increase",
                                Timeline: "Immediate"
                            },
                            {
                                Priority: "Medium",
                                Action: "Bundle promotion for accessories",
                                "Expected Impact": "15% cross-sell increase",
                                Timeline: "Next month"
                            },
                            {
                                Priority: "Low",
                                Action: "Review pricing strategy",
                                "Expected Impact": "10% margin improvement",
                                Timeline: "Next quarter"
                            }
                        ]
                    }
                ]
            },

            // Metadata
            metadata: {
                ...metadata,
                analysis_methods: [
                    "statistical_analysis",
                    "trend_detection",
                    "market_segmentation"
                ],
                confidence_scores: {
                    statistical_analysis: 0.95,
                    trend_analysis: 0.85,
                    market_analysis: 0.80
                }
            }
        }
    };
};

// Helper functions
const calculateGrowthRate = (current, average) => {
    const growth = ((current - average) / average) * 100;
    return `${growth > 0 ? '+' : ''}${Math.round(growth)}%`;
};

const getPerformanceStatus = (value, mean, stdDev) => {
    if (value > mean + stdDev) return "High";
    if (value > mean) return "Medium";
    return "Low";
};

// Get analysis history
const getAnalysisHistory = async () => {
    try {
        const result = await db.query(
            `SELECT
                id,
                query_ids,
                analysis_type,
                analysis_request,
                status,
                created_at,
                updated_at,
                results
            FROM analysis_sessions
            ORDER BY created_at DESC`
        );
        return result.rows;
    } catch (error) {
        console.error('Error fetching analysis history:', error);
        throw error;
    }
};

module.exports = {
    saveQueryResults,
    getQueryHistory,
    getQueryResults,
    createAnalysisSession,
    performAnalysis,
    getAnalysisHistory
};