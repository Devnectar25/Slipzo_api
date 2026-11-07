import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { initDatabase, queryOne } from './src/config/database.js';
import authRoutes from './src/routes/authRoutes.js';
import shopRoutes from './src/routes/shopRoutes.js';
import templateRoutes from './src/routes/templateRoutes.js';
import billRoutes from './src/routes/billRoutes.js';
import customerRoutes from './src/routes/customerRoutes.js';
import productRoutes from './src/routes/productRoutes.js';
import menuRoutes from './src/routes/menuRoutes.js';
import smallBusinessRoutes from './src/routes/smallBusinessRoutes.js';
import contactRoutes from './src/routes/contactRoutes.js';
import subscriptionRoutes from './src/routes/subscriptionRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';
import restaurantRoutes from './src/routes/restaurantRoutes.js';
import { errorHandler } from './src/middleware/errorHandler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Security middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting (relaxed for development and admin)
// Behind Vercel/another proxy, req.ip is the proxy unless told to trust it; without this every user shares one rate limit
app.set('trust proxy', 1);

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10000, // Generous limit so users and admins never hit 429 errors
    skip: (req) => req.originalUrl?.includes('/admin') || req.path?.includes('/admin'),
    message: { detail: 'Too many requests, please try again later.' }
});
app.use('/api', limiter);

// Compression
app.use(compression());

// CORS configuration
const envOrigins = process.env.FRONTEND_URL 
    ? process.env.FRONTEND_URL.split(',').map(url => url.trim()) 
    : [];

const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://slipzo.vercel.app',
    'https://slipzo.in',
    'https://www.slipzo.in',
    ...envOrigins
].filter(Boolean);

// The web app in dev, and the Android app (Capacitor serves it from http://localhost or capacitor://localhost)
const isLocalOrigin = (origin) =>
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin === 'capacitor://localhost' || origin === 'ionic://localhost';

const corsOptions = {
    origin: (origin, callback) => {
        // No Origin header: same-origin requests, curl, server-to-server. Browsers always send one for cross-site calls.
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || isLocalOrigin(origin)) return callback(null, true);
        // Not an allowed site: answer without CORS headers so the browser blocks the page from reading the response
        return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Middleware
app.use(cookieParser());
// Only the routes that receive photos (shop logo, menu item images, admin products) may send big bodies.
// Everything else is capped at 1 MB so one request cannot make the server hold tens of megabytes.
const BIG_BODY_PREFIXES = ['/api/shop', '/api/menu', '/api/admin', '/api/small-business', '/api/products'];
const bigJson = express.json({ limit: '50mb' });
const smallJson = express.json({ limit: '1mb' });
app.use((req, res, next) => (BIG_BODY_PREFIXES.some((p) => req.path.startsWith(p)) ? bigJson : smallJson)(req, res, next));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Initialize database
console.log('🔧 Initializing database...');
initDatabase()
    .then(() => {
        console.log('✅ Database initialization complete');
    })
    .catch((error) => {
        console.warn('⚠️ Database initialization warning:', error.message || error);
    });

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/small-business', smallBusinessRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/restaurant', restaurantRoutes);
app.use('/api/tables', restaurantRoutes);

// Root & Health check endpoints
app.get('/', (req, res) => {
    res.json({
        name: 'Slipzen API Server',
        status: 'online',
        version: '1.0.0',
        health: '/api/health'
    });
});

app.get('/api', (req, res) => {
    res.json({
        name: 'Slipzen API',
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/health', async (req, res) => {
    try {
        const dbResult = await queryOne('SELECT COUNT(*) as count FROM users');
        res.json({
            status: 'healthy',
            database: 'connected (Supabase PostgreSQL)',
            totalUsers: parseInt(dbResult?.count || 0),
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({
            status: 'degraded',
            database: 'disconnected',
            error: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Error handler
app.use(errorHandler);

if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Slipzo backend running on http://127.0.0.1:${PORT}`);
        console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 API URL: http://127.0.0.1:${PORT}/api`);
    });
}

// Handle unhandled rejections
process.on('unhandledRejection', (err) => {
    console.error('❌ Unhandled rejection:', err);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught exception:', err);
});

export default app;