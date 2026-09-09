import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const migrate = async () => {
    console.log('🚀 Starting database migration...');
    console.log('📦 Creating tables for Slipzo...');

    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            multipleStatements: true
        });

        // Create database if not exists
        const dbName = process.env.DB_NAME || 'slipzo';
        await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`);
        console.log(`✅ Database '${dbName}' created/verified`);

        await connection.end();

        // Connect with database
        const dbConnection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: dbName,
            multipleStatements: true
        });

        console.log('📝 Creating tables...');

        // Create tables directly (without reading from file)
        const schema = `
            -- Users table
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(36) PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_email (email)
            );

            -- Shops table
            CREATE TABLE IF NOT EXISTS shops (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                name VARCHAR(255) NOT NULL,
                address TEXT,
                phone VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_user_shop (user_id)
            );

            -- Templates table
            CREATE TABLE IF NOT EXISTS templates (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                name VARCHAR(255) NOT NULL,
                width VARCHAR(20) DEFAULT '58mm',
                show_tax BOOLEAN DEFAULT TRUE,
                tax_rate DECIMAL(5,2) DEFAULT 18.00,
                footer TEXT DEFAULT 'Thank you for shopping with us!',
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_user_id (user_id)
            );

            -- Bills table
            CREATE TABLE IF NOT EXISTS bills (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                template_id VARCHAR(36) NOT NULL,
                number VARCHAR(50) UNIQUE NOT NULL,
                discount DECIMAL(10,2) DEFAULT 0.00,
                tax_rate DECIMAL(5,2) DEFAULT 0.00,
                payment_mode VARCHAR(50) DEFAULT 'Cash',
                shop_name VARCHAR(255) NOT NULL,
                shop_address TEXT,
                shop_phone VARCHAR(50),
                template_name VARCHAR(255),
                subtotal DECIMAL(10,2) DEFAULT 0.00,
                tax_amount DECIMAL(10,2) DEFAULT 0.00,
                total DECIMAL(10,2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (template_id) REFERENCES templates(id),
                INDEX idx_user_id (user_id),
                INDEX idx_created_at (created_at),
                INDEX idx_number (number)
            );

            -- Bill Items table
            CREATE TABLE IF NOT EXISTS bill_items (
                id VARCHAR(36) PRIMARY KEY,
                bill_id VARCHAR(36) NOT NULL,
                name VARCHAR(255) NOT NULL,
                quantity INT NOT NULL DEFAULT 1,
                rate DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                amount DECIMAL(10,2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
                INDEX idx_bill_id (bill_id)
            );

            -- Sessions table
            CREATE TABLE IF NOT EXISTS sessions (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                token VARCHAR(500) NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_token (token),
                INDEX idx_expires_at (expires_at)
            );
        `;

        await dbConnection.query(schema);
        
        console.log('✅ Tables created successfully!');
        
        // Show tables
        const [tables] = await dbConnection.query('SHOW TABLES');
        console.log('\n📊 Tables created:');
        tables.forEach(row => {
            console.log(`   - ${Object.values(row)[0]}`);
        });

        await dbConnection.end();

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        if (error.sql) {
            console.error('SQL Error:', error.sql);
        }
        process.exit(1);
    }
};

migrate();