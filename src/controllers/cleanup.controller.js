const db = require('../database/db');

// Cleanup user's data
const cleanupUserData = async (req, res) => {
    try {
        const { user_id } = req.body;

        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'User ID is required'
            });
        }

        await db.query('SELECT cleanup_user_data($1)', [user_id]);

        res.json({
            success: true,
            message: 'User data cleaned up successfully'
        });
    } catch (error) {
        console.error('Error cleaning up user data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clean up user data'
        });
    }
};

// Cleanup all data
const cleanupAllData = async (req, res) => {
    try {
        await db.query('SELECT cleanup_all_data()');

        res.json({
            success: true,
            message: 'All data cleaned up successfully'
        });
    } catch (error) {
        console.error('Error cleaning up all data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clean up all data'
        });
    }
};

module.exports = {
    cleanupUserData,
    cleanupAllData
};