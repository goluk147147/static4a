-- ============================================================
-- 4AStore v2 — seed data (migrated from the existing JSON store)
-- Run AFTER schema.sql.
-- NOTE: replace the owner password hash before production (see api-node/README).
-- ============================================================

SET NAMES utf8mb4;

-- ---------- owner admin ----------
-- Default password below is a bcrypt hash of "admin1234" (CHANGE IT for production).
-- Generate a new one: node -e "console.log(require('bcryptjs').hashSync('yourpass',10))"
INSERT INTO users (name, mobile, username, password, role, permissions, registered_at)
VALUES ('Store Owner', '7543888698', 'owner',
        '$2a$10$ceTrEST8v29JIwpp5ZRs8eiulQaeXYrCKaJW5ZPf39K7IXMMWisH2',
        'owner', JSON_ARRAY('*'), NOW())
ON DUPLICATE KEY UPDATE username = username;

-- ---------- categories ----------
INSERT INTO categories (id, name, slug, icon, image, hidden, age_restricted, warning, sort_order) VALUES
(1,  'Fruits & Vegetables',       'fruits-vegetables',       '🥬', 'https://static.vecteezy.com/system/resources/thumbnails/033/210/784/small_2x/various-mixed-healthy-fruits-background-ai-generative-pro-photo.jpg', 0, 0, NULL, 1),
(2,  'Rice, Atta & Dal',          'rice-atta-dal',           '🌾', 'https://cdn-icons-png.flaticon.com/512/3174/3174880.png', 0, 0, NULL, 2),
(3,  'Oil & Ghee',                'oil-ghee',                '🫒', 'https://cdn-icons-png.flaticon.com/512/5787/5787016.png', 0, 0, NULL, 3),
(4,  'Biscuits & Snacks',         'biscuits-snacks',         '🍪', 'https://cdn-icons-png.flaticon.com/512/2454/2454253.png', 0, 0, NULL, 4),
(5,  'Tea & Coffee',              'tea-coffee',              '☕', 'https://cdn-icons-png.flaticon.com/512/924/924514.png', 0, 0, NULL, 5),
(6,  'Cold Drinks & Beverages',   'cold-drinks-beverages',   '🥤', 'https://cdn-icons-png.flaticon.com/512/3050/3050153.png', 0, 0, NULL, 6),
(7,  'Dairy & Bakery',            'dairy-bakery',            '🥛', 'https://cdn-icons-png.flaticon.com/512/3500/3500170.png', 0, 0, NULL, 7),
(8,  'Personal Care',             'personal-care',           '🧴', 'https://cdn-icons-png.flaticon.com/512/2553/2553691.png', 0, 0, NULL, 8),
(9,  'Home Cleaning',             'home-cleaning',           '🧹', 'https://cdn-icons-png.flaticon.com/512/995/995016.png', 0, 0, NULL, 9),
(10, 'Baby Care',                 'baby-care',               '👶', 'https://cdn-icons-png.flaticon.com/512/3373/3373060.png', 0, 0, NULL, 10),
(11, 'Stationery',                'stationery',              '📝', 'https://cdn-icons-png.flaticon.com/512/2541/2541988.png', 0, 0, NULL, 11),
(12, 'Daily Essentials',          'daily-essentials',        '🛒', 'https://cdn-icons-png.flaticon.com/512/3724/3724788.png', 0, 0, NULL, 12),
(13, 'Mouth Freshener',           'mouth-freshener',         '🍃', 'https://cdn-icons-png.flaticon.com/512/2553/2553651.png', 1, 1, 'Tobacco causes cancer. Sirf 18+ ke liye.', 13),
(14, 'Dry Fruits',                'dry-fruits',              '🥜', 'https://cdn-icons-png.flaticon.com/512/2224/2224152.png', 0, 0, NULL, 14)
ON DUPLICATE KEY UPDATE name = VALUES(name), icon = VALUES(icon), image = VALUES(image), warning = VALUES(warning);

