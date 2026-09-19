import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import pkg from 'pg';
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://apzabspkfpuszlduyoqv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwemFic3BrZnB1c3psZHV5b3F2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTAxNjM1MCwiZXhwIjoyMTA0NTkyMzUwfQ._-AbXC08XTwVVif9BDVkNq2RDF1rULb-a_nMgLrFBQI';
const DATABASE_URL = process.env.DATABASE_URL;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const BUCKET_NAME = 'menu-item-images';

// Generate vibrant, stylish SVG graphics for food & drink menu items
function generateItemSvg(name, category, emoji, bgGradientStart, bgGradientEnd) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgGradientStart}" />
        <stop offset="100%" stop-color="${bgGradientEnd}" />
      </linearGradient>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="6" stdDeviation="8" flood-opacity="0.15" />
      </filter>
    </defs>
    <rect width="240" height="240" rx="36" fill="url(#bg)" />
    <circle cx="120" cy="100" r="54" fill="#ffffff" fill-opacity="0.88" filter="url(#shadow)" />
    <text x="120" y="116" font-size="52" text-anchor="middle" font-family="'Segoe UI Emoji', 'Apple Color Emoji', sans-serif">${emoji}</text>
    <rect x="24" y="172" width="192" height="42" rx="12" fill="#0f172a" fill-opacity="0.85" />
    <text x="120" y="193" font-size="12" font-weight="bold" fill="#ffffff" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" letter-spacing="0.5">${category.toUpperCase()}</text>
    <text x="120" y="206" font-size="10" fill="#94a3b8" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">Freshly Prepared</text>
  </svg>`;
}

const DUMMY_ITEMS = [
  // 1-10: Beverages
  { name: "Masala Chai", price: 20.00, category: "Beverages", emoji: "☕", slug: "masala-chai", g1: "#fef3c7", g2: "#d97706", desc: "Aromatic Indian tea brewed with ginger, cardamom, and whole spices." },
  { name: "Filter Coffee", price: 30.00, category: "Beverages", emoji: "☕", slug: "filter-coffee", g1: "#ffedd5", g2: "#c2410c", desc: "Authentic South Indian chicory-blended frothy drip coffee." },
  { name: "Cold Coffee", price: 70.00, category: "Beverages", emoji: "🧋", slug: "cold-coffee", g1: "#e0e7ff", g2: "#4338ca", desc: "Chilled blended coffee with milk, chocolate drizzle, and vanilla cream." },
  { name: "Cappuccino", price: 90.00, category: "Beverages", emoji: "☕", slug: "cappuccino", g1: "#fef3c7", g2: "#b45309", desc: "Rich espresso shot topped with a thick layer of steamed milk foam." },
  { name: "Espresso", price: 60.00, category: "Beverages", emoji: "☕", slug: "espresso", g1: "#f1f5f9", g2: "#334155", desc: "Intense, robust single shot of freshly ground dark roast coffee." },
  { name: "Mango Lassi", price: 50.00, category: "Beverages", emoji: "🥭", slug: "mango-lassi", g1: "#fef08a", g2: "#eab308", desc: "Creamy traditional yogurt beverage blended with sweet Alphonso mangoes." },
  { name: "Sweet Lassi", price: 40.00, category: "Beverages", emoji: "🥛", slug: "sweet-lassi", g1: "#f8fafc", g2: "#94a3b8", desc: "Churned fresh yogurt smoothie garnished with cardamom and malai." },
  { name: "Fresh Lime Soda", price: 40.00, category: "Beverages", emoji: "🍋", slug: "fresh-lime-soda", g1: "#ecfccb", g2: "#65a30d", desc: "Refreshing bubbly soda seasoned with fresh lime juice, salt, and cumin." },
  { name: "Green Tea", price: 35.00, category: "Beverages", emoji: "🍵", slug: "green-tea", g1: "#dcfce7", g2: "#15803d", desc: "Organic loose leaf green tea rich in antioxidants and delicate aroma." },
  { name: "Badam Milk", price: 55.00, category: "Beverages", emoji: "🥛", slug: "badam-milk", g1: "#fae8ff", g2: "#a21caf", desc: "Warm creamy milk infused with saffron, crushed almonds, and cardamom." },

  // 11-20: Fast Food & Snacks
  { name: "Veg Burger", price: 80.00, category: "Fast Food", emoji: "🍔", slug: "veg-burger", g1: "#fef3c7", g2: "#d97706", desc: "Crispy herb potato patty served with lettuce, tomato, and tangy mayo." },
  { name: "Cheese Burger", price: 110.00, category: "Fast Food", emoji: "🍔", slug: "cheese-burger", g1: "#fef08a", g2: "#ca8a04", desc: "Golden veggie patty melted with sharp cheddar and garlic dressing." },
  { name: "Margherita Pizza", price: 180.00, category: "Fast Food", emoji: "🍕", slug: "margherita-pizza", g1: "#fee2e2", g2: "#dc2626", desc: "Classic stone-baked thin crust pizza topped with mozzarella and basil." },
  { name: "Veg Farmhouse Pizza", price: 240.00, category: "Fast Food", emoji: "🍕", slug: "veg-farmhouse-pizza", g1: "#dcfce7", g2: "#16a34a", desc: "Loaded with bell peppers, sweet corn, mushrooms, olives, and cheese." },
  { name: "French Fries", price: 70.00, category: "Fast Food", emoji: "🍟", slug: "french-fries", g1: "#fef9c3", g2: "#eab308", desc: "Deep-fried golden potato batons tossed in Himalayan rock salt." },
  { name: "Peri Peri Fries", price: 90.00, category: "Fast Food", emoji: "🍟", slug: "peri-peri-fries", g1: "#ffedd5", g2: "#ea580c", desc: "Crispy hot French fries generously seasoned with spicy African peri peri." },
  { name: "Samosa (2 pcs)", price: 30.00, category: "Snacks", emoji: "🥟", slug: "samosa", g1: "#fed7aa", g2: "#c2410c", desc: "Flaky pyramid pastries stuffed with spiced potatoes, green peas, and cashews." },
  { name: "Vada Pav", price: 25.00, category: "Snacks", emoji: "🥪", slug: "vada-pav", g1: "#fef08a", g2: "#ca8a04", desc: "Mumbai's iconic spiced potato fritter sandwiched with garlic chutney." },
  { name: "Veg Grilled Sandwich", price: 75.00, category: "Snacks", emoji: "🥪", slug: "veg-grilled-sandwich", g1: "#e0f2fe", g2: "#0284c7", desc: "Layered cucumber, tomato, potato, mint chutney, toasted until golden." },
  { name: "Cheese Corn Sandwich", price: 95.00, category: "Snacks", emoji: "🥪", slug: "cheese-corn-sandwich", g1: "#fef9c3", g2: "#d97706", desc: "Juicy golden sweet corn mixed with melted mozzarella and green chilies." },

  // 21-30: Breakfast & South Indian
  { name: "Masala Dosa", price: 70.00, category: "South Indian", emoji: "🥞", slug: "masala-dosa", g1: "#fed7aa", g2: "#d97706", desc: "Crispy fermented crepe filled with spiced onion-potato masala." },
  { name: "Plain Dosa", price: 50.00, category: "South Indian", emoji: "🥞", slug: "plain-dosa", g1: "#fef3c7", g2: "#b45309", desc: "Thin and golden golden crepe served with coconut chutney and hot sambar." },
  { name: "Onion Rava Dosa", price: 85.00, category: "South Indian", emoji: "🥞", slug: "onion-rava-dosa", g1: "#ffedd5", g2: "#ea580c", desc: "Semolina crepe sprinkled with chopped onions, coriander, and black pepper." },
  { name: "Idli Sambar (2 pcs)", price: 40.00, category: "South Indian", emoji: "⚪", slug: "idli-sambar", g1: "#f1f5f9", g2: "#64748b", desc: "Steamed fluffy rice-lentil cakes soaked in piping hot vegetable sambar." },
  { name: "Medu Vada (2 pcs)", price: 45.00, category: "South Indian", emoji: "🍩", slug: "medu-vada", g1: "#fef3c7", g2: "#b45309", desc: "Crispy deep-fried savory lentil doughnuts served with fresh chutneys." },
  { name: "Onion Uttapam", price: 65.00, category: "South Indian", emoji: "🥞", slug: "onion-uttapam", g1: "#fee2e2", g2: "#e11d48", desc: "Thick savory pancake topped with caramelized onions and green chilies." },
  { name: "Poha", price: 35.00, category: "Breakfast", emoji: "🥣", slug: "poha", g1: "#fef08a", g2: "#ca8a04", desc: "Flattened rice flakes tempered with mustard, turmeric, peanuts, and curry leaves." },
  { name: "Upma", price: 35.00, category: "Breakfast", emoji: "🥣", slug: "upma", g1: "#f1f5f9", g2: "#475569", desc: "Savory semolina porridge cooked with roasted cashews, ginger, and veggies." },
  { name: "Chole Bhature (2 pcs)", price: 110.00, category: "Breakfast", emoji: "🫓", slug: "chole-bhature", g1: "#fed7aa", g2: "#c2410c", desc: "Puffed deep-fried bread served with spicy dark Punjabi chickpea curry." },
  { name: "Aloo Paratha with Curd", price: 80.00, category: "Breakfast", emoji: "🫓", slug: "aloo-paratha", g1: "#fef3c7", g2: "#d97706", desc: "Whole wheat flatbread stuffed with spiced potatoes, served with butter & curd." },

  // 31-40: Main Course
  { name: "Paneer Butter Masala", price: 220.00, category: "Main Course", emoji: "🍲", slug: "paneer-butter-masala", g1: "#ffedd5", g2: "#ea580c", desc: "Cottage cheese cubes simmered in a luscious buttery tomato-cashew gravy." },
  { name: "Shahi Paneer", price: 240.00, category: "Main Course", emoji: "🍲", slug: "shahi-paneer", g1: "#fef08a", g2: "#d97706", desc: "Royal Mughlai dish of soft paneer cooked in an aromatic white gravy." },
  { name: "Dal Makhani", price: 180.00, category: "Main Course", emoji: "🍲", slug: "dal-makhani", g1: "#f1f5f9", g2: "#1e293b", desc: "Slow-cooked black lentils simmered overnight with cream, butter, and spices." },
  { name: "Dal Tadka", price: 140.00, category: "Main Course", emoji: "🍲", slug: "dal-tadka", g1: "#fef08a", g2: "#eab308", desc: "Yellow lentils tempered with ghee, cumin seeds, garlic, and dried red chilies." },
  { name: "Veg Biryani", price: 190.00, category: "Main Course", emoji: "🍚", slug: "veg-biryani", g1: "#fed7aa", g2: "#d97706", desc: "Fragrant basmati rice layered with garden veggies, saffron, and mint raita." },
  { name: "Jeera Rice", price: 110.00, category: "Main Course", emoji: "🍚", slug: "jeera-rice", g1: "#f8fafc", g2: "#94a3b8", desc: "Steamed long-grain basmati rice delicately flavored with roasted cumin." },
  { name: "Butter Naan", price: 35.00, category: "Main Course", emoji: "🫓", slug: "butter-naan", g1: "#fef3c7", g2: "#b45309", desc: "Tandoor-baked leavened flatbread brushed with rich melted dairy butter." },
  { name: "Garlic Naan", price: 45.00, category: "Main Course", emoji: "🫓", slug: "garlic-naan", g1: "#ffedd5", g2: "#c2410c", desc: "Clay-oven flatbread infused with roasted garlic flakes and fresh coriander." },
  { name: "Veg Hakka Noodles", price: 130.00, category: "Main Course", emoji: "🍜", slug: "veg-hakka-noodles", g1: "#ecfccb", g2: "#4d7c0f", desc: "Wok-tossed noodles with shredded cabbage, carrots, peppers, and soy sauce." },
  { name: "Veg Fried Rice", price: 130.00, category: "Main Course", emoji: "🍚", slug: "veg-fried-rice", g1: "#fef9c3", g2: "#ca8a04", desc: "Stir-fried basmati rice cooked with crunchy spring vegetables in oriental spices." },

  // 41-50: Bakery & Desserts
  { name: "Gulab Jamun (2 pcs)", price: 40.00, category: "Desserts", emoji: "🟤", slug: "gulab-jamun", g1: "#fed7aa", g2: "#9a3412", desc: "Golden fried milk dough balls soaked in warm rose-cardamom sugar syrup." },
  { name: "Rasgulla (2 pcs)", price: 40.00, category: "Desserts", emoji: "⚪", slug: "rasgulla", g1: "#f8fafc", g2: "#cbd5e1", desc: "Spongy cottage cheese dumplings steeped in light aromatic sugar syrup." },
  { name: "Chocolate Brownie", price: 85.00, category: "Desserts", emoji: "🍫", slug: "chocolate-brownie", g1: "#f1f5f9", g2: "#451a03", desc: "Fudgy Belgian dark chocolate brownie topped with chocolate ganache." },
  { name: "Sizzling Brownie with Ice Cream", price: 140.00, category: "Desserts", emoji: "🍨", slug: "sizzling-brownie", g1: "#fee2e2", g2: "#7f1d1d", desc: "Hot sizzling cast iron brownie topped with vanilla ice cream and hot fudge." },
  { name: "Vanilla Ice Cream Scoop", price: 40.00, category: "Desserts", emoji: "🍨", slug: "vanilla-ice-cream", g1: "#fef9c3", g2: "#ca8a04", desc: "Classic rich and velvety Madagascar vanilla bean dairy ice cream." },
  { name: "Chocolate Ice Cream Scoop", price: 50.00, category: "Desserts", emoji: "🍨", slug: "chocolate-ice-cream", g1: "#fef2f2", g2: "#451a03", desc: "Indulgent Dutch cocoa ice cream swirled with crunchy chocolate chips." },
  { name: "Matka Kulfi", price: 60.00, category: "Desserts", emoji: "🏺", slug: "matka-kulfi", g1: "#fef3c7", g2: "#b45309", desc: "Traditional frozen dairy dessert served in a mini clay pot with pistachios." },
  { name: "Butter Croissant", price: 70.00, category: "Bakery", emoji: "🥐", slug: "butter-croissant", g1: "#fed7aa", g2: "#c2410c", desc: "Flaky, buttery French pastry baked golden with layered puff pastry." },
  { name: "Choco Lava Cake", price: 95.00, category: "Bakery", emoji: "🧁", slug: "choco-lava-cake", g1: "#f1f5f9", g2: "#451a03", desc: "Warm chocolate cake with a molten liquid chocolate center." },
  { name: "Kaju Katli (100g)", price: 120.00, category: "Desserts", emoji: "💎", slug: "kaju-katli", g1: "#f8fafc", g2: "#94a3b8", desc: "Diamond-shaped rich cashew fudge finished with pure silver leaf." }
];

async function run() {
  console.log('🚀 Starting Supabase Bucket and Menu Items Setup...');

  // 1. Ensure Bucket Exists
  console.log(`📦 Checking/Creating Supabase Storage Bucket: "${BUCKET_NAME}"...`);
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    console.warn('⚠️ Bucket list check error:', listErr.message);
  }

  const existingBucket = buckets?.find(b => b.name === BUCKET_NAME);
  if (!existingBucket) {
    const { data: newBucket, error: createErr } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: true,
      fileSizeLimit: 5242880, // 5MB
      allowedMimeTypes: ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp']
    });

    if (createErr) {
      console.error('❌ Failed to create storage bucket:', createErr);
    } else {
      console.log(`✅ Successfully created public bucket "${BUCKET_NAME}"!`);
    }
  } else {
    console.log(`ℹ️ Bucket "${BUCKET_NAME}" already exists. Ensuring it is public...`);
    await supabase.storage.updateBucket(BUCKET_NAME, { public: true }).catch(() => {});
  }

  // 2. Upload Menu Item Images to the Bucket
  console.log('🖼️ Uploading 50 menu item image assets to Supabase Storage...');
  const uploadedUrls = {};

  for (const item of DUMMY_ITEMS) {
    const fileName = `items/${item.slug}.svg`;
    const svgContent = generateItemSvg(item.name, item.category, item.emoji, item.g1, item.g2);
    const buffer = Buffer.from(svgContent, 'utf-8');

    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, buffer, {
        contentType: 'image/svg+xml',
        upsert: true
      });

    if (uploadErr) {
      console.warn(`⚠️ Warning uploading ${fileName}:`, uploadErr.message);
    }

    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    uploadedUrls[item.slug] = urlData.publicUrl;
  }
  console.log(`✅ Uploaded all 50 item images to "${BUCKET_NAME}" bucket!`);
  console.log('Sample Image URL:', uploadedUrls['masala-chai']);

  // 3. Connect to Database & Create Table
  console.log('🐘 Connecting to Supabase PostgreSQL Database...');
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Create menu_items table if not exists
    console.log('📄 Creating "menu_items" table with category and image_url...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        name TEXT NOT NULL,
        price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        category TEXT DEFAULT 'General',
        image_url TEXT,
        description TEXT,
        is_available BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General';
      ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url TEXT;
      ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT TRUE;

      CREATE INDEX IF NOT EXISTS idx_menu_items_user_id ON menu_items(user_id);
      CREATE INDEX IF NOT EXISTS idx_menu_items_name ON menu_items(name);
      CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category);
    `);
    console.log('✅ Table "menu_items" created and verified!');

    // 4. Find Active Users to seed
    const usersResult = await pool.query('SELECT id, email, name FROM users;');
    const users = usersResult.rows;
    console.log(`👥 Found ${users.length} user accounts in the database.`);

    // Target primary user (Kuldip: kuldip123@gmail.com, or all users)
    const kuldipUser = users.find(u => u.email === 'kuldip123@gmail.com');
    const targetUserId = kuldipUser ? kuldipUser.id : (users[0]?.id || null);

    console.log(`🎯 Seeding 50 dummy items for user: ${kuldipUser ? `${kuldipUser.name} (${kuldipUser.email})` : 'global fallback'}`);

    // Insert or update 50 dummy items
    let insertedCount = 0;
    for (let i = 0; i < DUMMY_ITEMS.length; i++) {
      const item = DUMMY_ITEMS[i];
      const itemId = `menu_dummy_${i + 1}_${item.slug}`;
      const imageUrl = uploadedUrls[item.slug];

      // Insert for target user so it appears directly in their account
      await pool.query(`
        INSERT INTO menu_items (id, user_id, name, price, category, image_url, description, is_available, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          price = EXCLUDED.price,
          category = EXCLUDED.category,
          image_url = EXCLUDED.image_url,
          description = EXCLUDED.description,
          updated_at = NOW();
      `, [itemId, targetUserId, item.name, item.price, item.category, imageUrl, item.desc, true]);

      insertedCount++;
    }

    console.log(`🎉 Successfully seeded ${insertedCount} dummy items into "menu_items" table!`);

    // Verify final count
    const countRes = await pool.query('SELECT count(*) FROM menu_items;');
    console.log(`📊 Total rows currently in "menu_items": ${countRes.rows[0].count}`);

  } catch (err) {
    console.error('❌ Database error during seeding:', err);
  } finally {
    await pool.end();
    console.log('✨ All tasks completed successfully!');
  }
}

run().catch(console.error);
