const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadFile, listTables, deleteTable, getTableDetails } = require('../controllers/upload.controller');

const router = express.Router();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// File filter for accepted file types
const fileFilter = (req, file, cb) => {
    const allowedExtensions = ['.csv', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedExtensions.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Only CSV and Excel files are allowed'), false);
    }
};

// Configure multer upload
const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Routes
router.post('/file', upload.single('file'), uploadFile);
router.get('/tables', listTables);
router.get('/table/:tableName', getTableDetails);
router.delete('/table/:tableName', deleteTable);

module.exports = {
    uploadRoutes: router
};