-- ---------- sample products (subset from existing data) ----------
INSERT INTO products (id, name, brand, category, weight, mrp, price, discount, image, description, features, in_stock) VALUES
(1,  'Aashirvaad Atta', 'Aashirvaad', 'rice-atta-dal', '5 Kg', 280, 200, 29, 'https://www.bbassets.com/media/uploads/p/m/40053356_9-ganesh-whole-wheat-chakki-atta.jpg?tr=w-154,q-80', 'Aashirvaad Superior MP Whole Wheat Atta. Soft rotis every time.', JSON_ARRAY(), 1),
(3,  'Fortune Mustard Oil', 'Fortune', 'oil-ghee', '1 Litre', 180, 165, 8, 'https://www.bbassets.com/media/uploads/p/m/276756_16-fortune-fortune-premium-kachi-ghani-pure-mustard-oil.jpg?tr=w-154,q-80', 'Fortune Kachi Ghani Pure Mustard Oil. Rich aroma and authentic taste.', JSON_ARRAY(), 1),
(4,  'Soya Health Refined Soyabean Oil', 'Fortune', 'oil-ghee', '1 Litre', 160, 145, 9, 'https://www.bbassets.com/media/uploads/p/m/40361379_2-fortune-sunlite-refined-sunflower-oil.jpg?tr=w-154,q-80', 'Soya Health Refined Soyabean Oil. Light and healthy cooking oil.', JSON_ARRAY(), 1),
(5,  'Tata Salt', 'Tata', 'daily-essentials', '1 Kg', 30, 28, 7, 'https://www.bbassets.com/media/uploads/p/l/241600_11-tata-salt-iodized.jpg', 'Tata Salt - Desh ka namak. Iodized and vacuum evaporated salt.', JSON_ARRAY(), 1),
(6,  'Tata Tea Gold', 'Tata', 'tea-coffee', '500 g', 295, 270, 8, 'https://www.bbassets.com/media/uploads/p/m/40200082_7-tata-tea-gold-tea.jpg?tr=w-154,q-80', 'Tata Tea Gold - 15% Long Leaves for rich, aromatic taste.', JSON_ARRAY(), 1),
(7,  'Maggi 2-Minute Noodles', 'Nestle', 'biscuits-snacks', 'Pack of 12', 168, 150, 11, 'https://www.bbassets.com/media/uploads/p/m/266112_30-maggi-2-minute-instant-noodles-masala.jpg?tr=w-154,q-80', 'Maggi 2-Minute Instant Noodles - Masala flavour.', JSON_ARRAY(), 0),
(8,  'Surf Excel Easy Wash', 'Surf Excel', 'home-cleaning', '1.5 Kg', 199, 175, 12, 'https://www.bbassets.com/media/uploads/p/l/215595_27-surf-excel-easy-wash-detergent-powder.jpg', 'Surf Excel Easy Wash Detergent Powder for tough stain removal.', JSON_ARRAY(), 1),
(9,  'Vim Dishwash Bar', 'Vim', 'home-cleaning', '600 g', 52, 45, 13, 'https://www.bbassets.com/media/uploads/p/m/100006809_16-vim-dishwash-bar-lemon.jpg?tr=w-154,q-80', 'Vim Dishwash Bar with power of lemon for sparkling clean dishes.', JSON_ARRAY(), 1),
(10, 'Dettol Original Soap', 'Dettol', 'personal-care', '125 g', 55, 48, 13, 'https://www.bbassets.com/media/uploads/p/l/40325774_6-dettol-skincare-soap.jpg', 'Dettol Original Bathing Soap. Trusted protection from germs.', JSON_ARRAY(), 1),
(11, 'Banana (Dozen)', 'Fresh', 'fruits-vegetables', '1 Dozen', 60, 50, 17, 'https://www.bbassets.com/media/uploads/p/m/10000025_32-fresho-banana-robusta.jpg?tr=w-154,q-80', 'Fresh ripe bananas. Rich in potassium and natural energy.', JSON_ARRAY(), 0),
(12, 'Apple (Shimla)', 'Fresh', 'fruits-vegetables', '1 Kg', 180, 160, 11, 'https://www.bbassets.com/media/uploads/p/m/10000005_29-fresho-apple-royal-gala-economy.jpg?tr=w-154,q-80', 'Fresh Shimla apples. Crunchy, sweet and nutritious.', JSON_ARRAY(), 0)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ---------- settings ----------
INSERT INTO settings (id, store_email, delivery_charge, free_delivery_above, upi_id, upi_name, hide_mrp, store_phone, store_address, store_latitude, store_longitude, serviceable_villages)
VALUES (1, 'online4astore@gmail.com', 10, 500, 'Q623952089@ybl', '4A Store', 0, '7543888698',
        'Gajna Road, Chandargarh, Nabinagar, Aurangabad, Bihar - 824301', 24.580164, 84.114194,
        'Chandragarh (चंद्रगढ़), Misra Bigha (मिश्र बिगहा), Singhpur (सिंहपुर), Mahdua (महदुआ), Mahsu (महसू), Ratanwan (रतनवां), Patna (पटना), Bardiha (बरदिहा), Maigara (मैगरा), Kharaundha (खरौंधा), Mansara (मनसारा), Mauapur (मौआपूर), Shiwa Sagar (शिवसागर), Belaspur (बेलासपुर), Lakhanpur (लखनपुर), Kajhpa (कझपा), Darmi Khurd (डर्मी खुर्द), Shankarpur (शंकरपुर)')
