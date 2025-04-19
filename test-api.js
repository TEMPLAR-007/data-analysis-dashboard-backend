// Simple client-side test script to demonstrate API usage
const fetch = require('node-fetch');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const API_URL = 'http://localhost:3000/api';

// Test uploading a file
async function testFileUpload(filePath) {
    try {
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));

        // Extract file name without extension to use as table name
        const fileName = path.basename(filePath).split('.')[0];
        form.append('tableName', fileName);

        console.log(`Uploading file ${filePath}...`);

        const response = await fetch(`${API_URL}/upload/file`, {
            method: 'POST',
            body: form
        });

        const result = await response.json();
        console.log('Upload result:', result);

        return result;
    } catch (error) {
        console.error('Error uploading file:', error);
    }
}

// Test listing tables
async function testListTables() {
    try {
        console.log('Listing tables...');

        const response = await fetch(`${API_URL}/upload/tables`);
        const result = await response.json();

        console.log('Tables:', result.tables);
        return result.tables;
    } catch (error) {
        console.error('Error listing tables:', error);
    }
}

// Test getting table schema
async function testGetSchema(tableName) {
    try {
        console.log(`Getting schema for table ${tableName}...`);

        const response = await fetch(`${API_URL}/query/schema/${tableName}`);
        const result = await response.json();

        console.log('Schema:', result.columns);
        return result.columns;
    } catch (error) {
        console.error('Error getting schema:', error);
    }
}

// Test natural language query
async function testNaturalLanguageQuery(userQuery, tableName) {
    try {
        console.log(`Processing query: "${userQuery}" for table ${tableName}...`);

        const response = await fetch(`${API_URL}/query/process`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userQuery,
                tableName
            })
        });

        const result = await response.json();
        console.log('Query result:');
        console.log(`Original query: ${result.original_query}`);
        console.log(`SQL query: ${result.sql_query}`);
        console.log(`Answer: ${result.answer}`);
        console.log('Filtered data:', result.filtered_data);

        if (result.chart_data) {
            console.log('Chart data available:', result.chart_data.type);
        }

        return result;
    } catch (error) {
        console.error('Error processing query:', error);
    }
}

// Main function to run all tests
async function runTests() {
    // Example file path - change this to your actual test file
    const testFilePath = './example_data.csv';

    // Check if the file exists
    if (!fs.existsSync(testFilePath)) {
        console.error(`Test file ${testFilePath} not found. Please create this file or update the path.`);
        return;
    }

    // 1. Upload file
    const uploadResult = await testFileUpload(testFilePath);
    if (!uploadResult || !uploadResult.success) {
        console.error('File upload failed, stopping tests.');
        return;
    }

    const tableName = uploadResult.tableName;

    // 2. List tables
    await testListTables();

    // 3. Get schema
    await testGetSchema(tableName);

    // 4. Test some natural language queries
    await testNaturalLanguageQuery('What is the total count?', tableName);
    await testNaturalLanguageQuery('Show me the maximum value', tableName);
    await testNaturalLanguageQuery('Find the average values grouped by category', tableName);
}

// Run the tests
runTests().catch(console.error);

// Note: Before running this script:
// 1. Make sure the server is running (npm run dev)
// 2. Create an example_data.csv file or change the testFilePath
// 3. Install form-data package if not already included (npm install form-data)