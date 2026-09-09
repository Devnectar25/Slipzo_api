-- Drop existing tables if they exist (be careful with this in production)
-- DROP TABLE IF EXISTS bill_items;
-- DROP TABLE IF EXISTS bills;
-- DROP TABLE IF EXISTS templates;
-- DROP TABLE IF EXISTS shops;
-- DROP TABLE IF EXISTS sessions;
-- DROP TABLE IF EXISTS users;

-- Create database if not exists
CREATE DATABASE IF NOT EXISTS slipzo;
USE slipzo;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email)
);

-- Shops table
CREATE TABLE IF NOT EXISTS shops (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_shop (user_id)
);

-- Templates table - FIXED: Removed DEFAULT from TEXT column
CREATE TABLE IF NOT EXISTS templates (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    width VARCHAR(20) DEFAULT '58mm',
    show_tax BOOLEAN DEFAULT TRUE,
    tax_rate DECIMAL(5,2) DEFAULT 18.00,
    footer TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id)
);

-- Bills table
CREATE TABLE IF NOT EXISTS bills (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
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
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    bill_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    rate DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    amount DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
    INDEX idx_bill_id (bill_id)
);

-- Sessions table (for JWT token management)
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    token VARCHAR(500) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_token (token),
    INDEX idx_expires_at (expires_at)
);