ON DUPLICATE KEY UPDATE store_email = VALUES(store_email);

-- ---------- config (banners / ads / social proof) ----------
INSERT INTO config (id, banners, festival_ads, festival_categories, ads, social_proof_messages, social_proof_names, current_festival)
VALUES (1,
  JSON_ARRAY(
    JSON_OBJECT('title','घर बैठे मंगाइए ताज़ा किराना सामान!','subtitle','','btnText','Shop Now →','btnLink','products.html','gradient',JSON_ARRAY('#ff6600','#ff9800'),'festival','','active',true),
    JSON_OBJECT('title','🍎 ताज़े फल और सब्ज़ियाँ','subtitle','हर दिन ताज़गी, स्वाद और सेहत का भरोसा।','btnText','Explore →','btnLink','products.html?category=fruits-vegetables','gradient',JSON_ARRAY('#e55b00','#ffb74d'),'festival','','active',true)
  ),
  JSON_OBJECT(),
  JSON_OBJECT(),
  JSON_ARRAY(
    JSON_OBJECT('id',1,'title','🎉 Flat 10% OFF on First Order!','description','Limited time offer for new customers!','bgColor','#fff3e0','borderColor','#ff6600','icon','🎁','link','products.html','active',true),
    JSON_OBJECT('id',4,'title','🚚 Free Delivery above ₹{{freeDeliveryAbove}}','description','Order ₹{{freeDeliveryAbove}}+ for FREE home delivery','bgColor','#e8f5e9','borderColor','#2e7d32','icon','🆓','link','products.html','active',true)
  ),
  JSON_ARRAY('{name} from Chandargarh just ordered {product}','{name} purchased {product} just now!','🔥 {name} added {product} to cart','{name} just placed an order worth ₹{amount}','New order from {name} – {product}'),
  JSON_ARRAY('Rahul','Priya','Amit','Sunita','Ravi','Pooja','Vijay','Anita','Suresh','Meena','Deepak','Kavita','Rajesh','Neha','Manoj'),
  '')
ON DUPLICATE KEY UPDATE current_festival = VALUES(current_festival);

-- ---------- announcement ----------
INSERT INTO announcements (row_id, id, text, image, target, cta_text, cta_link, enabled)
VALUES (1, 11,
  'आज का खास ऑफर — 4A STORE हरी सब्जियों पर सीधे 20% की छूट! ताज़गी भी, बचत भी — 4A Store के साथ!',
  'https://www.bbassets.com/media/uploads/p/l/215595_27-surf-excel-easy-wash-detergent-powder.jpg',
  'all', 'Buy now', '/p/8', 1)
ON DUPLICATE KEY UPDATE text = VALUES(text);

-- ---------- app version ----------
INSERT INTO app_version (id, version_code, version_name, url, message, force_update, asset_version)
VALUES (1, 17, '1.7.9', 'https://4astore.example.com/4AStore.apk', 'New update available.', 0, 13)
ON DUPLICATE KEY UPDATE version_code = VALUES(version_code);
