import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://apzabspkfpuszlduyoqv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwemFic3BrZnB1c3psZHV5b3F2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTAxNjM1MCwiZXhwIjoyMTA0NTkyMzUwfQ._-AbXC08XTwVVif9BDVkNq2RDF1rULb-a_nMgLrFBQI';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const BUCKET_NAME = 'UI_Images';
const PUBLIC_DIR = path.resolve(__dirname, '../../../Slipzo/public');

const filesToUpload = [
  'contact_cta_printer.jpg',
  'contact_support_agent.jpg',
  'pricing_hero_printer.jpg',
  'templates_hero_illustration.jpg',
  'templates_hero_bg.jpg'
];

async function uploadUiImages() {
  console.log(`🚀 Checking Supabase Storage Bucket: "${BUCKET_NAME}"...`);

  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    console.error('❌ Error listing buckets:', listErr.message);
  } else {
    console.log('Available buckets:', buckets.map(b => b.name));
  }

  const existingBucket = buckets?.find(b => b.name === BUCKET_NAME);
  if (!existingBucket) {
    console.log(`Creating bucket "${BUCKET_NAME}"...`);
    const { data: newBucket, error: createErr } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: true,
      fileSizeLimit: 10485760, // 10MB
    });
    if (createErr) {
      console.error('❌ Error creating bucket:', createErr.message);
    } else {
      console.log(`✅ Bucket "${BUCKET_NAME}" created successfully!`);
    }
  } else {
    console.log(`✅ Bucket "${BUCKET_NAME}" exists.`);
    // Make sure it's public
    await supabase.storage.updateBucket(BUCKET_NAME, { public: true }).catch(() => {});
  }

  const urls = {};

  for (const fileName of filesToUpload) {
    const filePath = path.join(PUBLIC_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ File not found: ${filePath}`);
      continue;
    }

    const fileBuffer = fs.readFileSync(filePath);
    console.log(`📤 Uploading ${fileName} (${(fileBuffer.length / 1024).toFixed(1)} KB)...`);

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, fileBuffer, {
        contentType: 'image/jpeg',
        upsert: true
      });

    if (error) {
      console.error(`❌ Failed to upload ${fileName}:`, error.message);
    } else {
      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(fileName);
      urls[fileName] = urlData.publicUrl;
      console.log(`✅ Uploaded: ${fileName} -> ${urlData.publicUrl}`);
    }
  }

  console.log('\n--- UPLOADED IMAGE URLS ---');
  console.log(JSON.stringify(urls, null, 2));
}

uploadUiImages();
