import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { db } from '../src/config/database.js'; // Old in-memory database

dotenv.config();

const migrateData = async () => {
    console.log('🚀 Starting data migration...');

    // Initialize old database first
    // Note: Your old db should already have data
    
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'slipzo',
        multipleStatements: true
    });

    try {
        // Start transaction
        await connection.beginTransaction();

        // 1. Migrate Users
        console.log('📊 Migrating users...');
        for (const user of db.users) {
            // Check if user already exists
            const [existing] = await connection.query(
                'SELECT id FROM users WHERE email = ?',
                [user.email]
            );

            if (existing.length === 0) {
                await connection.query(
                    `INSERT INTO users (id, email, password, name, created_at, updated_at) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [user.id, user.email, user.password, user.name, user.created_at, user.updated_at]
                );
                console.log(`   ✅ User migrated: ${user.email}`);
            } else {
                console.log(`   ⏭️ User already exists: ${user.email}`);
            }
        }

        // 2. Migrate Shops
        console.log('\n📊 Migrating shops...');
        for (const shop of db.shops) {
            await connection.query(
                `INSERT INTO shops (id, user_id, name, address, phone, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE 
                 name = VALUES(name), address = VALUES(address), phone = VALUES(phone)`,
                [shop.id, shop.user_id, shop.name, shop.address || '', shop.phone || '', 
                 shop.created_at, shop.updated_at]
            );
            console.log(`   ✅ Shop migrated: ${shop.name}`);
        }

        // 3. Migrate Templates
        console.log('\n📊 Migrating templates...');
        for (const template of db.templates) {
            await connection.query(
                `INSERT INTO templates (id, user_id, name, width, show_tax, tax_rate, footer, is_default, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 name = VALUES(name), width = VALUES(width), show_tax = VALUES(show_tax),
                 tax_rate = VALUES(tax_rate), footer = VALUES(footer), is_default = VALUES(is_default)`,
                [template.id, template.user_id, template.name, template.width || '58mm',
                 template.show_tax !== undefined ? template.show_tax : true,
                 template.tax_rate || 18, template.footer || 'Thank you for shopping with us!',
                 template.is_default || false, template.created_at, template.updated_at]
            );
            console.log(`   ✅ Template migrated: ${template.name}`);
        }

        // 4. Migrate Bills
        console.log('\n📊 Migrating bills...');
        for (const bill of db.bills) {
            await connection.query(
                `INSERT INTO bills (id, user_id, template_id, number, discount, tax_rate, 
                    payment_mode, shop_name, shop_address, shop_phone, template_name,
                    subtotal, tax_amount, total, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 user_id = VALUES(user_id), template_id = VALUES(template_id)`,
                [bill.id, bill.user_id, bill.template_id, bill.number, bill.discount || 0,
                 bill.tax_rate || 0, bill.payment_mode || 'Cash', bill.shop_name || '',
                 bill.shop_address || '', bill.shop_phone || '', bill.template_name || '',
                 bill.subtotal || 0, bill.tax_amount || 0, bill.total || 0, bill.created_at]
            );

            // Migrate bill items
            if (bill.items && bill.items.length > 0) {
                for (const item of bill.items) {
                    await connection.query(
                        `INSERT INTO bill_items (id, bill_id, name, quantity, rate, amount, created_at)
                         VALUES (UUID(), ?, ?, ?, ?, ?, ?)`,
                        [bill.id, item.name, item.quantity || 1, item.rate || 0, 
                         (item.quantity || 1) * (item.rate || 0), bill.created_at]
                    );
                }
                console.log(`   ✅ Bill migrated: ${bill.number} (${bill.items.length} items)`);
            } else {
                console.log(`   ✅ Bill migrated: ${bill.number} (0 items)`);
            }
        }

        // Commit transaction
        await connection.commit();
        console.log('\n✅ Data migration completed successfully!');

        // Show statistics
        const [userCount] = await connection.query('SELECT COUNT(*) as count FROM users');
        const [shopCount] = await connection.query('SELECT COUNT(*) as count FROM shops');
        const [templateCount] = await connection.query('SELECT COUNT(*) as count FROM templates');
        const [billCount] = await connection.query('SELECT COUNT(*) as count FROM bills');
        const [itemCount] = await connection.query('SELECT COUNT(*) as count FROM bill_items');

        console.log('\n📊 Migration Statistics:');
        console.log(`   👤 Users: ${userCount[0].count}`);
        console.log(`   🏪 Shops: ${shopCount[0].count}`);
        console.log(`   📄 Templates: ${templateCount[0].count}`);
        console.log(`   🧾 Bills: ${billCount[0].count}`);
        console.log(`   📋 Bill Items: ${itemCount[0].count}`);

    } catch (error) {
        await connection.rollback();
        console.error('❌ Data migration failed:', error.message);
        if (error.sql) {
            console.error('SQL Error:', error.sql);
        }
        process.exit(1);
    } finally {
        await connection.end();
    }
};

// Run data migration
migrateData();