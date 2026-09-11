import { initDatabase, query, queryOne } from '../src/config/database.js';
import Product from '../src/models/Product.js';
import { v4 as uuidv4 } from 'uuid';

async function testProductDatabase() {
    console.log("🧪 Testing Product DB Storage and Retrieval...");
    
    await initDatabase();

    // 1. Get or create a valid user
    let user = await queryOne(`SELECT * FROM users LIMIT 1`);
    let testUserIdCreated = false;

    if (!user) {
        const testUserId = uuidv4();
        await query(
            `INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)`,
            [testUserId, 'Test User', 'testuser_product_db@example.com', 'password123']
        );
        user = { id: testUserId, email: 'testuser_product_db@example.com' };
        testUserIdCreated = true;
        console.log(`👤 Created temporary test user: ${user.id}`);
    } else {
        console.log(`👤 Using existing user: ${user.id} (${user.email})`);
    }

    try {
        // 2. Test Fetching existing products
        let products = await Product.findByUserId(user.id);
        console.log(`📦 Initial fetched products count: ${products.length}`);

        // 3. Test Storing a new product in DB
        const newProductData = {
            user_id: user.id,
            name: "Test Thermal Printer DB Item",
            price: 1999,
            category: "Hardware",
            sku: `SKU-TEST-${Date.now()}`,
            tax_rate: 18,
            stock: 50,
            image: "/products/test_item.jpg",
            description: "Direct DB storage test item"
        };

        const createdProduct = await Product.create(newProductData);
        console.log("✅ Successfully stored product in DB:", createdProduct);

        if (!createdProduct || !createdProduct.id) {
            throw new Error("Created product did not return a valid DB record with ID");
        }

        // 4. Test Retrieving the stored product from DB
        const retrievedProduct = await Product.findByIdAndUser(createdProduct.id, user.id);
        console.log("✅ Successfully retrieved stored product from DB:", retrievedProduct);

        if (retrievedProduct.name !== newProductData.name) {
            throw new Error("Retrieved product name mismatch");
        }

        // 5. Test Updating product in DB
        const updatedProduct = await Product.update(createdProduct.id, user.id, {
            price: 2499,
            stock: 45
        });
        console.log("✅ Successfully updated product in DB:", updatedProduct);

        // 6. Test Deleting product from DB
        const deleteSuccess = await Product.delete(createdProduct.id, user.id);
        console.log(`✅ Product deletion from DB success: ${deleteSuccess}`);

        console.log("🎉 ALL PRODUCT DB TESTS PASSED SUCCESSFULLY!");
    } finally {
        if (testUserIdCreated && user) {
            await query(`DELETE FROM users WHERE id = ?`, [user.id]);
            console.log(`🧹 Cleaned up temporary test user.`);
        }
    }
}

testProductDatabase().catch(err => {
    console.error("❌ Product DB test failed:", err);
    process.exit(1);
});
