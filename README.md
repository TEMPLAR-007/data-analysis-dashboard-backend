# Smart Data Query Backend

A backend system that allows users to upload business data (CSV/XLSX) and query it using natural language, which gets converted to SQL and executed against a PostgreSQL database.

## Features

- Upload CSV and Excel files
- Automatic schema inference
- Natural language to SQL conversion using GPT-3.5
- Structured JSON response with chart suggestions
- RESTful API for integration with any frontend

## Tech Stack

- Node.js + Express
- PostgreSQL
- OpenAI GPT-3.5-Turbo (via OpenRouter)
- File parsing: xlsx, papaparse

## Prerequisites

- Node.js (v14+)
- PostgreSQL database
- OpenRouter API key

## Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Set up environment variables (see `.env` file)
4. Make sure PostgreSQL is running
5. Start the server:
   ```
   npm run dev
   ```

## API Endpoints

### Upload

- `POST /api/upload/file` - Upload a file (CSV or Excel)
  - Request: multipart/form-data with `file` field
  - Optional: `tableName` field to specify a custom table name
  - Optional: `overwrite=true` to replace an existing table

- `GET /api/upload/tables` - List all available tables

- `GET /api/upload/table/:tableName` - Get table details
  - Returns schema, row count, and sample data
  - Optional query param: `limit` to specify number of sample rows (default: 5)

- `DELETE /api/upload/table/:tableName` - Delete a table

### Query

- `POST /api/query/process` - Process a natural language query
  - Request body:
    ```json
    {
      "userQuery": "What was the total revenue last month?",
      "tableName": "sales_data"
    }
    ```

- `GET /api/query/schema/:tableName` - Get schema for a specific table

- `POST /api/query/execute` - Execute a raw SQL query
  - Request body:
    ```json
    {
      "sqlQuery": "SELECT * FROM sales_data LIMIT 10"
    }
    ```

## Response Format

The query response is structured as:

```json
{
  "original_query": "What was the total revenue last month?",
  "sql_query": "SELECT SUM(revenue) as total_revenue FROM sales_data WHERE...",
  "answer": "Total revenue last month was $50,000",
  "filtered_data": [ ... ],
  "chart_data": {
    "type": "bar",
    "labels": [ ... ],
    "datasets": [ ... ]
  },
  "source": "sql"
}
```

## Future Enhancements

- Save queries as filters
- Enable full AI data reasoning
- Compare saved filters
- Export reports (PDF, CSV)
- User authentication and dashboard

## License

MIT