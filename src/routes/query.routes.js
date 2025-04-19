const express = require('express');
const { processQuery, getSchema, executeRawQuery, deleteSavedQuery, getAllSavedQueries, getSavedQueryById } = require('../controllers/query.controller');

const router = express.Router();

// Routes
router.post('/process', processQuery);
router.get('/schema/:tableName', getSchema);
router.post('/execute', executeRawQuery);
router.delete('/saved/:queryId', deleteSavedQuery);
router.get('/saved', getAllSavedQueries);
router.get('/saved/:queryId', getSavedQueryById);

module.exports = {
    queryRoutes: router
};