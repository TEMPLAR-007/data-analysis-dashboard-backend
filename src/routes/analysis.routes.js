const express = require('express');
const router = express.Router();
const analysisController = require('../controllers/analysis.controller');

// Get analysis history
router.get('/history', async (req, res) => {
    try {
        const { detailed = false } = req.query; // Optional parameter for all detailed results
        const history = await analysisController.getAnalysisHistory();

        res.json({
            success: true,
            history: history.map(session => ({
                id: session.id,
                analysis_type: session.analysis_type,
                analysis_request: session.analysis_request,
                status: session.status,
                created_at: session.created_at,
                updated_at: session.updated_at,
                query_count: session.query_ids.length,
                has_results: !!session.results,
                results: detailed && session.results ? {
                    trends: session.results.trends,
                    findings: session.results.findings,
                    insights: session.results.insights,
                    recommendations: session.results.recommendations,
                    visualization: session.results.visualization,
                    metadata: {
                        analyzing_query: session.results.metadata?.analyzing_query,
                        original_queries: session.results.metadata?.original_queries,
                        analysis_type: session.results.metadata?.analysis_type,
                        processing_time: session.results.metadata?.processing_time,
                        timestamp: session.results.metadata?.timestamp,
                        query_ids: session.results.metadata?.query_ids,
                        data_sources: session.results.metadata?.data_sources
                    }
                } : null
            }))
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error fetching analysis history',
            details: error.message
        });
    }
});

// Get detailed results for a specific analysis
router.get('/history/:id', async (req, res) => {
    try {
        const history = await analysisController.getAnalysisHistory();
        const session = history.find(s => s.id === req.params.id);

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Analysis not found',
                details: `No analysis found with ID: ${req.params.id}`
            });
        }

        // Transform the response to emphasize the dashboard visualization
        const dashboard = {
            id: session.id,
            title: session.analysis_request,
            type: session.analysis_type,
            status: session.status,
            created_at: session.created_at,
            updated_at: session.updated_at,
            insights: {
                trends: session.results?.trends || [],
                findings: session.results?.findings || [],
                insights: session.results?.insights || [],
                recommendations: session.results?.recommendations || []
            },
            visualization: session.results?.visualization || {
                type: "dashboard",
                layout: [],
                components: {}
            },
            metadata: session.results?.metadata || {}
        };

        res.json({
            success: true,
            dashboard
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error fetching analysis details',
            details: error.message
        });
    }
});

// Get query history for a table
router.get('/history/:tableName', async (req, res) => {
    try {
        const history = await analysisController.getQueryHistory(req.params.tableName);
        res.json({ success: true, history });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error fetching query history',
            details: error.message
        });
    }
});

// Get specific query results
router.get('/query/:queryId', async (req, res) => {
    try {
        const results = await analysisController.getQueryResults(req.params.queryId);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error fetching query results',
            details: error.message
        });
    }
});

// Create analysis session
router.post('/', async (req, res) => {
    try {
        const { query_ids, analysis_type, analysis_request } = req.body;

        // Only check for required fields
        if (!query_ids || !analysis_request) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                details: 'query_ids and analysis_request are required'
            });
        }

        const sessionId = await analysisController.createAnalysisSession(
            query_ids,
            analysis_type, // This can be undefined, it will be detected automatically
            analysis_request
        );

        res.json({
            success: true,
            session_id: sessionId,
            message: 'Analysis session created successfully',
            analysis_request
        });
    } catch (error) {
        // Check if it's a validation error
        if (error.message.includes('Invalid analysis request')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid analysis request',
                details: error.message
            });
        }

        res.status(500).json({
            success: false,
            error: 'Error creating analysis session',
            details: error.message
        });
    }
});

// Get analysis results
router.get('/:sessionId', async (req, res) => {
    try {
        const results = await analysisController.performAnalysis(req.params.sessionId);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error performing analysis',
            details: error.message
        });
    }
});

// Delete analysis session
router.delete('/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        // Check if the analysis exists
        const history = await analysisController.getAnalysisHistory();
        const session = history.find(s => s.id === sessionId);

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Analysis not found',
                details: `No analysis found with ID: ${sessionId}`
            });
        }

        // Delete from database
        const db = require('../utils/db');
        await db.query(
            `DELETE FROM analysis_sessions WHERE id = $1`,
            [sessionId]
        );

        res.json({
            success: true,
            message: 'Analysis session deleted successfully',
            id: sessionId
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error deleting analysis session',
            details: error.message
        });
    }
});

module.exports = router;