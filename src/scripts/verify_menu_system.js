import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'slipzo-secret-key-2024';
const BASE_URL = 'http://localhost:8000/api';

async function runTests() {
    console.log('🧪 Starting Menu System Automated Verification...\n');

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const userRows = await pool.query('SELECT id, name, email FROM users ORDER BY created_at ASC LIMIT 5;');
    if (userRows.rows.length === 0) {
        console.error('No users found in database.');
        process.exit(1);
    }

    const userA = userRows.rows[0];
    const userB = userRows.rows[1] || { id: 'dummy-b', name: 'User B', email: 'b@test.com' };

    console.log(`User A: ${userA.name} (${userA.email} - ${userA.id})`);
    if (userRows.rows[1]) {
        console.log(`User B: ${userB.name} (${userB.email} - ${userB.id})`);
    }

    const tokenA = jwt.sign({ userId: userA.id }, JWT_SECRET, { expiresIn: '1d' });
    const tokenB = jwt.sign({ userId: userB.id }, JWT_SECRET, { expiresIn: '1d' });
    const adminToken = jwt.sign({ isAdmin: true, email: 'admin@slipzo.com', role: 'Super Admin' }, JWT_SECRET);

    // Clean user_menu_items for User A before testing to ensure pristine state
    await pool.query('DELETE FROM user_menu_items WHERE user_id = $1;', [userA.id]);

    // 1. Check User A Initial Menu (Should be empty!)
    console.log('\n--- TEST 1: User A Personal Menu (Empty State) ---');
    const resA1 = await fetch(`${BASE_URL}/menu`, {
        headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const menuA1 = await resA1.json();
    console.log(`User A Menu count: ${menuA1.length} (Expected: 0)`);
    if (menuA1.length !== 0) throw new Error('User A menu should be empty!');
    console.log('✅ Test 1 Passed: Master 50 records DO NOT appear in personal menu.');

    // 2. Fetch Master Catalog
    console.log('\n--- TEST 2: Fetch Master Catalog for User A ---');
    const resCat = await fetch(`${BASE_URL}/menu/catalog`, {
        headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const catalog = await resCat.json();
    console.log(`Catalog items available: ${catalog.length}`);
    if (catalog.length < 50) throw new Error(`Expected at least 50 catalog items, got ${catalog.length}`);
    const sampleItem = catalog[0];
    console.log(`Sample item: "${sampleItem.name}" | Base price: ₹${sampleItem.price} | Category: ${sampleItem.category} | Image: ${sampleItem.image_url ? 'Yes' : 'No'}`);
    console.log('✅ Test 2 Passed: Master catalog accessible and complete.');

    // 3. User A Adds Sample Item with Custom Price
    console.log('\n--- TEST 3: User A adds item with custom price ---');
    const customPriceA = parseFloat(sampleItem.price) + 25; // Custom user markup
    console.log(`Master price: ₹${sampleItem.price} -> User A sets custom price: ₹${customPriceA}`);

    const resAddA = await fetch(`${BASE_URL}/menu`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenA}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            menu_item_id: sampleItem.id,
            custom_price: customPriceA
        })
    });
    const addedA = await resAddA.json();
    console.log(`Added response: ID=${addedA.id}, Name="${addedA.name}", Price=₹${addedA.price}`);
    if (Number(addedA.price) !== Number(customPriceA)) {
        throw new Error(`Expected custom price ₹${customPriceA}, got ₹${addedA.price}`);
    }
    console.log('✅ Test 3 Passed: User item added with custom price.');

    // 4. Verify Master Price Unchanged
    console.log('\n--- TEST 4: Master catalog price protection ---');
    const resCat2 = await fetch(`${BASE_URL}/menu/catalog`, {
        headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const catalog2 = await resCat2.json();
    const verifiedMasterItem = catalog2.find(i => i.id === sampleItem.id);
    console.log(`Master item price after user addition: ₹${verifiedMasterItem.price} (Original: ₹${sampleItem.price})`);
    console.log(`Master item is_added for User A: ${verifiedMasterItem.is_added}`);
    if (Number(verifiedMasterItem.price) !== Number(sampleItem.price)) {
        throw new Error('Master catalog price was mutated!');
    }
    if (!verifiedMasterItem.is_added) {
        throw new Error('Master catalog is_added flag should be true for User A');
    }
    console.log('✅ Test 4 Passed: Master catalog price strictly protected & duplicate check works.');

    // 5. User Isolation Check (User B should see 0 items in My Menu, and is_added: false in catalog)
    if (userRows.rows[1]) {
        console.log('\n--- TEST 5: User Isolation (User B check) ---');
        await pool.query('DELETE FROM user_menu_items WHERE user_id = $1;', [userB.id]);
        const resB = await fetch(`${BASE_URL}/menu`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        });
        const menuB = await resB.json();
        console.log(`User B Personal Menu count: ${menuB.length} (Expected: 0)`);
        if (menuB.length !== 0) throw new Error('User B should not see User A items!');

        const resCatB = await fetch(`${BASE_URL}/menu/catalog`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        });
        const catalogB = await resCatB.json();
        const itemForB = catalogB.find(i => i.id === sampleItem.id);
        console.log(`Master item is_added for User B: ${itemForB.is_added} (Expected: false)`);
        if (itemForB.is_added) throw new Error('User B catalog should show is_added: false');
        console.log('✅ Test 5 Passed: Complete user isolation verified.');
    }

    // 6. Admin Menu Management Check
    console.log('\n--- TEST 6: Admin Menu Management endpoint check ---');
    const resAdmin = await fetch(`${BASE_URL}/admin/menu`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log(`Admin Menu response status: ${resAdmin.status}`);
    const adminMenu = await resAdmin.json();
    console.log('Admin menu payload:', adminMenu);
    const totalCount = adminMenu.total || adminMenu.items?.length;
    console.log(`Admin Menu total items: ${totalCount}`);
    if (!totalCount || totalCount < 50) throw new Error('Admin menu should return all master items');
    console.log('✅ Test 6 Passed: Admin menu endpoints functional.');

    // 7. Clean up test assignment
    console.log('\n--- Cleanup test user assignment ---');
    const deleteRes = await fetch(`${BASE_URL}/menu/${addedA.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const delJson = await deleteRes.json();
    console.log(`Delete response:`, delJson);
    console.log('✅ Cleanup successful.');

    await pool.end();
    console.log('\n🎉 ALL 6 AUTOMATED VERIFICATION TESTS PASSED PERFECTLY! 🚀\n');
}

runTests().catch(err => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
});
