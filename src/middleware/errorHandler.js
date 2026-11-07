export const errorHandler = (err, req, res, next) => {
    console.error('❌ Error handler caught:', err);
    
    // Handle specific error types
    if (err.message === 'Email already registered') {
        return res.status(400).json({ detail: err.message });
    }
    
    if (err.message === 'Cannot delete default template') {
        return res.status(400).json({ detail: err.message });
    }
    
    // Database errors
    if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ detail: 'Duplicate entry. This record already exists.' });
    }
    
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({ detail: 'Referenced record does not exist.' });
    }
    
    if (err.code === '23505') {
        return res.status(409).json({ detail: 'Duplicate entry. This record already exists.' });
    }

    // The body parser's own errors (too large, bad JSON) are client errors too
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ detail: 'That request is too large.' });
    }
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ detail: 'The request body is not valid JSON.' });
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ detail: 'Invalid token' });
    }
    
    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ detail: 'Token expired' });
    }
    
    // Default error
    console.error('❌ Unhandled error:', err.stack);
    const statusCode = err.statusCode || err.status || 500;
    // 4xx messages are written for the user. A 5xx message can contain SQL, table names or file paths: log it, don't send it.
    const detailMessage = statusCode >= 500 ? 'Something went wrong on our side. Please try again.' : (err.detail || err.message || 'Request failed');
    res.status(statusCode).json({
        detail: detailMessage
    });
};