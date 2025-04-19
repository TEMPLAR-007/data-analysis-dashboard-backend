const fs = require('fs');
const path = require('path');
const db = require('./db');

async function runMigrations() {
    try {
        console.log('Running database migrations...');

        // Create migrations table if it doesn't exist
        await db.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Get list of migration files
        const migrationsDir = path.join(__dirname, 'migrations');
        const migrationFiles = fs.readdirSync(migrationsDir)
            .filter(file => file.endsWith('.sql'))
            .sort(); // Ensure migrations run in order

        // Get already executed migrations
        const executedMigrations = await db.query('SELECT name FROM migrations');
        const executedNames = executedMigrations.rows.map(row => row.name);

        // Run pending migrations
        for (const file of migrationFiles) {
            if (!executedNames.includes(file)) {
                console.log(`Running migration: ${file}`);
                const migrationPath = path.join(migrationsDir, file);
                const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

                // Run migration in a transaction
                await db.query('BEGIN');
                try {
                    // Check if tables exist before creating them
                    const tableCheckSQL = migrationSQL
                        .split(';')
                        .filter(stmt => stmt.trim().toUpperCase().startsWith('CREATE TABLE'))
                        .map(stmt => {
                            const tableName = stmt.match(/CREATE TABLE.*?(\w+)\s*\(/i)?.[1];
                            return tableName ? `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '${tableName}') as exists;` : '';
                        })
                        .filter(Boolean)
                        .join('\n');

                    if (tableCheckSQL) {
                        const tableChecks = await db.query(tableCheckSQL);
                        const existingTables = tableChecks.rows.filter(row => row.exists).length;
                        if (existingTables > 0) {
                            console.log(`Skipping table creation in ${file} as tables already exist`);
                            continue;
                        }
                    }

                    await db.query(migrationSQL);
                    await db.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
                    await db.query('COMMIT');
                    console.log(`Migration ${file} completed successfully`);
                } catch (error) {
                    await db.query('ROLLBACK');
                    if (error.code === '42P07') { // Table already exists
                        console.log(`Table already exists in ${file}, skipping...`);
                        await db.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
                        continue;
                    }
                    throw error;
                }
            }
        }

        console.log('All migrations completed successfully');
    } catch (error) {
        console.error('Error running migrations:', error);
        throw error;
    }
}

module.exports = runMigrations;