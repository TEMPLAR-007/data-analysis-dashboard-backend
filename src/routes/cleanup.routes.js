const express = require('express');
const router = express.Router();
const { cleanupUserData, cleanupAllData } = require('../controllers/cleanup.controller');

// Cleanup user's data
router.post('/user', cleanupUserData);

// Cleanup all data (admin only)
router.post('/all', cleanupAllData);

module.exports = router;