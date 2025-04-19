-- Add cleanup functions
CREATE OR REPLACE FUNCTION cleanup_user_data(user_id UUID) RETURNS void AS $$
BEGIN
    -- Delete saved queries
    DELETE FROM saved_queries WHERE metadata->>'user_id' = user_id::text;

    -- Delete analysis sessions
    DELETE FROM analysis_sessions WHERE metadata->>'user_id' = user_id::text;

    -- Delete uploaded datasets
    DELETE FROM uploaded_files WHERE user_id = user_id;
END;
$$ LANGUAGE plpgsql;

-- Add cleanup_all function
CREATE OR REPLACE FUNCTION cleanup_all_data() RETURNS void AS $$
BEGIN
    -- Delete all saved queries
    DELETE FROM saved_queries;

    -- Delete all analysis sessions
    DELETE FROM analysis_sessions;

    -- Delete all uploaded files
    DELETE FROM uploaded_files;
END;
$$ LANGUAGE plpgsql;