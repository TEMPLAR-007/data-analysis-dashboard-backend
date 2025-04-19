const XLSX = require('xlsx');
const Papa = require('papaparse');
const fs = require('fs');

// Improved date validation
const isValidDate = (value) => {
    // Skip short values that are likely not dates
    if (typeof value === 'string' && value.length < 6) return false;

    // Check if it's a number (like "9") - not a date
    if (!isNaN(value) && value.toString().length < 4) return false;

    // If it looks like a currency or numeric value, it's not a date
    if (typeof value === 'string' &&
        (value.includes('$') ||
            (value.match(/^-?\d+(\.\d+)?$/) && !value.includes('/')))) {
        return false;
    }

    // Try to parse as date
    const date = new Date(value);
    return !isNaN(date.getTime());
};

// Check if looks like currency/money
const isCurrency = (value) => {
    if (typeof value === 'string') {
        // Check for currency symbols or formats like "$100", "100.00", "1,000.00"
        return value.includes('$') ||
            value.match(/^-?\d+(,\d{3})*(\.\d+)?$/) ||
            (value.match(/^-?\d+(\.\d+)?$/) && value.includes('.'));
    }
    return false;
};

// Infer PostgreSQL data type from column values and column name
const inferDataType = (values, columnName = '') => {
    // Filter out null and undefined values
    const validValues = values.filter(v => v !== null && v !== undefined && v !== '');

    if (validValues.length === 0) return 'TEXT';

    // Check column name for hints - common patterns for financial/numeric columns
    const lowerColName = columnName.toLowerCase();
    const likelyNumericColumn = lowerColName.includes('price') ||
        lowerColName.includes('cost') ||
        lowerColName.includes('total') ||
        lowerColName.includes('amount') ||
        lowerColName.includes('sum') ||
        lowerColName.includes('qty') ||
        lowerColName.includes('quantity');

    // If column name suggests money, check if values look like currency
    if (likelyNumericColumn) {
        const currencyCount = validValues.filter(v => isCurrency(v) || !isNaN(Number(v))).length;
        if (currencyCount > 0 && currencyCount / validValues.length >= 0.7) {
            return 'NUMERIC';
        }
    }

    // Check if all values can be parsed as dates
    const possibleDateCount = validValues.filter(v => isValidDate(v)).length;
    if (possibleDateCount === validValues.length && possibleDateCount > 0) {
        // If column name contains date/time hints, it's more likely to be a date
        if (lowerColName.includes('date') ||
            lowerColName.includes('time') ||
            lowerColName.includes('day') ||
            lowerColName.includes('month') ||
            lowerColName.includes('year')) {
            return 'DATE';
        }

        // Need a high percentage to classify as date
        if (possibleDateCount / validValues.length > 0.9) {
            return 'DATE';
        }
    }

    // Check if all values can be parsed as numbers
    const possibleNumberCount = validValues.filter(v => !isNaN(Number(v))).length;
    if (possibleNumberCount === validValues.length) {
        // Check if all are integers
        const integerCount = validValues.filter(v => Number.isInteger(Number(v))).length;
        if (integerCount === validValues.length) return 'INTEGER';
        return 'NUMERIC';
    }

    // Default to TEXT for string values
    return 'TEXT';
};

// Parse CSV files
const parseCSV = (filePath) => {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, fileData) => {
            if (err) {
                return reject(err);
            }

            Papa.parse(fileData, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    const { data, meta } = results;

                    // Generate column schema with column name hint
                    const columns = meta.fields.map(field => {
                        const values = data.map(row => row[field]);
                        return {
                            name: field,
                            type: inferDataType(values, field)
                        };
                    });

                    resolve({ data, columns });
                },
                error: (error) => {
                    reject(error);
                }
            });
        });
    });
};

// Parse Excel files
const parseXLSX = (filePath) => {
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Convert sheet to JSON
        const data = XLSX.utils.sheet_to_json(worksheet);

        if (data.length === 0) {
            throw new Error('Excel file is empty');
        }

        // Get column names from the first row
        const columnNames = Object.keys(data[0]);

        // Generate column schema with column name hint
        const columns = columnNames.map(field => {
            const values = data.map(row => row[field]);
            return {
                name: field,
                type: inferDataType(values, field)
            };
        });

        return { data, columns };
    } catch (error) {
        throw error;
    }
};

// Parse file based on extension
const parseFile = async (filePath) => {
    try {
        const fileExtension = filePath.split('.').pop().toLowerCase();

        if (fileExtension === 'csv') {
            return await parseCSV(filePath);
        } else if (['xlsx', 'xls'].includes(fileExtension)) {
            return parseXLSX(filePath);
        } else {
            throw new Error('Unsupported file format. Please upload CSV or Excel files.');
        }
    } catch (error) {
        throw error;
    }
};

module.exports = {
    parseFile,
    inferDataType
};