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
    
    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ detail: 'Invalid token' });
    }
    
    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ detail: 'Token expired' });
    }
    
    // Default error
    console.error('❌ Unhandled error:', err.stack);
    res.status(500).json({ 
        detail: process.env.NODE_ENV === 'development' 
            ? err.message 
            : 'Internal server error' 
    });
};