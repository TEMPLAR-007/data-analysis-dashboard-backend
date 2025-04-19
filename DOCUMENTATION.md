# Smart Data Query Backend - Documentation

## Overview

This project is a backend system that allows users to upload business data in the form of CSV or Excel files and query that data using natural language questions. The system automatically infers the data schema, creates a PostgreSQL table, and enables querying through a natural language interface that converts questions to SQL using OpenAI's GPT-3.5 model.

## Architecture

The system follows a modular architecture with the following components:

1. **API Layer**: Express.js for handling HTTP requests
2. **File Processing**: Handling CSV/XLSX uploads and parsing
3. **Database Layer**: PostgreSQL for data storage and querying
4. **AI Integration**: OpenAI/OpenRouter for natural language to SQL conversion
5. **Response Formatting**: Structured JSON responses with chart suggestions

## Installation and Setup

### Prerequisites

- Node.js (v14+)
- PostgreSQL
- OpenRouter API key

### Installation Steps

1. Clone the repository:
   ```
   git clone <repository-url>
   cd data-query-backend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Configure environment variables:
   Create a `.env` file with the following variables:
   ```
   PORT=3000
   DB_HOST=localhost
   DB_PORT=5432
   DB_USER=your_db_user
   DB_PASSWORD=your_db_password
   DB_NAME=business_data
   OPENROUTER_API_KEY=your_openrouter_api_key
   OPENAI_MODEL=openai/gpt-3.5-turbo
   ```

4. Start the server:
   ```
   npm run dev
   ```

## API Reference

### Upload Endpoints

#### Upload a File
- **URL**: `/api/upload/file`
- **Method**: `POST`
- **Content-Type**: `multipart/form-data`
- **Parameters**:
  - `file`: The CSV or Excel file to upload
  - `tableName` (optional): Custom name for the database table
- **Response**:
  ```json
  {
    "success": true,
    "message": "File uploaded and processed successfully. Created table 'sales_data' with 100 rows.",
    "tableName": "sales_data",
    "rowCount": 100,
    "columns": [
      {"name": "id", "type": "INTEGER"},
      {"name": "date", "type": "DATE"},
      {"name": "revenue", "type": "NUMERIC"}
    ]
  }
  ```

#### List Tables
- **URL**: `/api/upload/tables`
- **Method**: `GET`
- **Response**:
  ```json
  {
    "tables": ["sales_data", "employee_data", "inventory"]
  }
  ```

### Query Endpoints

#### Process Natural Language Query
- **URL**: `/api/query/process`
- **Method**: `POST`
- **Content-Type**: `application/json`
- **Request Body**:
  ```json
  {
    "userQuery": "What was the total revenue for Electronics category in March?",
    "tableName": "sales_data"
  }
  ```
- **Response**:
  ```json
  {
    "original_query": "What was the total revenue for Electronics category in March?",
    "sql_query": "SELECT SUM(revenue) as total_revenue FROM sales_data WHERE category = 'Electronics' AND date >= '2023-03-01' AND date <= '2023-03-31'",
    "answer": "The total_revenue is 2850.",
    "filtered_data": [
      {"total_revenue": 2850}
    ],
    "chart_data": null,
    "source": "sql"
  }
  ```

#### Get Table Schema
- **URL**: `/api/query/schema/:tableName`
- **Method**: `GET`
- **Response**:
  ```json
  {
    "table_name": "sales_data",
    "columns": [
      {"column_name": "id", "data_type": "integer"},
      {"column_name": "date", "data_type": "date"},
      {"column_name": "category", "data_type": "text"},
      {"column_name": "revenue", "data_type": "numeric"}
    ]
  }
  ```

#### Execute Raw SQL Query
- **URL**: `/api/query/execute`
- **Method**: `POST`
- **Content-Type**: `application/json`
- **Request Body**:
  ```json
  {
    "sqlQuery": "SELECT * FROM sales_data LIMIT 10"
  }
  ```
- **Response**:
  ```json
  {
    "sql_query": "SELECT * FROM sales_data LIMIT 10",
    "rows": [...],
    "rowCount": 10
  }
  ```

## Core Components

### File Parsing

Files are parsed using:
- `papaparse` for CSV files
- `xlsx` for Excel files

The parser automatically infers data types for columns based on the values:
- Text values -> TEXT
- Date values -> DATE
- Numeric values -> INTEGER or NUMERIC

### Database Operations

The system dynamically creates tables based on the inferred schema and handles data insertion.

### Natural Language to SQL Conversion

1. User submits a natural language query
2. The system retrieves the table schema and sample data
3. This information is sent to the OpenAI/OpenRouter API with a carefully crafted prompt
4. The API returns an SQL query
5. The system executes the SQL query against the PostgreSQL database
6. Results are formatted into a structured JSON response

### Chart Suggestions

When query results are returned, the system analyzes them to determine if they're suitable for visualization:
- Numeric columns are identified for chart values
- Non-numeric columns are used for labels
- Chart types are suggested based on the data structure

## Testing

The project includes a test script (`test-api.js`) that demonstrates the API usage. Run it using:

```
npm run test-api
```

This script:
1. Uploads a sample CSV file
2. Lists all tables
3. Gets the schema for the uploaded table
4. Executes several natural language queries

## Error Handling

The API implements comprehensive error handling:
- File validation errors (unsupported formats, empty files)
- Database connection and query errors
- API integration errors
- Client request validation

## Performance Considerations

- Files are processed in batches to handle large datasets
- Database indexes can be added for frequently queried columns
- Database connection pooling is implemented for efficiency

## Security Considerations

- Input validation for all API endpoints
- SQL injection protection through parameterized queries
- Rate limiting (can be added as middleware)
- API key authentication for the AI service

## Future Extensions

As outlined in the project requirements, future phases may include:
1. Saved queries as filters
2. Full AI data reasoning for complex analysis
3. Filter comparison and insights
4. Export functionality and user dashboard

## Troubleshooting

Common issues and solutions:

1. **Database Connection Issues**
   - Verify PostgreSQL is running
   - Check credentials in .env file
   - Ensure the database exists and has proper permissions

2. **File Upload Problems**
   - Check file size (limit is 10MB)
   - Ensure file format is CSV, XLS, or XLSX
   - Verify upload directory permissions

3. **API Key Issues**
   - Make sure your OpenRouter API key is valid
   - Check for billing or rate limit issues

4. **Query Generation Problems**
   - Ensure your natural language query is clear
   - Verify that table schema is correctly inferred
   - Check sample data for format consistency