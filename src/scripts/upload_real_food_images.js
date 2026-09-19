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
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const BUCKET_NAME = 'menu-item-images';

export const REAL_FOOD_PHOTOS = [
  // 1-10: Beverages
  { slug: 'masala-chai', name: 'Masala Chai', photo: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574' },
  { slug: 'filter-coffee', name: 'Filter Coffee', photo: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd' },
  { slug: 'cold-coffee', name: 'Cold Coffee', photo: 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5' },
  { slug: 'cappuccino', name: 'Cappuccino', photo: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d' },
  { slug: 'espresso', name: 'Espresso', photo: 'https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04' },
  { slug: 'mango-lassi', name: 'Mango Lassi', photo: 'https://images.unsplash.com/photo-1546173159-315724a31696' },
  { slug: 'sweet-lassi', name: 'Sweet Lassi', photo: 'https://images.unsplash.com/photo-1553787499-6f9133860278' },
  { slug: 'fresh-lime-soda', name: 'Fresh Lime Soda', photo: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd' },
  { slug: 'green-tea', name: 'Green Tea', photo: 'https://images.unsplash.com/photo-1627435601361-ec25f5b1d0e5' },
  { slug: 'badam-milk', name: 'Badam Milk', photo: 'https://images.unsplash.com/photo-1550583724-b2692b85b150' },

  // 11-20: Fast Food & Snacks
  { slug: 'veg-burger', name: 'Veg Burger', photo: 'https://images.unsplash.com/photo-1550547660-d9450f859349' },
  { slug: 'cheese-burger', name: 'Cheese Burger', photo: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd' },
  { slug: 'margherita-pizza', name: 'Margherita Pizza', photo: 'https://images.unsplash.com/photo-1604382355076-af4b0eb60143' },
  { slug: 'veg-farmhouse-pizza', name: 'Veg Farmhouse Pizza', photo: 'https://images.unsplash.com/photo-1534308983496-4fabb1a015ee' },
  { slug: 'french-fries', name: 'French Fries', photo: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877' },
  { slug: 'peri-peri-fries', name: 'Peri Peri Fries', photo: 'https://images.unsplash.com/photo-1630384060421-cb20d0e0649d' },
  { slug: 'samosa', name: 'Samosa (2 pcs)', photo: 'https://images.unsplash.com/photo-1601050690597-df0568f70950' },
  { slug: 'vada-pav', name: 'Vada Pav', photo: 'https://images.unsplash.com/photo-1606491956689-2ea866880c84' },
  { slug: 'veg-grilled-sandwich', name: 'Veg Grilled Sandwich', photo: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af' },
  { slug: 'cheese-corn-sandwich', name: 'Cheese Corn Sandwich', photo: 'https://images.unsplash.com/photo-1619096252214-ef06c45683e3' },

  // 21-30: Breakfast & South Indian
  { slug: 'masala-dosa', name: 'Masala Dosa', photo: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc' },
  { slug: 'plain-dosa', name: 'Plain Dosa', photo: 'https://images.unsplash.com/photo-1668236543090-82eba5ee5976' },
  { slug: 'onion-rava-dosa', name: 'Onion Rava Dosa', photo: 'https://images.unsplash.com/photo-1610192244261-3f33de3f55e4' },
  { slug: 'idli-sambar', name: 'Idli Sambar (2 pcs)', photo: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc' },
  { slug: 'medu-vada', name: 'Medu Vada (2 pcs)', photo: 'https://images.unsplash.com/photo-1626132647523-66f5bf380027' },
  { slug: 'onion-uttapam', name: 'Onion Uttapam', photo: 'https://images.unsplash.com/photo-1601050690597-df0568f70950' },
  { slug: 'poha', name: 'Poha', photo: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641' },
  { slug: 'upma', name: 'Upma', photo: 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46' },
  { slug: 'chole-bhature', name: 'Chole Bhature (2 pcs)', photo: 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46' },
  { slug: 'aloo-paratha', name: 'Aloo Paratha with Curd', photo: 'https://images.unsplash.com/photo-1606471191009-63994c53433b' },

  // 31-40: Main Course
  { slug: 'paneer-butter-masala', name: 'Paneer Butter Masala', photo: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7' },
  { slug: 'shahi-paneer', name: 'Shahi Paneer', photo: 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8' },
  { slug: 'dal-makhani', name: 'Dal Makhani', photo: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d' },
  { slug: 'dal-tadka', name: 'Dal Tadka', photo: 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46' },
  { slug: 'veg-biryani', name: 'Veg Biryani', photo: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8' },
  { slug: 'jeera-rice', name: 'Jeera Rice', photo: 'https://images.unsplash.com/photo-1512058564366-18510be2db19' },
  { slug: 'butter-naan', name: 'Butter Naan', photo: 'https://images.unsplash.com/photo-1601050690597-df0568f70950' },
  { slug: 'garlic-naan', name: 'Garlic Naan', photo: 'https://images.unsplash.com/photo-1626074353765-517a681e40be' },
  { slug: 'veg-hakka-noodles', name: 'Veg Hakka Noodles', photo: 'https://images.unsplash.com/photo-1585032226651-759b368d7246' },
  { slug: 'veg-fried-rice', name: 'Veg Fried Rice', photo: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b' },

  // 41-50: Bakery & Desserts
  { slug: 'gulab-jamun', name: 'Gulab Jamun (2 pcs)', photo: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc' },
  { slug: 'rasgulla', name: 'Rasgulla (2 pcs)', photo: 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28' },
  { slug: 'chocolate-brownie', name: 'Chocolate Brownie', photo: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c' },
  { slug: 'sizzling-brownie', name: 'Sizzling Brownie with Ice Cream', photo: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87' },
  { slug: 'vanilla-ice-cream', name: 'Vanilla Ice Cream Scoop', photo: 'https://images.unsplash.com/photo-1570197788417-0e82375c9371' },
  { slug: 'chocolate-ice-cream', name: 'Chocolate Ice Cream Scoop', photo: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb' },
  { slug: 'matka-kulfi', name: 'Matka Kulfi', photo: 'https://images.unsplash.com/photo-1505394033641-40c6ad1178d7' },
  { slug: 'butter-croissant', name: 'Butter Croissant', photo: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a' },
  { slug: 'choco-lava-cake', name: 'Choco Lava Cake', photo: 'https://images.unsplash.com/photo-1624353365286-3f8d62daad51' },
  { slug: 'kaju-katli', name: 'Kaju Katli (100g)', photo: 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28' }
];

async function main() {
  console.log('🍽️ Starting upload of REAL FOOD images to Supabase Storage...');
  console.log(`Bucket: "${BUCKET_NAME}"`);

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const updatedItems = [];

  for (let i = 0; i < REAL_FOOD_PHOTOS.length; i++) {
    const item = REAL_FOOD_PHOTOS[i];
    const fileName = `items/${item.slug}.jpg`;
    const downloadUrl = `${item.photo}?auto=format&fit=crop&w=500&h=500&q=85`;

    try {
      // 1. Download real food photo
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 2. Upload to Supabase bucket
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(fileName, buffer, {
          contentType: 'image/jpeg',
          upsert: true
        });

      if (uploadErr) {
        throw uploadErr;
      }

      // 3. Get Public URL
      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(fileName);

      const publicUrl = urlData.publicUrl;
      console.log(`[${i + 1}/${REAL_FOOD_PHOTOS.length}] ✅ ${item.name} -> ${publicUrl}`);

      // 4. Update in PostgreSQL database
      await pool.query(`
        UPDATE menu_items
        SET image_url = $1, updated_at = NOW()
        WHERE id LIKE $2 OR name = $3
      `, [publicUrl, `%${item.slug}%`, item.name]);

      updatedItems.push({ name: item.name, publicUrl });
    } catch (err) {
      console.error(`[${i + 1}/${REAL_FOOD_PHOTOS.length}] ❌ Error for ${item.name}:`, err.message);
    }
  }

  console.log(`\n🎉 Successfully uploaded and linked ${updatedItems.length} real food images in Supabase!`);

  // Verify records in DB
  const verifyRes = await pool.query('SELECT name, image_url FROM menu_items LIMIT 5');
  console.log('Sample updated database rows:', verifyRes.rows);

  await pool.end();
}

main().catch(console.error);
