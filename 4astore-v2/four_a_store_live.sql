-- MariaDB dump 10.19  Distrib 10.4.32-MariaDB, for Win64 (AMD64)
--
-- Host: localhost    Database: four_a_store
-- ------------------------------------------------------
-- Server version	10.4.32-MariaDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `four_a_store`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `four_a_store` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */;

USE `four_a_store`;

--
-- Table structure for table `ad_creatives`
--

DROP TABLE IF EXISTS `ad_creatives`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ad_creatives` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`data`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ad_creatives`
--

LOCK TABLES `ad_creatives` WRITE;
/*!40000 ALTER TABLE `ad_creatives` DISABLE KEYS */;
INSERT INTO `ad_creatives` VALUES (2,'{\"name\":\"New Ad (Copy)\",\"campaign\":\"\",\"offerTitle\":\"चंद्रगढ़ वालों, ध्यान दीजिए! ❤️\",\"productId\":\"3\",\"productName\":\"Fortune Mustard Oil\",\"format\":\"4:5\",\"platform\":\"all\",\"status\":\"draft\",\"template\":\"flash-sale\",\"creative\":{\"id\":null,\"name\":\"New Ad\",\"campaign\":\"\",\"offerTitle\":\"चंद्रगढ़ वालों, ध्यान दीजिए! ❤️\",\"productId\":\"3\",\"productName\":\"Fortune Mustard Oil\",\"price\":165,\"mrp\":180,\"discount\":8,\"format\":\"4:5\",\"platform\":\"all\",\"template\":\"flash-sale\",\"cta\":\"Shop Now\",\"localMode\":true,\"lang\":\"hinglish\",\"img\":{\"zoom\":1,\"x\":0,\"y\":0,\"rot\":0,\"flipH\":false,\"flipV\":false,\"src\":\"https://www.bbassets.com/media/uploads/p/m/276756_16-fortune-fortune-premium-kachi-ghani-pure-mustard-oil.jpg?tr=w-154,q-80\"},\"lines\":[{\"text\":\"\"}],\"caption\":\"चंद्रगढ़ walo dhyaan do! 😄\\n4A STORE par Fortune Mustard Oil par 8% छूट!\\nGhar baithe order karo, free home delivery. 🛵\\n📞 7543888698\",\"hashtags\":\"#4AStore #चंद्रगढ़ #Nabinagar #Aurangabad #GroceryStore #HomeDelivery #KiranaStore #Offer\",\"status\":\"draft\"},\"caption\":\"चंद्रगढ़ walo dhyaan do! 😄\\n4A STORE par Fortune Mustard Oil par 8% छूट!\\nGhar baithe order karo, free home delivery. 🛵\\n📞 7543888698\",\"hashtags\":\"#4AStore #चंद्रगढ़ #Nabinagar #Aurangabad #GroceryStore #HomeDelivery #KiranaStore #Offer\",\"image\":\"\"}','2026-09-19 06:31:43','2026-09-19 06:31:43'),(3,'{\"name\":\"New Ad\",\"campaign\":\"\",\"offerTitle\":\"आज का खास ऑफर\",\"productId\":\"11\",\"productName\":\"Banana (Dozen)\",\"format\":\"16:9\",\"platform\":\"all\",\"status\":\"draft\",\"template\":\"discount\",\"creative\":{\"id\":null,\"name\":\"New Ad\",\"campaign\":\"\",\"offerTitle\":\"आज का खास ऑफर\",\"productId\":\"11\",\"productName\":\"Banana (Dozen)\",\"productIds\":[\"11\",\"18\"],\"productCount\":2,\"productPrices\":{\"4\":145,\"9\":45,\"11\":50,\"16\":25,\"18\":30,\"21\":72},\"price\":50,\"mrp\":60,\"discount\":17,\"format\":\"16:9\",\"platform\":\"all\",\"template\":\"discount\",\"cta\":\"Order Now\",\"localMode\":true,\"lang\":\"hindi\",\"img\":{\"zoom\":2.61,\"x\":0,\"y\":0,\"rot\":0,\"flipH\":false,\"flipV\":false,\"src\":\"https://www.bbassets.com/media/uploads/p/m/10000025_32-fresho-banana-robusta.jpg?tr=w-154,q-80\"},\"lines\":[],\"caption\":\"\",\"hashtags\":\"\",\"status\":\"draft\"},\"caption\":\"\",\"hashtags\":\"\",\"image\":\"\"}','2026-09-23 02:23:37','2026-09-23 02:23:37');
/*!40000 ALTER TABLE `ad_creatives` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `addresses`
--

DROP TABLE IF EXISTS `addresses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `addresses` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned DEFAULT NULL,
  `label` varchar(40) DEFAULT NULL,
  `receiver_name` varchar(120) DEFAULT NULL,
  `phone` varchar(15) DEFAULT NULL,
  `house_no` varchar(120) DEFAULT NULL,
  `landmark` varchar(200) DEFAULT NULL,
  `full_address` varchar(500) DEFAULT NULL,
  `city` varchar(120) DEFAULT NULL,
  `district` varchar(120) DEFAULT NULL,
  `state` varchar(120) DEFAULT 'Bihar',
  `pincode` varchar(10) DEFAULT NULL,
  `latitude` double DEFAULT NULL,
  `longitude` double DEFAULT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_addresses_user` (`user_id`),
  CONSTRAINT `fk_addresses_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `addresses`
--

LOCK TABLES `addresses` WRITE;
/*!40000 ALTER TABLE `addresses` DISABLE KEYS */;
INSERT INTO `addresses` VALUES (2,1,'Home','Store Owner','7543888698','dfggfd','dfggr','dfggfd, Chandragarh (चंद्रगढ़), 824301','Chandragarh (चंद्रगढ़)','Aurangabad','Bihar','824301',24.580164,84.114194,1,'2026-09-30 11:24:53'),(3,12,'Home','Akash kumar','8002116652','Bzznz','Hzhzzn','Bzznz, Chandragarh (चंद्रगढ़), 824301','Chandragarh (चंद्रगढ़)','Aurangabad','Bihar','824301',24.580164,84.114194,1,'2026-10-01 06:59:51');
/*!40000 ALTER TABLE `addresses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `announcements`
--

DROP TABLE IF EXISTS `announcements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `announcements` (
  `id` int(11) NOT NULL DEFAULT 0,
  `text` text DEFAULT NULL,
  `image` varchar(500) DEFAULT NULL,
  `target` varchar(20) NOT NULL DEFAULT 'all',
  `cta_text` varchar(120) DEFAULT NULL,
  `cta_link` varchar(500) DEFAULT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 0,
  `row_id` tinyint(3) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`row_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `announcements`
--

LOCK TABLES `announcements` WRITE;
/*!40000 ALTER TABLE `announcements` DISABLE KEYS */;
INSERT INTO `announcements` VALUES (11,'आज का खास ऑफर — 4A STORE  हरी सब्जियों पर सीधे 20% की छूट! आज ही आइए और ताज़ी-ताज़ी हरी सब्जियाँ 20% DISCOUNT में अपने घर ले जाइए।  ताज़गी भी, बचत भी — 4A Store के साथ! आपके प्यार और विश्वास के लिए 4A Store की ओर से दिल से धन्यवाद! गजना रोड, चंद्रगढ़, नबीनगर, औरंगाबाद  four A Store — आपकी अपनी किराना दुकान','https://www.bbassets.com/media/uploads/p/l/215595_27-surf-excel-easy-wash-detergent-powder.jpg','all','Buy  now','/product/8',1,1);
/*!40000 ALTER TABLE `announcements` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `app_version`
--

DROP TABLE IF EXISTS `app_version`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `app_version` (
  `id` tinyint(3) unsigned NOT NULL DEFAULT 1,
  `version_code` int(11) NOT NULL DEFAULT 1,
  `version_name` varchar(20) NOT NULL DEFAULT '1.0.0',
  `url` varchar(500) DEFAULT NULL,
  `message` text DEFAULT NULL,
  `force_update` tinyint(1) NOT NULL DEFAULT 0,
  `asset_version` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `app_version`
--

LOCK TABLES `app_version` WRITE;
/*!40000 ALTER TABLE `app_version` DISABLE KEYS */;
INSERT INTO `app_version` VALUES (1,17,'1.7.9','https://4astore.example.com/4AStore.apk','New update available.',0,16);
/*!40000 ALTER TABLE `app_version` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `categories`
--

DROP TABLE IF EXISTS `categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `categories` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(120) NOT NULL,
  `slug` varchar(120) NOT NULL,
  `icon` varchar(16) DEFAULT NULL,
  `image` varchar(500) DEFAULT NULL,
  `hidden` tinyint(1) NOT NULL DEFAULT 0,
  `age_restricted` tinyint(1) NOT NULL DEFAULT 0,
  `warning` varchar(255) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categories_slug` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `categories`
--

LOCK TABLES `categories` WRITE;
/*!40000 ALTER TABLE `categories` DISABLE KEYS */;
INSERT INTO `categories` VALUES (1,'Fruits & Vegetables','fruits-vegetables','🥬','https://static.vecteezy.com/system/resources/thumbnails/033/210/784/small_2x/various-mixed-healthy-fruits-background-ai-generative-pro-photo.jpg',0,0,NULL,1),(2,'Rice, Atta & Dal','rice-atta-dal','🌾','https://cdn-icons-png.flaticon.com/512/3174/3174880.png',0,0,NULL,2),(3,'Oil & Ghee','oil-ghee','🫒','https://cdn-icons-png.flaticon.com/512/5787/5787016.png',0,0,NULL,3),(4,'Biscuits & Snacks','biscuits-snacks','🍪','https://cdn-icons-png.flaticon.com/512/2454/2454253.png',0,0,NULL,4),(5,'Tea & Coffee','tea-coffee','☕','https://cdn-icons-png.flaticon.com/512/924/924514.png',0,0,NULL,5),(6,'Cold Drinks & Beverages','cold-drinks-beverages','🥤','https://cdn-icons-png.flaticon.com/512/3050/3050153.png',0,0,NULL,6),(7,'Dairy & Bakery','dairy-bakery','🥛','https://cdn-icons-png.flaticon.com/512/3500/3500170.png',0,0,NULL,7),(8,'Personal Care','personal-care','🧴','https://cdn-icons-png.flaticon.com/512/2553/2553691.png',0,0,NULL,8),(9,'Home Cleaning','home-cleaning','🧹','https://cdn-icons-png.flaticon.com/512/995/995016.png',0,0,NULL,9),(10,'Baby Care','baby-care','👶','https://cdn-icons-png.flaticon.com/512/3373/3373060.png',0,0,NULL,10),(11,'Stationery','stationery','📝','https://cdn-icons-png.flaticon.com/512/2541/2541988.png',0,0,NULL,11),(12,'Daily Essentials','daily-essentials','🛒','https://cdn-icons-png.flaticon.com/512/3724/3724788.png',0,0,NULL,12),(13,'Mouth Freshener','mouth-freshener','🍃','https://cdn-icons-png.flaticon.com/512/2553/2553651.png',1,1,'Tobacco causes cancer. Sirf 18+ ke liye.',14),(14,'Dry Fruits','dry-fruits','🥜','https://cdn-icons-png.flaticon.com/512/2224/2224152.png',0,0,NULL,13);
/*!40000 ALTER TABLE `categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `config`
--

DROP TABLE IF EXISTS `config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `config` (
  `id` tinyint(3) unsigned NOT NULL DEFAULT 1,
  `banners` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`banners`)),
  `festival_ads` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`festival_ads`)),
  `festival_categories` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`festival_categories`)),
  `ads` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`ads`)),
  `social_proof_messages` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`social_proof_messages`)),
  `social_proof_names` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`social_proof_names`)),
  `current_festival` varchar(40) DEFAULT NULL,
  `footer` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (`footer` is null or json_valid(`footer`)),
  `video_settings` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (`video_settings` is null or json_valid(`video_settings`)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `config`
--

LOCK TABLES `config` WRITE;
/*!40000 ALTER TABLE `config` DISABLE KEYS */;
INSERT INTO `config` VALUES (1,'[{\"title\":\"घर बैठे मंगाइए ताज़ा किराना सामान! चावल • दाल • आटा • तेल • मसाले • बिस्कुट • साबुन और बहुत कुछ\",\"subtitle\":\"\",\"btnText\":\"Shop Now →\",\"btnLink\":\"products.html\",\"gradient\":[\"#ff6600\",\"#ff9800\"],\"image\":\"data/banners/banner_20260928_114255_ac474c0b.webp\",\"festival\":\"\",\"active\":true},{\"title\":\"🍎 ताज़े फल और सब्ज़ियाँ\",\"subtitle\":\"हर दिन ताज़गी, स्वाद और सेहत का भरोसा।\",\"btnText\":\"Explore →\",\"btnLink\":\"products.html?category=fruits-vegetables\",\"gradient\":[\"#e55b00\",\"#ffb74d\"],\"image\":\"data/banners/banner_20260928_114318_d7cfcfd4.webp\",\"festival\":\"\",\"active\":true},{\"title\":\"🏷️ Daily Essentials at Best Prices\",\"subtitle\":\"Up to 25% OFF on rice, oil, dal and more\",\"btnText\":\"View Offers →\",\"btnLink\":\"products.html\",\"gradient\":[\"#bf360c\",\"#ff7043\"],\"image\":\"data/banners/banner_20260928_120421_2d580d18.webp\",\"festival\":\"\",\"active\":true},{\"title\":\"🪔 Diwali Special Offers!\",\"subtitle\":\"Sweets, dry fruits, pooja samagri at best prices. Happy Diwali!\",\"btnText\":\"Diwali Store →\",\"btnLink\":\"products.html?festival=diwali\",\"gradient\":[\"#ff6f00\",\"#ffd54f\"],\"image\":\"\",\"festival\":\"diwali\",\"active\":true},{\"title\":\"🎄 Christmas & New Year Sale\",\"subtitle\":\"Celebrate with discounts on cakes, chocolates & beverages\",\"btnText\":\"Celebrate →\",\"btnLink\":\"products.html?festival=christmas\",\"gradient\":[\"#c62828\",\"#ef5350\"],\"image\":\"\",\"festival\":\"christmas\",\"active\":true},{\"title\":\"🕉️ Navratri Special\",\"subtitle\":\"Fasting essentials – Kuttu atta, Sabudana, fruits & more\",\"btnText\":\"Shop Navratri →\",\"btnLink\":\"products.html?festival=navratri\",\"gradient\":[\"#ff6600\",\"#ff8f00\"],\"image\":\"\",\"festival\":\"navratri\",\"active\":true},{\"title\":\"🏏 IPL Season Snack Fest\",\"subtitle\":\"Chips, Kurkure, Cold drinks – Match time snacks!\",\"btnText\":\"Snack Up →\",\"btnLink\":\"products.html?festival=ipl\",\"gradient\":[\"#1565c0\",\"#42a5f5\"],\"image\":\"\",\"festival\":\"ipl\",\"active\":true},{\"title\":\"☪️ Eid Mubarak – Special Offers\",\"subtitle\":\"Biryani rice, ghee, dry fruits & sweets\",\"btnText\":\"Eid Store →\",\"btnLink\":\"products.html?festival=eid\",\"gradient\":[\"#1b5e20\",\"#4caf50\"],\"image\":\"\",\"festival\":\"eid\",\"active\":true},{\"title\":\"🪢 Raksha Bandhan Special!\",\"subtitle\":\"Sweets, chocolates & snacks for your sibling! 🎁\",\"btnText\":\"Rakhi Gifts →\",\"btnLink\":\"products.html?festival=rakhi\",\"gradient\":[\"#d81b60\",\"#f06292\"],\"image\":\"\",\"festival\":\"rakhi\",\"active\":true},{\"title\":\"🪢 Bhai-Behen ka Pyaar!\",\"subtitle\":\"Dry fruits, namkeen, chocolates – best gifts for your sister\",\"btnText\":\"Shop Rakhi →\",\"btnLink\":\"products.html?festival=rakhi\",\"gradient\":[\"#ad1457\",\"#ec407a\"],\"image\":\"\",\"festival\":\"rakhi\",\"active\":true},{\"title\":\"🎨 Holi Dhamaka Sale!\",\"subtitle\":\"Cold drinks, sweets, snacks – rangon ka tyohar!\",\"btnText\":\"Holi Shopping →\",\"btnLink\":\"products.html?festival=holi\",\"gradient\":[\"#6a1b9a\",\"#ab47bc\"],\"image\":\"\",\"festival\":\"holi\",\"active\":true},{\"title\":\"🇮🇳 Independence Day – Desh Ka Store!\",\"subtitle\":\"Special discounts on all Indian brands 🇮🇳\",\"btnText\":\"Shop Desi →\",\"btnLink\":\"products.html?festival=independence\",\"gradient\":[\"#e65100\",\"#ff6600\"],\"image\":\"\",\"festival\":\"independence\",\"active\":true},{\"title\":\"🛕 Chhath Puja Special\",\"subtitle\":\"Thekua, fruits, puja samagri & more for Chhath\",\"btnText\":\"Chhath Store →\",\"btnLink\":\"products.html?festival=chhath\",\"gradient\":[\"#e65100\",\"#ffb300\"],\"image\":\"\",\"festival\":\"chhath\",\"active\":true},{\"title\":\"🚀 Fast Delivery in Chandargarh\",\"subtitle\":\"Order now, get delivered quick – only for 824301\",\"btnText\":\"Order Now →\",\"btnLink\":\"products.html\",\"gradient\":[\"#e65100\",\"#fb8c00\"],\"image\":\"data/banners/banner_20260928_120404_7fa70c9f.webp\",\"festival\":\"\",\"active\":true}]','{\"rakhi\":{\"leftAd\":{\"title\":\"🪢 Rakhi Offers\",\"text\":\"Sweets & Gifts at ₹99 onwards!\",\"bgGradient\":[\"#d81b60\",\"#f48fb1\"],\"link\":\"products.html?festival=rakhi\",\"emoji\":\"🎁\"},\"rightAd\":{\"title\":\"💝 Gift Hampers\",\"text\":\"Chocolates, Namkeen, Dry Fruits – Perfect Rakhi Gift!\",\"bgGradient\":[\"#ad1457\",\"#f06292\"],\"link\":\"products.html?festival=rakhi\",\"emoji\":\"🍫\"},\"midBanner\":{\"title\":\"🪢 Happy Raksha Bandhan!\",\"text\":\"Special combos for Bhai-Behen. Free delivery above ₹500!\",\"bgGradient\":[\"#880e4f\",\"#ec407a\"],\"link\":\"products.html?festival=rakhi\",\"emoji\":\"🎀\"}},\"diwali\":{\"leftAd\":{\"title\":\"🪔 Diwali Dhamaka\",\"text\":\"Pooja items, Sweets, Dry fruits from ₹49\",\"bgGradient\":[\"#ff6f00\",\"#ffd54f\"],\"link\":\"products.html?festival=diwali\",\"emoji\":\"🪔\"},\"rightAd\":{\"title\":\"🎆 Diwali Gift Packs\",\"text\":\"Premium Dry fruits, Ghee, Sweets for gifting\",\"bgGradient\":[\"#e65100\",\"#ffcc02\"],\"link\":\"products.html?festival=diwali\",\"emoji\":\"🎁\"},\"midBanner\":{\"title\":\"🎇 Diwali Mega Sale!\",\"text\":\"Up to 30% OFF on all essentials. Light up savings!\",\"bgGradient\":[\"#bf360c\",\"#ffa000\"],\"link\":\"products.html?festival=diwali\",\"emoji\":\"✨\"}},\"holi\":{\"leftAd\":{\"title\":\"🎨 Holi Special\",\"text\":\"Thandai, Sweets, Colors – sab milega!\",\"bgGradient\":[\"#6a1b9a\",\"#ce93d8\"],\"link\":\"products.html?festival=holi\",\"emoji\":\"💜\"},\"rightAd\":{\"title\":\"🥤 Party Pack\",\"text\":\"Cold drinks, Chips, Namkeen for Holi party!\",\"bgGradient\":[\"#4a148c\",\"#ba68c8\"],\"link\":\"products.html?festival=holi\",\"emoji\":\"🥳\"},\"midBanner\":{\"title\":\"🎨 Rang Barse! Holi Offer\",\"text\":\"Buy 3 Get 1 Free on snacks & beverages\",\"bgGradient\":[\"#7b1fa2\",\"#e040fb\"],\"link\":\"products.html?festival=holi\",\"emoji\":\"🌈\"}},\"navratri\":{\"leftAd\":{\"title\":\"🕉️ Navratri Vrat\",\"text\":\"Kuttu, Sabudana, Fruits, Milk & more\",\"bgGradient\":[\"#e65100\",\"#ff8f00\"],\"link\":\"products.html?festival=navratri\",\"emoji\":\"🙏\"},\"rightAd\":{\"title\":\"🌺 Pooja Essentials\",\"text\":\"Fresh flowers, Agarbatti, Ghee, Camphor\",\"bgGradient\":[\"#bf360c\",\"#ff6e40\"],\"link\":\"products.html?festival=navratri\",\"emoji\":\"🛕\"},\"midBanner\":{\"title\":\"🕉️ Jai Mata Di! Navratri Sale\",\"text\":\"Fasting food at lowest prices. Deliver in 824301\",\"bgGradient\":[\"#d84315\",\"#ff9100\"],\"link\":\"products.html?festival=navratri\",\"emoji\":\"🔱\"}},\"christmas\":{\"leftAd\":{\"title\":\"🎄 Merry Christmas\",\"text\":\"Cakes, Chocolates, Cold drinks & more!\",\"bgGradient\":[\"#b71c1c\",\"#ef5350\"],\"link\":\"products.html?festival=christmas\",\"emoji\":\"🎅\"},\"rightAd\":{\"title\":\"🎁 New Year Gifts\",\"text\":\"Gift hampers, Dry fruits, Premium packs\",\"bgGradient\":[\"#c62828\",\"#ff5252\"],\"link\":\"products.html?festival=christmas\",\"emoji\":\"🥂\"},\"midBanner\":{\"title\":\"🎄 Christmas & New Year Offer!\",\"text\":\"Flat 15% OFF on beverages & bakery items\",\"bgGradient\":[\"#880e4f\",\"#e53935\"],\"link\":\"products.html?festival=christmas\",\"emoji\":\"⭐\"}},\"eid\":{\"leftAd\":{\"title\":\"☪️ Eid Mubarak\",\"text\":\"Biryani Rice, Ghee, Sheer Khurma items\",\"bgGradient\":[\"#1b5e20\",\"#66bb6a\"],\"link\":\"products.html?festival=eid\",\"emoji\":\"🌙\"},\"rightAd\":{\"title\":\"🍗 Eid Feast\",\"text\":\"Premium Basmati, Oil, Spices for celebration\",\"bgGradient\":[\"#2e7d32\",\"#81c784\"],\"link\":\"products.html?festival=eid\",\"emoji\":\"🥘\"},\"midBanner\":{\"title\":\"☪️ Eid Special Combo Offers!\",\"text\":\"Rice + Oil + Spices combo at best price\",\"bgGradient\":[\"#1b5e20\",\"#4caf50\"],\"link\":\"products.html?festival=eid\",\"emoji\":\"⭐\"}},\"ipl\":{\"leftAd\":{\"title\":\"🏏 IPL Snacks\",\"text\":\"Chips, Kurkure, Cold drinks – match ready!\",\"bgGradient\":[\"#0d47a1\",\"#42a5f5\"],\"link\":\"products.html?festival=ipl\",\"emoji\":\"🏆\"},\"rightAd\":{\"title\":\"🍿 Party Pack\",\"text\":\"Popcorn, Lays, Pepsi, Sprite – full party!\",\"bgGradient\":[\"#1565c0\",\"#64b5f6\"],\"link\":\"products.html?festival=ipl\",\"emoji\":\"📺\"},\"midBanner\":{\"title\":\"🏏 IPL Season! Snack Up!\",\"text\":\"Buy snacks + drink combo. Cricket + Munch = Fun\",\"bgGradient\":[\"#0d47a1\",\"#2196f3\"],\"link\":\"products.html?festival=ipl\",\"emoji\":\"⚡\"}},\"independence\":{\"leftAd\":{\"title\":\"🇮🇳 Jai Hind!\",\"text\":\"Proud Indian brands at best prices\",\"bgGradient\":[\"#e65100\",\"#ff6600\"],\"link\":\"products.html?festival=independence\",\"emoji\":\"🦚\"},\"rightAd\":{\"title\":\"🪷 Swadeshi Products\",\"text\":\"Tata, Amul, Parle – Made in India!\",\"bgGradient\":[\"#1a237e\",\"#5c6bc0\"],\"link\":\"products.html?festival=independence\",\"emoji\":\"🇮🇳\"},\"midBanner\":{\"title\":\"🇮🇳 Independence Day Sale!\",\"text\":\"15% OFF on Indian brand products. Jai Hind!\",\"bgGradient\":[\"#004d40\",\"#ff6f00\"],\"link\":\"products.html?festival=independence\",\"emoji\":\"⭐\"}},\"chhath\":{\"leftAd\":{\"title\":\"🛕 Chhath Puja\",\"text\":\"Thekua, Fruits, Coconut, Sugarcane & more\",\"bgGradient\":[\"#e65100\",\"#ffb300\"],\"link\":\"products.html?festival=chhath\",\"emoji\":\"🌅\"},\"rightAd\":{\"title\":\"🍌 Puja Samagri\",\"text\":\"Banana, Naariyal, Supari, Sindoor, Diyas\",\"bgGradient\":[\"#bf360c\",\"#ffc107\"],\"link\":\"products.html?festival=chhath\",\"emoji\":\"🙏\"},\"midBanner\":{\"title\":\"🛕 Chhath Puja Special!\",\"text\":\"All puja & vrat items at one place. Jai Chhathi Maiya!\",\"bgGradient\":[\"#e65100\",\"#ff8f00\"],\"link\":\"products.html?festival=chhath\",\"emoji\":\"🌅\"}}}','{\"rakhi\":[\"biscuits-snacks\",\"dairy-bakery\",\"cold-drinks-beverages\"],\"diwali\":[\"biscuits-snacks\",\"dairy-bakery\",\"daily-essentials\",\"oil-ghee\"],\"navratri\":[\"fruits-vegetables\",\"dairy-bakery\",\"daily-essentials\"],\"holi\":[\"cold-drinks-beverages\",\"biscuits-snacks\",\"dairy-bakery\"],\"christmas\":[\"cold-drinks-beverages\",\"biscuits-snacks\",\"dairy-bakery\"],\"eid\":[\"rice-atta-dal\",\"oil-ghee\",\"daily-essentials\",\"biscuits-snacks\"],\"ipl\":[\"biscuits-snacks\",\"cold-drinks-beverages\"],\"independence\":[\"biscuits-snacks\",\"cold-drinks-beverages\",\"daily-essentials\",\"tea-coffee\"],\"chhath\":[\"fruits-vegetables\",\"daily-essentials\",\"oil-ghee\"]}','[{\"id\":1,\"title\":\"🎉 Flat 10% OFF on First Order!\",\"description\":\"Limited time offer for new customers!\",\"bgColor\":\"#fff3e0\",\"borderColor\":\"#ff6600\",\"icon\":\"🎁\",\"link\":\"products.html\",\"active\":true},{\"id\":2,\"title\":\"🥛 Fresh Dairy Daily\",\"description\":\"Amul Milk, Butter, Curd – fresh every morning\",\"bgColor\":\"#f3e5f5\",\"borderColor\":\"#9c27b0\",\"icon\":\"🐄\",\"link\":\"products.html?category=dairy-bakery\",\"active\":true},{\"id\":3,\"title\":\"📱 Pay Easy with UPI\",\"description\":\"Scan & pay instantly. 100% secure.\",\"bgColor\":\"#e3f2fd\",\"borderColor\":\"#1565c0\",\"icon\":\"💳\",\"link\":\"checkout.html\",\"active\":true},{\"id\":4,\"title\":\"🚚 Free Delivery above ₹{{freeDeliveryAbove}}\",\"description\":\"Order ₹{{freeDeliveryAbove}}+ for FREE home delivery\",\"bgColor\":\"#e8f5e9\",\"borderColor\":\"#2e7d32\",\"icon\":\"🆓\",\"link\":\"products.html\",\"active\":true}]','[\"{name} from Chandargarh just ordered {product}\",\"{name} purchased {product} just now!\",\"🔥 {name} added {product} to cart\",\"{name} just placed an order worth ₹{amount}\",\"New order from {name} – {product}\"]','[\"Rahul\",\"Priya\",\"Amit\",\"Sunita\",\"Ravi\",\"Pooja\",\"Vijay\",\"Anita\",\"Suresh\",\"Meena\",\"Deepak\",\"Kavita\",\"Rajesh\",\"Neha\",\"Manoj\"]',NULL,NULL,'{\"store\":{\"name\":\"4astore\",\"tagline\":\"Aapka Apna Grocery Store\",\"phone\":\"82108 74123\",\"whatsapp\":\"82108 74123\",\"address\":\"Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\",\"area\":\"Nabinagar, Aurangabad (Bihar)\",\"deliveryCharge\":30,\"freeAbove\":500,\"payment\":\"UPI (GPay/PhonePe/Paytm)\",\"theme\":{\"primary\":\"#ff6600\",\"dark\":\"#e55b00\",\"light\":\"#fff3e0\",\"accent\":\"#d32f2f\",\"ink\":\"#1a1a2e\"}},\"auto\":{\"enabled\":false,\"time\":\"06:00\",\"leadDays\":0,\"formats\":[\"reel\"],\"durationSec\":24,\"keepLast\":30,\"notify\":true}}');
/*!40000 ALTER TABLE `config` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `device_tokens`
--

DROP TABLE IF EXISTS `device_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `device_tokens` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned DEFAULT NULL,
  `token` varchar(255) NOT NULL,
  `platform` enum('android','ios','web') NOT NULL,
  `topics` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`topics`)),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_device_token` (`token`),
  KEY `idx_device_user` (`user_id`),
  CONSTRAINT `fk_device_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `device_tokens`
--

LOCK TABLES `device_tokens` WRITE;
/*!40000 ALTER TABLE `device_tokens` DISABLE KEYS */;
INSERT INTO `device_tokens` VALUES (1,1,'dev-token-owner-123','web','[\"all\",\"customers\",\"admins\"]','2026-09-30 02:48:59','2026-09-30 02:48:59');
/*!40000 ALTER TABLE `device_tokens` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `email_otps`
--

DROP TABLE IF EXISTS `email_otps`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `email_otps` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `email` varchar(190) NOT NULL,
  `otp` varchar(10) NOT NULL,
  `purpose` enum('signup','recovery') NOT NULL DEFAULT 'signup',
  `expires_at` datetime NOT NULL,
  `consumed` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_otp_email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `email_otps`
--

LOCK TABLES `email_otps` WRITE;
/*!40000 ALTER TABLE `email_otps` DISABLE KEYS */;
INSERT INTO `email_otps` VALUES (1,'test@example.com','437494','signup','2026-09-30 08:09:52',1,'2026-09-30 02:29:52'),(2,'c2@example.com','943873','signup','2026-09-30 08:29:00',1,'2026-09-30 02:49:00'),(3,'test@example.com','412630','signup','2026-09-30 10:17:47',0,'2026-09-30 04:37:47'),(4,'test@example.com','740354','signup','2026-09-30 10:18:45',0,'2026-09-30 04:38:45'),(5,'recover33939@example.com','725306','recovery','2026-09-30 12:48:17',1,'2026-09-30 07:08:17'),(6,'akashjii300@gmail.com','488813','signup','2026-10-01 07:08:44',1,'2026-10-01 01:28:44');
/*!40000 ALTER TABLE `email_otps` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `festivals`
--

DROP TABLE IF EXISTS `festivals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `festivals` (
  `id` varchar(40) NOT NULL,
  `name` varchar(80) NOT NULL,
  `date` date DEFAULT NULL,
  `date_verified` tinyint(1) NOT NULL DEFAULT 0,
  `greeting` varchar(120) NOT NULL DEFAULT '',
  `sub_text` varchar(200) NOT NULL DEFAULT '',
  `emojis` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`emojis`)),
  `colors` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`colors`)),
  `music_style` varchar(10) NOT NULL DEFAULT 'festive',
  `default_offer` varchar(120) NOT NULL DEFAULT '',
  `translations` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (`translations` is null or json_valid(`translations`)),
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_festivals_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `festivals`
--

LOCK TABLES `festivals` WRITE;
/*!40000 ALTER TABLE `festivals` DISABLE KEYS */;
INSERT INTO `festivals` VALUES ('akshaya-tritiya','Akshaya Tritiya',NULL,0,'Akshaya Tritiya ki Shubhkamnayein','Sukh, samriddhi aur khushiyan bani rahein','[\"🪙\",\"🌟\",\"🪔\",\"🙏\"]','{\"primary\":\"#b8860b\",\"secondary\":\"#daa520\",\"accent\":\"#8b0000\"}','festive','Shubh din par khaas bachat','{\"hindi\":{\"name\":\"अक्षय तृतीया\",\"greeting\":\"अक्षय तृतीया की शुभकामनाएँ\",\"subText\":\"सुख, समृद्धि और खुशियाँ बनी रहें\",\"defaultOffer\":\"शुभ दिन पर खास बचत\"},\"english\":{\"name\":\"Akshaya Tritiya\",\"greeting\":\"Happy Akshaya Tritiya!\",\"subText\":\"Wishing you lasting prosperity\",\"defaultOffer\":\"Special savings on this auspicious day\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('basant-panchami','Basant Panchami',NULL,0,'Basant Panchami ki Shubhkamnayein','Maa Saraswati ka aashirwad aap par bana rahe','[\"🌼\",\"📚\",\"🪷\",\"💛\"]','{\"primary\":\"#f9a825\",\"secondary\":\"#fdd835\",\"accent\":\"#e65100\"}','calm','Pooja saamagri aur mithai par offer','{\"hindi\":{\"name\":\"बसंत पंचमी\",\"greeting\":\"बसंत पंचमी की शुभकामनाएँ\",\"subText\":\"माँ सरस्वती का आशीर्वाद आप पर बना रहे\",\"defaultOffer\":\"पूजा सामग्री और मिठाई पर ऑफ़र\"},\"english\":{\"name\":\"Basant Panchami\",\"greeting\":\"Happy Basant Panchami!\",\"subText\":\"May Maa Saraswati bless you always\",\"defaultOffer\":\"Offers on pooja items and sweets\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('bhai-dooj','Bhai Dooj',NULL,0,'Happy Bhai Dooj!','Bhai-behen ka atoot rishta','[\"🪔\",\"🍬\",\"🎁\",\"💝\"]','{\"primary\":\"#c2185b\",\"secondary\":\"#ff8f00\",\"accent\":\"#ffe082\"}','festive','Mithai aur gift packs par offer','{\"hindi\":{\"name\":\"भाई दूज\",\"greeting\":\"भाई दूज की शुभकामनाएँ!\",\"subText\":\"भाई-बहन का अटूट रिश्ता\",\"defaultOffer\":\"मिठाई और गिफ्ट पैक पर ऑफ़र\"},\"english\":{\"name\":\"Bhai Dooj\",\"greeting\":\"Happy Bhai Dooj!\",\"subText\":\"Celebrating an unbreakable bond\",\"defaultOffer\":\"Offers on sweets and gift packs\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('chaitra-navratri','Chaitra Navratri',NULL,0,'Chaitra Navratri ki Shubhkamnayein','Maa Durga aapki har manokamna poori karein','[\"🪔\",\"🌺\",\"🙏\",\"✨\"]','{\"primary\":\"#c62828\",\"secondary\":\"#ff7043\",\"accent\":\"#ffd54f\"}','festive','Vrat special — kuttu atta, sabudana, makhana','{\"hindi\":{\"name\":\"चैत्र नवरात्रि\",\"greeting\":\"चैत्र नवरात्रि की शुभकामनाएँ\",\"subText\":\"माँ दुर्गा आपकी हर मनोकामना पूरी करें\",\"defaultOffer\":\"व्रत स्पेशल — कुट्टू आटा, साबूदाना, मखाना\"},\"english\":{\"name\":\"Chaitra Navratri\",\"greeting\":\"Happy Chaitra Navratri!\",\"subText\":\"May Maa Durga fulfil all your wishes\",\"defaultOffer\":\"Fasting specials — kuttu atta, sabudana, makhana\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('chhath-puja','Chhath Puja',NULL,0,'Chhath Puja ki Shubhkamnayein','Chhathi Maiya sabki manokamna poori karein','[\"🌅\",\"🪔\",\"🍌\",\"🙏\"]','{\"primary\":\"#ef6c00\",\"secondary\":\"#ffb74d\",\"accent\":\"#bf360c\"}','calm','Chhath saamagri — thekua ka saaman, fal, soop','{\"hindi\":{\"name\":\"छठ पूजा\",\"greeting\":\"छठ पूजा की शुभकामनाएँ\",\"subText\":\"छठी मइया सबकी मनोकामना पूरी करें\",\"defaultOffer\":\"छठ सामग्री — ठेकुआ का सामान, फल, सूप\"},\"english\":{\"name\":\"Chhath Puja\",\"greeting\":\"Happy Chhath Puja!\",\"subText\":\"May Chhathi Maiya fulfil everyone\'s wishes\",\"defaultOffer\":\"Chhath essentials — thekua items, fruits, soop\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('christmas','Christmas','2026-12-25',0,'Merry Christmas!','Khushiyon aur pyaar bhara Christmas','[\"🎄\",\"🎅\",\"🎁\",\"⭐\"]','{\"primary\":\"#c62828\",\"secondary\":\"#2e7d32\",\"accent\":\"#ffd54f\"}','upbeat','Cake, chocolates aur snacks par offer','{\"hindi\":{\"name\":\"क्रिसमस\",\"greeting\":\"मेरी क्रिसमस!\",\"subText\":\"खुशियों और प्यार भरा क्रिसमस\",\"defaultOffer\":\"केक, चॉकलेट और स्नैक्स पर ऑफ़र\"},\"english\":{\"name\":\"Christmas\",\"greeting\":\"Merry Christmas!\",\"subText\":\"Wishing you joy and love this Christmas\",\"defaultOffer\":\"Offers on cakes, chocolates and snacks\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('dhanteras','Dhanteras',NULL,0,'Shubh Dhanteras!','Aapke ghar sukh aur samriddhi aaye','[\"🪙\",\"🪔\",\"✨\",\"🙏\"]','{\"primary\":\"#b8860b\",\"secondary\":\"#1a1a2e\",\"accent\":\"#ffd700\"}','festive','Dhanteras Special Offer','{\"hindi\":{\"name\":\"धनतेरस\",\"greeting\":\"शुभ धनतेरस!\",\"subText\":\"आपके घर सुख और समृद्धि आए\",\"defaultOffer\":\"धनतेरस स्पेशल ऑफ़र\"},\"english\":{\"name\":\"Dhanteras\",\"greeting\":\"Happy Dhanteras!\",\"subText\":\"May prosperity fill your home\",\"defaultOffer\":\"Dhanteras special offer\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('diwali','Diwali',NULL,0,'Happy Diwali!','Deepawali ki hardik Shubhkamnayein','[\"🪔\",\"✨\",\"🎆\",\"🪙\"]','{\"primary\":\"#1a1a2e\",\"secondary\":\"#b8860b\",\"accent\":\"#ffd700\"}','festive','Diwali Dhamaka — mithai, dry fruits, pooja saamagri','{\"hindi\":{\"name\":\"दीपावली\",\"greeting\":\"दीपावली की शुभकामनाएँ!\",\"subText\":\"दीपावली की हार्दिक शुभकामनाएँ\",\"defaultOffer\":\"दिवाली धमाका — मिठाई, ड्राई फ्रूट्स, पूजा सामग्री\"},\"english\":{\"name\":\"Diwali\",\"greeting\":\"Happy Diwali!\",\"subText\":\"Wishing you a bright and joyful Diwali\",\"defaultOffer\":\"Diwali Dhamaka — sweets, dry fruits, pooja items\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('dussehra','Dussehra',NULL,0,'Happy Dussehra!','Burai par achchhai ki jeet ka tyohar','[\"🏹\",\"🔥\",\"🚩\",\"✨\"]','{\"primary\":\"#d84315\",\"secondary\":\"#ff8a65\",\"accent\":\"#ffd54f\"}','festive','Dussehra Dhamaka Offer','{\"hindi\":{\"name\":\"दशहरा\",\"greeting\":\"दशहरा की शुभकामनाएँ!\",\"subText\":\"बुराई पर अच्छाई की जीत का त्योहार\",\"defaultOffer\":\"दशहरा धमाका ऑफ़र\"},\"english\":{\"name\":\"Dussehra\",\"greeting\":\"Happy Dussehra!\",\"subText\":\"Celebrating the victory of good over evil\",\"defaultOffer\":\"Dussehra Dhamaka offer\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('eid-ul-adha','Eid ul-Adha',NULL,0,'Eid ul-Adha Mubarak!','Bakrid ki dili Shubhkamnayein','[\"🌙\",\"🕌\",\"⭐\",\"🤲\"]','{\"primary\":\"#004d40\",\"secondary\":\"#00897b\",\"accent\":\"#ffe082\"}','calm','Masale, chawal aur dry fruits par offer','{\"hindi\":{\"name\":\"ईद उल-अज़हा\",\"greeting\":\"ईद उल-अज़हा मुबारक!\",\"subText\":\"बकरीद की दिली शुभकामनाएँ\",\"defaultOffer\":\"मसाले, चावल और ड्राई फ्रूट्स पर ऑफ़र\"},\"english\":{\"name\":\"Eid ul-Adha\",\"greeting\":\"Eid ul-Adha Mubarak!\",\"subText\":\"Warm wishes on Bakrid\",\"defaultOffer\":\"Offers on spices, rice and dry fruits\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('eid-ul-fitr','Eid ul-Fitr',NULL,0,'Eid Mubarak!','Eid ki dher saari khushiyan aapko','[\"🌙\",\"⭐\",\"🕌\",\"🤲\"]','{\"primary\":\"#1b5e20\",\"secondary\":\"#43a047\",\"accent\":\"#ffd54f\"}','calm','Sewai, dry fruits aur doodh par offer','{\"hindi\":{\"name\":\"ईद उल-फ़ित्र\",\"greeting\":\"ईद मुबारक!\",\"subText\":\"ईद की ढेर सारी खुशियाँ आपको\",\"defaultOffer\":\"सेवई, ड्राई फ्रूट्स और दूध पर ऑफ़र\"},\"english\":{\"name\":\"Eid ul-Fitr\",\"greeting\":\"Eid Mubarak!\",\"subText\":\"Wishing you a joyful Eid\",\"defaultOffer\":\"Offers on sewai, dry fruits and milk\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('ganesh-chaturthi','Ganesh Chaturthi',NULL,0,'Ganpati Bappa Morya!','Ganesh Chaturthi ki Shubhkamnayein','[\"🐘\",\"🌺\",\"🪔\",\"🙏\"]','{\"primary\":\"#e65100\",\"secondary\":\"#ffb300\",\"accent\":\"#c62828\"}','festive','Modak, laddoo aur pooja saamagri','{\"hindi\":{\"name\":\"गणेश चतुर्थी\",\"greeting\":\"गणपति बप्पा मोरया!\",\"subText\":\"गणेश चतुर्थी की शुभकामनाएँ\",\"defaultOffer\":\"मोदक, लड्डू और पूजा सामग्री\"},\"english\":{\"name\":\"Ganesh Chaturthi\",\"greeting\":\"Ganpati Bappa Morya!\",\"subText\":\"Happy Ganesh Chaturthi\",\"defaultOffer\":\"Modak, laddoo and pooja items\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('guru-nanak-jayanti','Guru Nanak Jayanti',NULL,0,'Guru Nanak Jayanti ki Lakh Lakh Badhaiyan','Gurpurab di vadhaiyan','[\"🙏\",\"🪔\",\"✨\"]','{\"primary\":\"#e65100\",\"secondary\":\"#1565c0\",\"accent\":\"#ffd54f\"}','calm','Langar aur prasad ka saaman','{\"hindi\":{\"name\":\"गुरु नानक जयंती\",\"greeting\":\"गुरु नानक जयंती की लख-लख बधाइयाँ\",\"subText\":\"गुरपुरब दी वधाइयाँ\",\"defaultOffer\":\"लंगर और प्रसाद का सामान\"},\"english\":{\"name\":\"Guru Nanak Jayanti\",\"greeting\":\"Happy Gurpurab!\",\"subText\":\"Warm wishes on Guru Nanak Jayanti\",\"defaultOffer\":\"Langar and prasad essentials\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('holi','Holi',NULL,0,'Happy Holi!','Rangon bhari Holi ki Shubhkamnayein','[\"🎨\",\"🌈\",\"💦\",\"🎉\"]','{\"primary\":\"#e91e63\",\"secondary\":\"#7c4dff\",\"accent\":\"#ffeb3b\"}','upbeat','Gujiya, rang aur namkeen par offer','{\"hindi\":{\"name\":\"होली\",\"greeting\":\"होली की शुभकामनाएँ!\",\"subText\":\"रंगों भरी होली की हार्दिक शुभकामनाएँ\",\"defaultOffer\":\"गुजिया, रंग और नमकीन पर ऑफ़र\"},\"english\":{\"name\":\"Holi\",\"greeting\":\"Happy Holi!\",\"subText\":\"Wishing you a colourful Holi\",\"defaultOffer\":\"Offers on gujiya, colours and snacks\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('independence-day','Independence Day','2027-08-15',0,'Happy Independence Day!','Swatantrata Diwas ki Shubhkamnayein — Jai Hind','[\"🇮🇳\",\"🕊️\",\"🎖️\"]','{\"primary\":\"#ff9933\",\"secondary\":\"#138808\",\"accent\":\"#000080\"}','upbeat','Freedom Sale — har order par bachat','{\"hindi\":{\"name\":\"स्वतंत्रता दिवस\",\"greeting\":\"स्वतंत्रता दिवस की शुभकामनाएँ!\",\"subText\":\"जय हिंद! आज़ादी का जश्न\",\"defaultOffer\":\"फ्रीडम सेल — हर ऑर्डर पर बचत\"},\"english\":{\"name\":\"Independence Day\",\"greeting\":\"Happy Independence Day!\",\"subText\":\"Jai Hind! Celebrating freedom\",\"defaultOffer\":\"Freedom Sale — savings on every order\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('janmashtami','Janmashtami',NULL,0,'Happy Janmashtami!','Nand ke anand bhayo, Jai Kanhaiya Lal ki','[\"🦚\",\"🪈\",\"🧈\",\"🙏\"]','{\"primary\":\"#1565c0\",\"secondary\":\"#26a69a\",\"accent\":\"#ffd54f\"}','festive','Makhan, mishri aur vrat ka saaman','{\"hindi\":{\"name\":\"जन्माष्टमी\",\"greeting\":\"जन्माष्टमी की शुभकामनाएँ!\",\"subText\":\"नंद के आनंद भयो, जय कन्हैया लाल की\",\"defaultOffer\":\"माखन, मिश्री और व्रत का सामान\"},\"english\":{\"name\":\"Janmashtami\",\"greeting\":\"Happy Janmashtami!\",\"subText\":\"May Lord Krishna bless you\",\"defaultOffer\":\"Makhan, mishri and fasting essentials\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('karwa-chauth','Karwa Chauth',NULL,0,'Karwa Chauth ki Shubhkamnayein','Sada suhagan raho','[\"🌙\",\"🪔\",\"💍\",\"❤️\"]','{\"primary\":\"#ad1457\",\"secondary\":\"#f06292\",\"accent\":\"#ffd54f\"}','calm','Sargi aur pooja ka saaman','{\"hindi\":{\"name\":\"करवा चौथ\",\"greeting\":\"करवा चौथ की शुभकामनाएँ\",\"subText\":\"सदा सुहागन रहो\",\"defaultOffer\":\"सरगी और पूजा का सामान\"},\"english\":{\"name\":\"Karwa Chauth\",\"greeting\":\"Happy Karwa Chauth!\",\"subText\":\"Wishing you a lifetime of togetherness\",\"defaultOffer\":\"Sargi and pooja essentials\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('maha-shivratri','Maha Shivratri',NULL,0,'Har Har Mahadev!','Maha Shivratri ki Shubhkamnayein','[\"🔱\",\"🕉️\",\"🌙\",\"🪔\"]','{\"primary\":\"#283593\",\"secondary\":\"#5c6bc0\",\"accent\":\"#90caf9\"}','calm','Vrat ka saaman — ghar par delivery','{\"hindi\":{\"name\":\"महाशिवरात्रि\",\"greeting\":\"हर हर महादेव!\",\"subText\":\"महाशिवरात्रि की शुभकामनाएँ\",\"defaultOffer\":\"व्रत का सामान — घर पर डिलीवरी\"},\"english\":{\"name\":\"Maha Shivratri\",\"greeting\":\"Har Har Mahadev!\",\"subText\":\"Happy Maha Shivratri\",\"defaultOffer\":\"Fasting essentials — delivered home\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('makar-sankranti','Makar Sankranti','2027-01-14',0,'Makar Sankranti ki Shubhkamnayein','Til-gud khao, meetha meetha bolo','[\"🪁\",\"🌞\",\"🍬\",\"🌾\"]','{\"primary\":\"#ff8f00\",\"secondary\":\"#fbc02d\",\"accent\":\"#0288d1\"}','festive','Til, Gur, Chura-Dahi — sab ek jagah','{\"hindi\":{\"name\":\"मकर संक्रांति\",\"greeting\":\"मकर संक्रांति की शुभकामनाएँ\",\"subText\":\"तिल-गुड़ खाओ, मीठा-मीठा बोलो\",\"defaultOffer\":\"तिल, गुड़, चूड़ा-दही — सब एक जगह\"},\"english\":{\"name\":\"Makar Sankranti\",\"greeting\":\"Happy Makar Sankranti!\",\"subText\":\"Sweet til-gud and warm wishes\",\"defaultOffer\":\"Til, jaggery, chura-dahi — all in one place\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('navratri-durga-puja','Navratri / Durga Puja',NULL,0,'Shubh Navratri!','Maa Durga ka aashirwad sada bana rahe','[\"🪔\",\"🌺\",\"🔱\",\"✨\"]','{\"primary\":\"#b71c1c\",\"secondary\":\"#ff6f00\",\"accent\":\"#ffd54f\"}','festive','Vrat special — fal, sabudana, makhana','{\"hindi\":{\"name\":\"नवरात्रि / दुर्गा पूजा\",\"greeting\":\"शुभ नवरात्रि!\",\"subText\":\"माँ दुर्गा का आशीर्वाद सदा बना रहे\",\"defaultOffer\":\"व्रत स्पेशल — फल, साबूदाना, मखाना\"},\"english\":{\"name\":\"Navratri / Durga Puja\",\"greeting\":\"Happy Navratri!\",\"subText\":\"May Maa Durga always bless you\",\"defaultOffer\":\"Fasting specials — fruits, sabudana, makhana\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('new-year','New Year','2027-01-01',0,'Happy New Year!','Naya saal, nayi khushiyan — 4astore ke saath','[\"🎉\",\"🎆\",\"🥳\",\"✨\"]','{\"primary\":\"#1a1a2e\",\"secondary\":\"#3949ab\",\"accent\":\"#ffc107\"}','upbeat','New Year Special — har order par bachat','{\"hindi\":{\"name\":\"नया साल\",\"greeting\":\"नए साल की शुभकामनाएँ!\",\"subText\":\"नया साल, नई खुशियाँ — 4astore के साथ\",\"defaultOffer\":\"नए साल का स्पेशल — हर ऑर्डर पर बचत\"},\"english\":{\"name\":\"New Year\",\"greeting\":\"Happy New Year!\",\"subText\":\"A new year of joy — with 4astore\",\"defaultOffer\":\"New Year special — savings on every order\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('raksha-bandhan','Raksha Bandhan',NULL,0,'Happy Raksha Bandhan!','Bhai-behen ke pyaar ka tyohar','[\"🪢\",\"🎁\",\"🍬\",\"💝\"]','{\"primary\":\"#d81b60\",\"secondary\":\"#ff80ab\",\"accent\":\"#ffd54f\"}','festive','Mithai aur chocolates par offer','{\"hindi\":{\"name\":\"रक्षा बंधन\",\"greeting\":\"रक्षा बंधन की शुभकामनाएँ!\",\"subText\":\"भाई-बहन के प्यार का त्योहार\",\"defaultOffer\":\"मिठाई और चॉकलेट पर ऑफ़र\"},\"english\":{\"name\":\"Raksha Bandhan\",\"greeting\":\"Happy Raksha Bandhan!\",\"subText\":\"Celebrating the bond of siblings\",\"defaultOffer\":\"Offers on sweets and chocolates\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('ram-navami','Ram Navami',NULL,0,'Jai Shri Ram!','Ram Navami ki Shubhkamnayein','[\"🏹\",\"🚩\",\"🙏\",\"🪔\"]','{\"primary\":\"#ef6c00\",\"secondary\":\"#ffa726\",\"accent\":\"#b71c1c\"}','festive','Pooja saamagri par offer','{\"hindi\":{\"name\":\"राम नवमी\",\"greeting\":\"जय श्री राम!\",\"subText\":\"राम नवमी की शुभकामनाएँ\",\"defaultOffer\":\"पूजा सामग्री पर ऑफ़र\"},\"english\":{\"name\":\"Ram Navami\",\"greeting\":\"Jai Shri Ram!\",\"subText\":\"Happy Ram Navami\",\"defaultOffer\":\"Offers on pooja items\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30'),('republic-day','Republic Day','2027-01-26',0,'Gantantra Diwas ki Shubhkamnayein','Jai Hind! Desh ke liye garv','[\"🇮🇳\",\"🎖️\",\"🕊️\"]','{\"primary\":\"#ff9933\",\"secondary\":\"#138808\",\"accent\":\"#000080\"}','calm','Republic Day Offer','{\"hindi\":{\"name\":\"गणतंत्र दिवस\",\"greeting\":\"गणतंत्र दिवस की शुभकामनाएँ\",\"subText\":\"जय हिंद! देश पर गर्व है\",\"defaultOffer\":\"गणतंत्र दिवस ऑफ़र\"},\"english\":{\"name\":\"Republic Day\",\"greeting\":\"Happy Republic Day!\",\"subText\":\"Jai Hind! Proud of our nation\",\"defaultOffer\":\"Republic Day offer\"}}',1,'2026-09-30 15:59:54','2026-09-30 17:45:30');
/*!40000 ALTER TABLE `festivals` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `orders`
--

DROP TABLE IF EXISTS `orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `orders` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `order_id` varchar(20) NOT NULL,
  `user_id` bigint(20) unsigned DEFAULT NULL,
  `customer` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`customer`)),
  `items` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`items`)),
  `subtotal` decimal(10,2) NOT NULL DEFAULT 0.00,
  `discount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `delivery_charge` decimal(10,2) NOT NULL DEFAULT 0.00,
  `total_amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `payment_method` varchar(30) NOT NULL DEFAULT 'UPI',
  `payment_reference` varchar(12) DEFAULT NULL,
  `order_status` varchar(40) NOT NULL DEFAULT 'Order Placed',
  `order_date` datetime NOT NULL,
  `delivery_address` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`delivery_address`)),
  `rider_id` varchar(40) DEFAULT NULL,
  `rider_name` varchar(120) DEFAULT NULL,
  `rider_mobile` varchar(15) DEFAULT NULL,
  `assigned_at` datetime DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `created_by` varchar(64) DEFAULT NULL,
  `reminder_count` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_orderid` (`order_id`),
  UNIQUE KEY `uq_orders_payref` (`payment_reference`),
  KEY `idx_orders_status` (`order_status`),
  KEY `idx_orders_rider` (`rider_id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orders`
--

LOCK TABLES `orders` WRITE;
/*!40000 ALTER TABLE `orders` DISABLE KEYS */;
INSERT INTO `orders` VALUES (1,'4A6E7781C9',2,'{\"name\":\"Test User\",\"mobile\":\"9876543210\",\"address\":\"Main Rd\",\"city\":\"Chandragarh\",\"landmark\":\"\",\"pincode\":\"824301\",\"deliverySource\":\"manual\"}','[{\"id\":1,\"name\":\"Aashirvaad Atta\",\"weight\":\"5 Kg\",\"price\":200,\"quantity\":2}]',400.00,0.00,10.00,410.00,'UPI','123456789012','Out for Delivery','2026-09-30 08:00:11','{\"label\":\"Other\",\"receiver_name\":\"Test User\",\"phone\":\"9876543210\",\"landmark\":\"\",\"full_address\":\"Main Rd, Chandragarh, 824301\",\"city\":\"Chandragarh\",\"state\":\"Bihar\",\"pincode\":\"824301\",\"latitude\":null,\"longitude\":null,\"captured_at\":\"2026-09-30T08:00:11.846Z\"}','5','Cust2','9811122233','2026-09-30 08:19:19',NULL,NULL,1,'2026-09-30 02:30:11','2026-09-30 02:49:19'),(2,'4ADD8617B0',2,'{\"name\":\"Test User\",\"mobile\":\"9876543210\",\"address\":\"\",\"city\":\"Chandragarh\",\"landmark\":\"\",\"pincode\":\"\",\"deliverySource\":\"current\",\"deliveryLat\":24.582,\"deliveryLng\":84.116}','[{\"id\":1,\"name\":\"Aashirvaad Atta\",\"weight\":\"5 Kg\",\"price\":200,\"quantity\":1}]',200.00,0.00,0.00,210.00,'UPI','222333444555','Rider Assigned','2026-09-30 08:19:45','{\"label\":\"Other\",\"receiver_name\":\"Test User\",\"phone\":\"9876543210\",\"landmark\":\"\",\"full_address\":\"Chandragarh\",\"city\":\"Chandragarh\",\"state\":\"Bihar\",\"pincode\":\"\",\"latitude\":24.582,\"longitude\":84.116,\"captured_at\":\"2026-09-30T08:19:45.983Z\"}','5','Cust2','9811122233','2026-09-30 08:19:46',NULL,NULL,0,'2026-09-30 02:49:45','2026-09-30 02:49:46'),(3,'4A664A1EF2',2,'{\"name\":\"Test User\",\"mobile\":\"9876543210\",\"address\":\"Ward 6\",\"city\":\"Chandragarh (चंद्रगढ़)\",\"landmark\":\"Near school\",\"pincode\":\"824301\",\"deliverySource\":\"manual\",\"deliveryLat\":24.58,\"deliveryLng\":84.114,\"email\":\"t@example.com\"}','[{\"id\":1,\"name\":\"Aashirvaad Atta\",\"weight\":\"5 Kg\",\"price\":200,\"quantity\":1}]',200.00,80.00,10.00,210.00,'UPI','938440782473','Order Placed','2026-09-30 11:16:02','{\"label\":\"Work\",\"receiver_name\":\"Test User\",\"phone\":\"9876543210\",\"house_no\":\"Ward 6\",\"landmark\":\"Near school\",\"full_address\":\"Ward 6, Chandragarh (चंद्रगढ़), 824301\",\"city\":\"Chandragarh (चंद्रगढ़)\",\"state\":\"Bihar\",\"pincode\":\"824301\",\"latitude\":24.58,\"longitude\":84.114,\"captured_at\":\"2026-09-30T11:16:02.514Z\"}',NULL,NULL,NULL,NULL,NULL,NULL,3,'2026-09-30 05:46:02','2026-09-30 06:02:00'),(4,'4AE0A6FC33',1,'{\"name\":\"Store Owner\",\"mobile\":\"7543888698\",\"address\":\"dfggfd\",\"city\":\"Chandragarh (चंद्रगढ़)\",\"landmark\":\"dfggr\",\"pincode\":\"824301\",\"deliverySource\":\"manual\",\"deliveryLat\":24.580164,\"deliveryLng\":84.114194,\"email\":\"\"}','[{\"id\":3,\"name\":\"Fortune Mustard Oil\",\"weight\":\"1 Litre\",\"price\":165,\"quantity\":1}]',165.00,15.00,10.00,175.00,'UPI','157863187629','Order Placed','2026-09-30 11:29:43','{\"label\":\"Home\",\"receiver_name\":\"Store Owner\",\"phone\":\"7543888698\",\"house_no\":\"dfggfd\",\"landmark\":\"dfggr\",\"full_address\":\"dfggfd, Chandragarh (चंद्रगढ़), 824301\",\"city\":\"Chandragarh (चंद्रगढ़)\",\"state\":\"Bihar\",\"pincode\":\"824301\",\"latitude\":24.580164,\"longitude\":84.114194,\"captured_at\":\"2026-09-30T11:29:43.959Z\"}',NULL,NULL,NULL,NULL,NULL,NULL,3,'2026-09-30 05:59:43','2026-09-30 06:48:00'),(8,'4A86D42BFC',12,'{\"name\":\"Akash kumar\",\"mobile\":\"8002116652\",\"address\":\"Bzznz\",\"city\":\"Chandragarh (चंद्रगढ़)\",\"landmark\":\"Hzhzzn\",\"pincode\":\"824301\",\"deliverySource\":\"manual\",\"deliveryLat\":24.580164,\"deliveryLng\":84.114194,\"email\":\"akashjii300@gmail.com\"}','[{\"id\":96,\"name\":\"Aashirvaad Atta\",\"weight\":\"5 Kg\",\"price\":200,\"quantity\":1}]',200.00,80.00,10.00,210.00,'UPI','204932722993','Order Placed','2026-10-01 07:01:05','{\"label\":\"Home\",\"receiver_name\":\"Akash kumar\",\"phone\":\"8002116652\",\"house_no\":\"Bzznz\",\"landmark\":\"Hzhzzn\",\"full_address\":\"Bzznz, Chandragarh (चंद्रगढ़), 824301\",\"city\":\"Chandragarh (चंद्रगढ़)\",\"state\":\"Bihar\",\"pincode\":\"824301\",\"latitude\":24.580164,\"longitude\":84.114194,\"captured_at\":\"2026-10-01T07:01:05.247Z\"}',NULL,NULL,NULL,NULL,NULL,NULL,0,'2026-10-01 01:31:05','2026-10-01 01:31:05');
/*!40000 ALTER TABLE `orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `pages`
--

DROP TABLE IF EXISTS `pages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pages` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `slug` varchar(80) NOT NULL,
  `title` varchar(200) NOT NULL,
  `meta_description` varchar(300) DEFAULT NULL,
  `content` mediumtext NOT NULL,
  `show_in_footer` tinyint(1) NOT NULL DEFAULT 1,
  `published` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pages_slug` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `pages`
--

LOCK TABLES `pages` WRITE;
/*!40000 ALTER TABLE `pages` DISABLE KEYS */;
INSERT INTO `pages` VALUES (1,'privacy-policy','Privacy Policy','Privacy Policy for 4A Store grocery app and website.','<div class=\"legal-card\">\n      <h1>Privacy Policy</h1>\n      <p class=\"updated\">Last updated: 23 September 2026</p>\n\n      <p>4A Store (\"we\", \"us\", \"our\") operates the 4A Store website (4astore.com) and the 4A Store Android app. This Privacy Policy explains what information we collect, how we use it, how long we keep it, and the choices you have. By using our app or website, you agree to this policy.</p>\n\n      <h2>1. Information We Collect</h2>\n      <ul>\n        <li><strong>Account details:</strong> your name and mobile number when you register or place an order.</li>\n        <li><strong>Delivery details:</strong> the delivery address and PIN code you provide for your order.</li>\n        <li><strong>Order details:</strong> the items you order, amounts, and payment method (UPI).</li>\n        <li><strong>Payment proof:</strong> a payment screenshot you upload to confirm a UPI payment.</li>\n        <li><strong>Delivery location:</strong> precise device location when you choose to share it so a rider can find your delivery address.</li>\n        <li><strong>Device/usage data:</strong> basic technical information, app version, server request data, and browser or WebView information needed to run and secure the service.</li>\n      </ul>\n      <p>We do <strong>not</strong> request or store your bank password, UPI PIN, or card number. Payment screenshots may contain transaction details, so please do not upload unrelated personal or financial information.</p>\n\n      <h2>2. How We Use Your Information</h2>\n      <ul>\n        <li>To process and deliver your grocery orders.</li>\n        <li>To contact you about your order (confirmation, delivery, support).</li>\n        <li>To improve our products, service, and delivery.</li>\n        <li>To send offers or announcements (only within the app/website).</li>\n        <li>To authenticate accounts, prevent misuse, and respond to deletion or support requests.</li>\n      </ul>\n\n      <h2>3. Payments</h2>\n      <p>Payments are made directly via UPI to our store account. We receive the payment confirmation or screenshot that you submit, and may retain it with the related order for verification, refunds, accounting, and dispute handling. We do not store card or UPI credentials.</p>\n\n      <h2>4. Data Sharing</h2>\n      <p>We do not sell your personal data. We may share the name, phone number, address, delivery location, order details, and payment status with the delivery person fulfilling your order. We may also share information with hosting, storage, email, or technical service providers that process it for us, and where required by law.</p>\n\n      <h2>5. Data Storage & Security</h2>\n      <p>Your order, account, delivery, and uploaded payment information is stored on our server and used to run the store. Account data is deleted when you delete your account, subject to records that must be retained for accounting, fraud prevention, disputes, refunds, or legal compliance. Payment screenshots and order records are retained only as long as reasonably necessary for those purposes. We use HTTPS in transit and reasonable access controls, but no method of transmission or storage is 100% secure.</p>\n\n      <h2>6. Your Choices</h2>\n      <ul>\n        <li>You can delete your account from the Profile page or use our <a href=\"/page/account-deletion\">account deletion page</a>.</li>\n        <li>You can ask us to update your information or request deletion of eligible personal data.</li>\n        <li>You can stop using the app at any time.</li>\n        <li>For any data request, contact us using the details below.</li>\n      </ul>\n\n      <h2>7. Children</h2>\n      <p>Our service is intended for users aged 18 and above. Some products are age-restricted and require the buyer to confirm they are 18+.</p>\n\n      <h2>8. Changes to This Policy</h2>\n      <p>We may update this policy from time to time. The latest version will always be available at this page.</p>\n\n      <h2>9. Contact Us</h2>\n      <p>\n        4A Store<br>\n        Gajana Road, Chandargarh, Nabinagar,<br>\n        Aurangabad, Bihar – 824301, India<br>\n        📞 <a href=\"tel:8210874123\">8210874123</a><br>\n        🌐 <a href=\"https://4astore.com\">4astore.com</a>\n      </p>\n    </div>',1,1,1,'2026-09-30 15:24:17','2026-09-30 15:32:17'),(2,'terms','Terms & Conditions','Terms and Conditions for 4A Store grocery app and website.','<div class=\"legal-card\">\n      <h1>Terms &amp; Conditions</h1>\n      <p class=\"updated\">Last updated: 19 September 2026</p>\n\n      <p>Welcome to 4A Store. By using our website (4astore.com) or Android app to browse or order groceries, you agree to these Terms &amp; Conditions.</p>\n\n      <h2>1. About Us</h2>\n      <p>4A Store is a local grocery store based in Chandargarh, Nabinagar, Aurangabad, Bihar. We deliver daily-need grocery items within our serviceable area (PIN 824301).</p>\n\n      <h2>2. Orders</h2>\n      <ul>\n        <li>Prices and product availability are shown in the app and may change without notice.</li>\n        <li>An order is confirmed only after we receive your payment confirmation.</li>\n        <li>We may cancel an order if an item is out of stock or the address is outside our delivery area.</li>\n      </ul>\n\n      <h2>3. Pricing &amp; Payment</h2>\n      <ul>\n        <li>Payment is made via UPI to our store account.</li>\n        <li>Delivery charges (if any) are shown at checkout before you pay.</li>\n        <li>Please upload a valid payment screenshot to confirm your order.</li>\n      </ul>\n\n      <h2>4. Delivery</h2>\n      <p>We deliver within our serviceable PIN code. Delivery times are estimates and may vary due to weather, stock, or other conditions.</p>\n\n      <h2>5. Cancellations &amp; Refunds</h2>\n      <ul>\n        <li>To cancel, contact us as soon as possible before dispatch.</li>\n        <li>If you paid for an item we cannot deliver, we will refund that amount via UPI.</li>\n        <li>Perishable items (fruits, vegetables, dairy) can be returned only if damaged or wrong on delivery.</li>\n      </ul>\n\n      <h2>6. Age-Restricted Products</h2>\n      <p>Certain products are for customers aged 18 and above. By ordering such items, you confirm you are 18+.</p>\n\n      <h2>7. Acceptable Use</h2>\n      <p>You agree not to misuse the app, place fake orders, or attempt to disrupt the service.</p>\n\n      <h2>8. Limitation of Liability</h2>\n      <p>We provide the service on a best-effort basis. We are not liable for delays or issues beyond our reasonable control.</p>\n\n      <h2>9. Contact</h2>\n      <p>\n        4A Store<br>\n        Gajana Road, Chandargarh, Nabinagar,<br>\n        Aurangabad, Bihar – 824301, India<br>\n        📞 <a href=\"tel:8210874123\">8210874123</a><br>\n        🌐 <a href=\"https://4astore.com\">4astore.com</a>\n      </p>\n    </div>\n    \n    &nbsp; \n    &nbsp;',1,1,2,'2026-09-30 15:24:17','2026-09-30 15:24:17'),(3,'help-support','Help & Support','Help and Support for 4A Store grocery app and website.','<div class=\"legal-card\">\n      <h1>Help &amp; Support</h1>\n      <p class=\"updated\">We\'re here to help you shop easily.</p>\n      <p>Need help with an order, delivery, or payment? Contact us directly — we usually reply quickly.</p>\n      <div class=\"contact-btns\">\n        <a href=\"tel:8210874123\" style=\"background:#2e7d32;\">📞 Call 8210874123</a>\n        <a href=\"https://wa.me/918210874123\" style=\"background:#25D366;\">🟢 WhatsApp</a>\n        <a href=\"mailto:online4astore@gmail.com\" style=\"background:#1565c0;\">✉️ Email</a>\n      </div>\n    </div>\n\n    <div class=\"legal-card faq\">\n      <h2>Frequently Asked Questions</h2>\n\n      <q>How do I place an order?</q>\n      <p>Browse products, add them to your cart, go to checkout, enter your delivery address, pay via UPI (scan the QR or copy the UPI ID), upload the payment screenshot, and confirm your order.</p>\n\n      <q>Which areas do you deliver to?</q>\n      <p>We currently deliver within PIN code 824301 (Chandargarh, Nabinagar area). More locations coming soon.</p>\n\n      <q>How do I pay?</q>\n      <p>Payment is via UPI. Scan the QR code shown at payment or copy our UPI ID, pay from any UPI app, then upload the payment screenshot to confirm.</p>\n\n      <q>Can I cancel my order?</q>\n      <p>Yes, contact us as soon as possible before the order is dispatched. If you already paid for something we can\'t deliver, we\'ll refund it via UPI.</p>\n\n      <q>What if I receive a damaged or wrong item?</q>\n      <p>Contact us the same day with a photo. We\'ll replace it or refund the amount.</p>\n\n      <q>How do I see my past orders?</q>\n      <p>Open \"Orders\" in the app to view your order history and download invoices.</p>\n    </div>\n\n    <div class=\"legal-card\">\n      <h2>Store Address</h2>\n      <p>\n        4A Store<br>\n        Gajana Road, Chandargarh, Nabinagar,<br>\n        Aurangabad, Bihar – 824301, India<br>\n        📞 <a href=\"tel:8210874123\">8210874123</a><br>\n        🌐 <a href=\"https://4astore.com\">4astore.com</a>\n      </p>\n    </div>\n\n     &nbsp;\n     &nbsp;',1,1,3,'2026-09-30 15:24:17','2026-09-30 15:24:17'),(4,'account-deletion','Delete Account','Request deletion of your 4A Store account and associated personal data.','<div class=\"legal-card\">\r\n      <h1>Delete your 4A Store account</h1>\r\n      <p>You can permanently delete your account from the signed-in Profile page in the 4A Store app or website by selecting <strong>Delete my account</strong>.</p>\r\n\r\n      <h2>Request deletion on the web</h2>\r\n      <p>If you cannot sign in, send a deletion request from the email address or mobile number registered to your account. Include your registered mobile number and username so we can verify the request.</p>\r\n      <p><a class=\"request-link\" href=\"mailto:online4astore@gmail.com?subject=4A%20Store%20account%20deletion%20request\">Email an account deletion request</a></p>\r\n      <p>You can also call <a href=\"tel:8210874123\">8210874123</a>. We will verify ownership and process a valid request within 30 days.</p>\r\n\r\n      <h2>What will be deleted</h2>\r\n      <ul>\r\n        <li>Your 4A Store account, login credentials, name, mobile number, and username.</li>\r\n        <li>Saved profile and checkout information linked to your account.</li>\r\n        <li>Locally stored login and cart information on your device after sign-out.</li>\r\n      </ul>\r\n\r\n      <h2>Information that may be retained</h2>\r\n      <p>Order, payment, refund, and delivery records may be retained when required for accounting, fraud prevention, dispute resolution, or legal compliance. These records are no longer used to provide a personal account after deletion.</p>\r\n\r\n      <p><a href=\"/page/privacy-policy\">Privacy Policy</a> · <a href=\"/page/help-support\">Help &amp; Support</a></p>\r\n    </div>',1,1,4,'2026-09-30 15:24:17','2026-09-30 15:24:17');
/*!40000 ALTER TABLE `pages` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `products`
--

DROP TABLE IF EXISTS `products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `products` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(200) NOT NULL,
  `brand` varchar(120) DEFAULT NULL,
  `category` varchar(120) NOT NULL,
  `weight` varchar(60) DEFAULT NULL,
  `mrp` decimal(10,2) NOT NULL DEFAULT 0.00,
  `price` decimal(10,2) NOT NULL DEFAULT 0.00,
  `discount` int(11) NOT NULL DEFAULT 0,
  `image` varchar(500) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `features` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`features`)),
  `in_stock` tinyint(1) NOT NULL DEFAULT 1,
  `featured` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_products_category` (`category`),
  KEY `idx_products_instock` (`in_stock`)
) ENGINE=InnoDB AUTO_INCREMENT=99 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `products`
--

LOCK TABLES `products` WRITE;
/*!40000 ALTER TABLE `products` DISABLE KEYS */;
INSERT INTO `products` VALUES (1,'Aashirvaad Atta','Aashirvaad','rice-atta-dal','5 Kg',280.00,200.00,29,'https://www.bbassets.com/media/uploads/p/m/40053356_9-ganesh-whole-wheat-chakki-atta.jpg?tr=w-154,q-80','Aashirvaad Superior MP Whole Wheat Atta made from the choicest grains. Soft rotis every time.','[]',1,0,'2026-09-30 07:58:32','2026-09-30 07:04:52'),(3,'Fortune Mustard Oil','Fortune','oil-ghee','1 Litre',180.00,165.00,8,'https://www.bbassets.com/media/uploads/p/m/276756_16-fortune-fortune-premium-kachi-ghani-pure-mustard-oil.jpg?tr=w-154,q-80','Fortune Kachi Ghani Pure Mustard Oil. Rich aroma and authentic taste.','[]',1,0,'2026-09-30 07:58:32','2026-09-30 07:04:52'),(4,'Soya Health Refined Soyabean Oil','Fortune','oil-ghee','1 Litre',160.00,145.00,9,'https://www.bbassets.com/media/uploads/p/m/40361379_2-fortune-sunlite-refined-sunflower-oil.jpg?tr=w-154,q-80','Soya Health Refined Soyabean Oil.Light and healthy cooking oil.','[]',1,0,'2026-09-30 07:58:32','2026-09-30 07:04:52'),(5,'Tata Salt','Tata','daily-essentials','1 Kg',30.00,28.00,7,'https://www.bbassets.com/media/uploads/p/l/241600_11-tata-salt-iodized.jpg','Tata Salt - Desh ka namak. Iodized and vacuum evaporated salt.','[]',1,0,'2026-09-30 07:58:32','2026-09-30 07:04:52'),(6,'Tata Tea Gold','Tata','tea-coffee','500 g',295.00,270.00,8,'https://www.bbassets.com/media/uploads/p/m/40200082_7-tata-tea-gold-tea.jpg?tr=w-154,q-80','Tata Tea Gold - 15% Long Leaves for rich, aromatic taste.','[]',1,0,'2026-09-30 07:58:32','2026-09-30 07:04:52'),(7,'Maggi 2-Minute Noodles','Nestle','biscuits-snacks','Pack of 12',168.00,150.00,11,'https://www.bbassets.com/media/uploads/p/m/266112_30-maggi-2-minute-instant-noodles-masala.jpg?tr=w-154,q-80','Maggi 2-Minute Instant Noodles - Masala flavour. Quick and tasty.','[]',0,0,'2026-09-30 07:58:32','2026-09-30 07:04:52'),(8,'Surf Excel Easy Wash','Surf Excel','home-cleaning','1.5 Kg',199.00,175.00,12,'https://www.bbassets.com/media/uploads/p/l/215595_27-surf-excel-easy-wash-detergent-powder.jpg','Surf Excel Easy Wash Detergent Powder for tough stain removal.','[]',1,0,'2026-09-30 07:58:32','2026-09-30 07:04:52'),(9,'Vim Dishwash Bar','Vim','home-cleaning','600 g',52.00,45.00,13,'https://www.bbassets.com/media/uploads/p/m/100006809_16-vim-dishwash-bar-lemon.jpg?tr=w-154,q-80','Vim Dishwash Bar with power of lemon for sparkling clean dishes.','[]',1,0,'2026-09-30 07:58:32','2026-09-30 07:04:52'),(10,'Dettol Original Soap','Dettol','personal-care','125 g',55.00,48.00,13,'https://www.bbassets.com/media/uploads/p/l/40325774_6-dettol-skincare-soap.jpg','Dettol Original Bathing Soap. Trusted protection from germs.','[]',1,0,'2026-09-30 07:58:32','2026-09-30 07:04:52'),(11,'Banana (Dozen)','Fresh','fruits-vegetables','1 Dozen',60.00,50.00,17,'https://www.bbassets.com/media/uploads/p/m/10000025_32-fresho-banana-robusta.jpg?tr=w-154,q-80','Fresh ripe bananas. Rich in potassium and natural energy.','[]',0,0,'2026-09-30 07:58:32','2026-09-30 07:04:52'),(12,'Apple (Shimla)','Fresh','fruits-vegetables','1 Kg',180.00,160.00,11,'https://www.bbassets.com/media/uploads/p/m/10000005_29-fresho-apple-royal-gala-economy.jpg?tr=w-154,q-80','Fresh Shimla apples. Crunchy, sweet and nutritious.','[]',0,0,'2026-09-30 07:58:32','2026-09-30 07:04:52'),(13,'Mango (Desi)','Fresh','fruits-vegetables','1 Kg',80.00,65.00,19,'https://www.bbassets.com/media/uploads/p/m/30001003_6-fresho-dasheri-mango.jpg?tr=w-154,q-80','Fresh seasonal desi mangoes. Sweet and juicy.','[]',0,0,'2026-09-30 02:48:59','2026-09-30 07:04:52'),(16,'Potato (Aloo)','Fresh','fruits-vegetables','1 Kg',30.00,25.00,17,'https://www.bbassets.com/media/uploads/p/l/40048457_20-fresho-potato-new-crop.jpg','Fresh potatoes. A kitchen essential for everyday cooking.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(17,'Onion (Pyaaz)','Fresh','fruits-vegetables','1 Kg',40.00,35.00,13,'https://www.bbassets.com/media/uploads/p/l/40050957_6-fresho-onion-organically-grown.jpg','Fresh onions. Essential for Indian cooking.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(18,'Tomato (Tamatar)','Fresh','fruits-vegetables','1 Kg',40.00,30.00,25,'https://www.bbassets.com/media/uploads/p/m/40183216_3-fresho-tomato-local.jpg?tr=w-154,q-80','Fresh red tomatoes. Perfect for curries and salads.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(19,'Cauliflower (Gobhi)','Fresh','fruits-vegetables','1kg',100.00,60.00,40,'https://www.bbassets.com/media/uploads/p/l/10000074_22-fresho-cauliflower.jpg','Fresh cauliflower. Great for gobi paratha and sabzi.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(20,'Green Chilli','Fresh','fruits-vegetables','250 g',20.00,15.00,25,'https://www.bbassets.com/media/uploads/p/l/40346927-3_2-fresho-chilli-green-small.jpg','Fresh green chillies. Adds spice to every dish.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(21,'Parle-G Biscuit','Parle','biscuits-snacks','800 g',80.00,72.00,10,'https://www.bigbasket.com/media/uploads/p/l/264201_8-parle-g-original-gluco-biscuits.jpg','Parle-G Original Gluco Biscuits. India\'s most loved biscuit.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(22,'Britannia Good Day','Britannia','biscuits-snacks','600 g',120.00,105.00,13,'https://www.bigbasket.com/media/uploads/p/l/263024_8-britannia-good-day-cashew-cookies.jpg','Britannia Good Day Cashew Cookies. Rich buttery taste.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(23,'Lays Classic Salted','Lays','biscuits-snacks','52 g',20.00,20.00,0,'https://www.bigbasket.com/media/uploads/p/l/241014_9-lays-potato-chips-classic-salted.jpg','Lays Classic Salted Potato Chips. Crispy and light.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(24,'Kurkure Masala Munch','Kurkure','biscuits-snacks','90 g',20.00,20.00,0,'https://www.bigbasket.com/media/uploads/p/l/266176_10-kurkure-namkeen-masala-munch.jpg','Kurkure Masala Munch. Tedha hai par mera hai.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(25,'Haldiram Aloo Bhujia','Haldiram','biscuits-snacks','400 g',120.00,108.00,10,'https://www.bigbasket.com/media/uploads/p/l/268260_8-haldirams-namkeen-aloo-bhujia.jpg','Haldiram\'s Aloo Bhujia. Crispy namkeen for snacking.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(26,'Amul Taaza Milk','Amul','dairy-bakery','500 ml',30.00,28.00,7,'https://www.bigbasket.com/media/uploads/p/l/150050_8-amul-taaza-toned-fresh-milk.jpg','Amul Taaza Toned Fresh Milk. Wholesome nutrition daily.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(27,'Amul Butter','Amul','dairy-bakery','100 g',56.00,52.00,7,'https://www.bigbasket.com/media/uploads/p/l/241566_7-amul-pasteurised-butter.jpg','Amul Pasteurised Butter. Utterly butterly delicious.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(28,'Amul Cheese Slices','Amul','dairy-bakery','200 g',120.00,110.00,8,'https://www.bigbasket.com/media/uploads/p/l/265091_6-amul-cheese-slices.jpg','Amul Cheese Slices. Perfect for sandwiches and burgers.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(29,'Fresh Curd','Local Dairy','dairy-bakery','400 g',35.00,30.00,14,'https://www.bigbasket.com/media/uploads/p/l/40020439_3-milky-mist-classic-curd.jpg','Fresh thick curd made from pure milk. Perfect with meals.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(30,'Nescafe Classic Coffee','Nescafe','tea-coffee','50 g',175.00,155.00,11,'https://www.bigbasket.com/media/uploads/p/l/266010_8-nescafe-classic-instant-coffee.jpg','Nescafe Classic Instant Coffee. Rich aroma and smooth taste.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(31,'Red Label Tea','Brooke Bond','tea-coffee','500 g',260.00,235.00,10,'https://www.bigbasket.com/media/uploads/p/l/241077_11-brooke-bond-red-label-tea.jpg','Brooke Bond Red Label Tea. Togetherness in every cup.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(32,'Coca Cola','Coca Cola','cold-drinks-beverages','750 ml',40.00,38.00,5,'https://www.bigbasket.com/media/uploads/p/l/251006_13-coca-cola-soft-drink.jpg','Coca Cola Original Taste. Open happiness.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(33,'Pepsi','Pepsi','cold-drinks-beverages','750 ml',40.00,38.00,5,'https://www.bigbasket.com/media/uploads/p/l/265627_5-pepsi-soft-drink.jpg','Pepsi - Yeh Dil Maange More. Refreshing cola drink.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(34,'Sprite','Sprite','cold-drinks-beverages','750 ml',40.00,38.00,5,'https://www.bigbasket.com/media/uploads/p/l/251011_9-sprite-soft-drink.jpg','Sprite - Clear hai. Lemon-lime refreshment.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(35,'Frooti Mango Drink','Frooti','cold-drinks-beverages','600 ml',30.00,28.00,7,'https://www.bigbasket.com/media/uploads/p/l/265509_3-frooti-mango-drink.jpg','Frooti Fresh \'n\' Juicy Mango Drink. Mango lovers\' favourite.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(36,'Bisleri Water','Bisleri','cold-drinks-beverages','1 Litre',20.00,20.00,0,'https://www.bigbasket.com/media/uploads/p/l/241023_8-bisleri-mineral-water.jpg','Bisleri Mineral Water. Pure and safe drinking water.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(37,'Colgate Strong Teeth','Colgate','personal-care','200 g',99.00,89.00,10,'https://www.bigbasket.com/media/uploads/p/l/264001_8-colgate-toothpaste-strong-teeth.jpg','Colgate Strong Teeth Toothpaste with calcium boost.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(38,'Head & Shoulders Shampoo','Head & Shoulders','personal-care','180 ml',200.00,180.00,10,'https://www.bigbasket.com/media/uploads/p/l/40022028_4-head-shoulders-anti-dandruff-shampoo.jpg','Head & Shoulders Anti-Dandruff Shampoo. Clean and fresh.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(39,'Dove Soap','Dove','personal-care','100 g',62.00,55.00,11,'https://www.bigbasket.com/media/uploads/p/l/40174082_1-dove-cream-beauty-bathing-bar.jpg','Dove Cream Beauty Bathing Bar. Moisturizing care.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(40,'Harpic Toilet Cleaner','Harpic','home-cleaning','500 ml',109.00,95.00,13,'https://www.bigbasket.com/media/uploads/p/l/266768_7-harpic-disinfectant-toilet-cleaner-liquid.jpg','Harpic Power Plus Toilet Cleaner. 10x better cleaning.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(41,'Lizol Floor Cleaner','Lizol','home-cleaning','500 ml',115.00,99.00,14,'https://www.bigbasket.com/media/uploads/p/l/40094767_4-lizol-disinfectant-surface-floor-cleaner-liquid.jpg','Lizol Disinfectant Surface Cleaner. Kills 99.9% germs.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(42,'Toor Dal','Local','rice-atta-dal','1 Kg',150.00,135.00,10,'https://www.bigbasket.com/media/uploads/p/l/40015094_5-bb-popular-toor-arhar-dal.jpg','Premium quality Toor Dal. Perfect for daily dal preparation.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(43,'Chana Dal','Local','rice-atta-dal','1 Kg',95.00,85.00,11,'https://www.bigbasket.com/media/uploads/p/l/40015096_3-bb-popular-chana-dal.jpg','Fresh Chana Dal. Rich in protein and fibre.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(44,'Sugar','Local','daily-essentials','1 Kg',48.00,42.00,13,'https://www.bigbasket.com/media/uploads/p/l/40015116_3-bb-popular-sugar.jpg','Pure white sugar. Essential for tea and sweets.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(45,'MDH Garam Masala','MDH','daily-essentials','100 g',75.00,68.00,9,'https://www.bigbasket.com/media/uploads/p/l/263366_7-mdh-masala-deggi-mirch.jpg','MDH Deggi Mirch Garam Masala. Authentic spice blend.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(46,'Everest Turmeric Powder','Everest','daily-essentials','200 g',60.00,52.00,13,'https://www.bigbasket.com/media/uploads/p/l/268327_5-everest-powder-turmeric.jpg','Everest Turmeric Powder. Pure and natural haldi.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(47,'Pampers Diapers','Pampers','baby-care','Pack of 30',499.00,449.00,10,'https://www.bigbasket.com/media/uploads/p/l/40089066_4-pampers-all-round-protection-pants.jpg','Pampers All Round Protection Pants. Up to 12 hours dryness.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(48,'Johnson\'s Baby Soap','Johnson\'s','baby-care','100 g',65.00,58.00,11,'https://www.bigbasket.com/media/uploads/p/l/265633_3-johnsons-baby-soap.jpg','Johnson\'s Baby Soap. Gentle and mild for baby skin.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(49,'Classmate Notebook','Classmate','stationery','172 Pages',45.00,40.00,11,'https://www.bigbasket.com/media/uploads/p/l/40073519_4-classmate-notebook-single-line.jpg','Classmate Single Line Notebook. For school and college.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(50,'Cello Pen (Pack of 10)','Cello','stationery','10 Pens',60.00,52.00,13,'https://www.bigbasket.com/media/uploads/p/l/40130254_1-cello-ball-pen-butterflow.jpg','Cello Butterflow Ball Pens. Smooth writing experience.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(51,'Amul Ghee','Amul','oil-ghee','500 ml',310.00,285.00,8,'https://www.bigbasket.com/media/uploads/p/l/241567_6-amul-ghee-pure.jpg','Amul Pure Ghee. Rich aroma and authentic taste for Indian cooking.','[]',1,0,'2026-09-30 07:04:52','2026-09-30 07:04:52'),(52,'Britannia Bread','Britannia','dairy-bakery','400 g',40.00,38.00,5,'https://www.bigbasket.com/media/uploads/p/l/40078498_2-britannia-white-bread.jpg','Britannia White Bread. Soft and fresh for sandwiches and toast.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(53,'Lifebuoy Handwash','Lifebuoy','personal-care','190 ml',75.00,65.00,13,'https://www.bigbasket.com/media/uploads/p/l/40017680_6-lifebuoy-total-10-activ-naturol-germ-protection-handwash.jpg','Lifebuoy Total 10 Handwash. 99.9% germ protection.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(54,'Moong Dal','Local','rice-atta-dal','1 Kg',130.00,115.00,12,'https://www.bigbasket.com/media/uploads/p/l/40015098_2-bb-popular-moong-dal.jpg','Fresh Moong Dal. Easy to digest and nutritious.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(55,'Mustard Seeds (Rai)','Local','daily-essentials','200 g',35.00,30.00,14,'https://www.bigbasket.com/media/uploads/p/l/40015120_2-bb-popular-mustard-seeds-rai-big.jpg','Whole mustard seeds for tempering and pickle making.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(56,'Safed Dal / Chana Dal','Local','rice-atta-dal','1 Kg',130.00,130.00,0,'','Safed / Chana dal. Rich in protein.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(57,'Pila Sarson','Local','daily-essentials','1 Kg',100.00,100.00,0,'','Yellow mustard seeds (pila sarson) for tempering and pickles.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(58,'Ajwain','Local','daily-essentials','1 Kg',250.00,250.00,0,'','Carom seeds (ajwain). Aromatic spice for cooking.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(59,'Makhana','Local','daily-essentials','1 Kg',300.00,300.00,0,'','Fox nuts (makhana). Healthy roasted snack.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(60,'Jeera','Local','daily-essentials','1 Kg',200.00,200.00,0,'','Cumin seeds (jeera). Essential Indian spice.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(61,'Badam','Local','daily-essentials','1 Kg',160.00,160.00,0,'','Almonds (badam). Rich in nutrients.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(62,'Fortune Mustard Oil (Bottle)','Fortune','oil-ghee','1 L',200.00,200.00,0,'','Fortune mustard oil bottle. Rich aroma and authentic taste.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(63,'Fortune Mustard Oil','Fortune','oil-ghee','500 ml',105.00,105.00,0,'','Fortune mustard oil. Rich aroma and authentic taste.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(64,'Refined Oil Pouch','Local','oil-ghee','1 L',160.00,160.00,0,'','Refined cooking oil pouch. Light and healthy.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(65,'Refined Oil Pouch','Local','oil-ghee','500 ml',85.00,85.00,0,'','Refined cooking oil pouch. Light and healthy.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(66,'Jhumer Mustard Oil','Jhumer','oil-ghee','1 L',170.00,170.00,0,'','Jhumer mustard oil. For everyday cooking.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(67,'Best Choice Palm Oil','Best Choice','oil-ghee','1 L',130.00,130.00,0,'','Best Choice palm oil. Economical cooking oil.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(68,'Best Choice Palm Oil','Best Choice','oil-ghee','500 ml',65.00,65.00,0,'','Best Choice palm oil. Economical cooking oil.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(71,'Rahar Dal','Local','rice-atta-dal','1 Kg',140.00,130.00,7,'','Rahar (toor) dal. For daily dal preparation.','[\"Price range ₹130–140\"]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(72,'Aata (Loose)','Local','rice-atta-dal','1 Kg',35.00,34.00,3,'','Loose wheat atta. Soft rotis every time.','[\"Price range ₹34–35 per kg\"]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(73,'Aata','Local','rice-atta-dal','10 Kg',360.00,360.00,0,'','Wheat atta 10 kg pack. Soft rotis every time.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(74,'Aata','Local','rice-atta-dal','5 Kg',190.00,190.00,0,'','Wheat atta 5 kg pack. Soft rotis every time.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(75,'Aata','Local','rice-atta-dal','30 Kg',1000.00,1000.00,0,'','Wheat atta 30 kg bag. Bulk pack.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(76,'Maida','Local','rice-atta-dal','1 Kg',35.00,35.00,0,'','Refined flour (maida). For baking and snacks.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(77,'Chini (Sugar)','Local','daily-essentials','1 Kg',65.00,60.00,8,'','White sugar. Essential for tea and sweets.','[\"Price range ₹60–65\"]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(78,'Pankshi Oil','Pankshi','oil-ghee','1 L',100.00,100.00,0,'','Pankshi cooking oil.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(79,'Sarso Tel (Mustard Oil)','Local','oil-ghee','1 L',195.00,190.00,3,'','Mustard oil (sarso tel). Rich aroma for Indian cooking.','[\"Price range ₹190–195\"]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(80,'Wheel Detergent','Wheel','home-cleaning','1 Kg',85.00,80.00,6,'','Wheel detergent powder for bright, clean clothes.','[\"Price range ₹80–85\"]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(81,'Wheel Detergent','Wheel','home-cleaning','500 g',43.00,40.00,7,'','Wheel detergent powder for bright, clean clothes.','[\"Price range ₹40–43\"]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(82,'Surf Excel','Surf Excel','home-cleaning','70 g',10.00,10.00,0,'','Surf Excel detergent for tough stain removal.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(83,'Vim Bar','Vim','home-cleaning','1 pack',100.00,95.00,5,'','Vim dishwash bar. Sparkling clean dishes.','[\"Approx ₹95–100 for 26 pcs\"]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(84,'Lux Soap (Bar)','Lux','personal-care','104 g',110.00,110.00,0,'','Lux beauty bathing bar. Approx ₹25 per piece.','[\"₹25 per piece\"]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(85,'Lifebuoy Soap (Bar)','Lifebuoy','personal-care','115 g',110.00,110.00,0,'','Lifebuoy bathing bar. Germ protection.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(87,'Patanjali Coffee','Patanjali','tea-coffee','200 g',175.00,175.00,0,'','Patanjali instant coffee.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(88,'Patanjali Coffee','Patanjali','tea-coffee','500 g',380.00,380.00,0,'','Patanjali instant coffee, large pack.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(89,'Laung (Cloves)','Local','daily-essentials','1 Kg',1200.00,1200.00,0,'','Whole cloves (laung). Aromatic spice.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(90,'Kishmish (Raisins)','Local','daily-essentials','1 Kg',400.00,400.00,0,'','Raisins (kishmish). Sweet dried grapes.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(91,'Gola Nariyal (Dry Coconut)','Local','daily-essentials','1 Kg',450.00,450.00,0,'','Dry coconut (sukha nariyal / gola).','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(92,'Haldi (Turmeric)','Local','daily-essentials','1 Kg',250.00,220.00,12,'','Turmeric powder (haldi). Pure and natural.','[\"Price range ₹220–250\"]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(93,'Kat Masala','Local','daily-essentials','1 pc',80.00,80.00,0,'','Kat mithi / kat masala spice blend.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(94,'Golki (Black Pepper)','Local','daily-essentials','1 Kg',800.00,800.00,0,'','Whole black pepper (golki). Aromatic spice.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(95,'Surf Excel Easy Wash','Surf Excel','home-cleaning','200g',28.00,25.00,11,'https://www.bbassets.com/media/uploads/p/l/215595_27-surf-excel-easy-wash-detergent-powder.jpg','Surf Excel Easy Wash Detergent Powder for tough stain removal.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52'),(96,'Aashirvaad Atta','Aashirvaad','rice-atta-dal','5 Kg',280.00,200.00,29,'https://www.bbassets.com/media/uploads/p/m/40053356_9-ganesh-whole-wheat-chakki-atta.jpg?tr=w-154,q-80','Aashirvaad Superior MP Whole Wheat Atta made from the choicest grains. Soft rotis every time.','[]',1,0,'2026-09-30 07:03:07','2026-09-30 07:04:52');
/*!40000 ALTER TABLE `products` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `refresh_tokens`
--

DROP TABLE IF EXISTS `refresh_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `refresh_tokens` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned NOT NULL,
  `token_hash` char(64) NOT NULL,
  `device_label` varchar(120) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `revoked` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refresh_hash` (`token_hash`),
  KEY `idx_refresh_user` (`user_id`),
  CONSTRAINT `fk_refresh_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=48 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `refresh_tokens`
--

LOCK TABLES `refresh_tokens` WRITE;
/*!40000 ALTER TABLE `refresh_tokens` DISABLE KEYS */;
INSERT INTO `refresh_tokens` VALUES (1,2,'f199c412626e4dd5322467e5df286a6e508cb6e52c53d49b00a2f975234877c9',NULL,'2027-09-30 07:59:52',0,'2026-09-30 02:29:52'),(2,2,'0a3fcfa80281f067f75c97942cb4cac4544e934420dd977a4ea0a87e8b530f55',NULL,'2027-09-30 07:59:53',0,'2026-09-30 02:29:53'),(3,2,'80c1b5f0a5e48681ad83d8cd28739ac16540ed09bc0f621f749eaadc9c72b180',NULL,'2027-09-30 08:00:11',0,'2026-09-30 02:30:11'),(4,1,'bf345b6650a49349f8c8db9f32490f7030b42ba079ee1d639d4aa5c24833778f',NULL,'2027-09-30 08:18:58',0,'2026-09-30 02:48:58'),(5,5,'80af2cb13632de849d07ed25bc35fa2e89f309f0a88adec55fb13328c0a86eb8',NULL,'2027-09-30 08:19:00',0,'2026-09-30 02:49:00'),(6,1,'c40ba83c0a7ecc21fd776862d0b898a71db75bd15e6f5539e8146761d3d09871',NULL,'2027-09-30 08:19:18',0,'2026-09-30 02:49:18'),(7,5,'3c9e1a2f124d61812df54bf274294cca9757ecf1b6f0729be9d6ff14a5fb7dc3',NULL,'2027-09-30 08:19:19',0,'2026-09-30 02:49:19'),(8,2,'446895b445ff14c8c3583244f3a1bda5564d68b9448a93fa753a18b11f6b519e',NULL,'2027-09-30 08:19:45',0,'2026-09-30 02:49:45'),(9,1,'b05db9ede181426eff131fedc15985d310b288bac3cdcf0f905af1075a53419f',NULL,'2027-09-30 08:19:46',0,'2026-09-30 02:49:46'),(10,5,'cb98789fc0d858701eb16cf1b9e5336740d0ebd06f714cb843b8a0459d7b69df',NULL,'2027-09-30 08:19:46',0,'2026-09-30 02:49:46'),(11,1,'09152ab5026055dbf8b93203b16b7b25f9a126ea4a7569dd0c6a75cbbc0f9edd',NULL,'2027-09-30 08:19:58',0,'2026-09-30 02:49:58'),(12,1,'abb06026a03fdacdb979d6513994c9e0910b6d5e6e9845f6b888e881a6e478a8',NULL,'2027-09-30 08:58:41',0,'2026-09-30 03:28:41'),(13,1,'a930b2ce6d8d30168aaa79c20e3d7e7c69e9badb927f6af7a27b90834c6791b0',NULL,'2027-09-30 08:59:10',0,'2026-09-30 03:29:10'),(14,1,'0ca84f3680024315ff9217c7889669af25142763ad023b11caa64d8032e54e9e',NULL,'2027-09-30 10:12:39',0,'2026-09-30 04:42:39'),(15,1,'f71268b7484ce846299485b3f7140fd50baf5dde9e8ebd8d047486922e0185d4',NULL,'2027-09-30 10:18:14',1,'2026-09-30 04:48:14'),(16,1,'704b4bddda966386b1becd0766ed1ef63d712831d3f7f4e29e741a6117236f67',NULL,'2027-09-30 10:52:19',1,'2026-09-30 05:22:19'),(17,2,'73088aa2c182567d43472becb2f17edb6d07a84b789423a726e777bb06d5fb1b',NULL,'2027-09-30 11:16:02',0,'2026-09-30 05:46:02'),(18,5,'38ea92b3262e93b34891499664d91c5dba0ba2f65fb157e9ece76ffafe4df698',NULL,'2027-09-30 11:16:02',0,'2026-09-30 05:46:02'),(19,2,'2713eeb106580f8c5e37a4084f0a770b3fde7f40d722f2377e1e761c3a6cba98',NULL,'2027-09-30 11:31:42',0,'2026-09-30 06:01:42'),(20,2,'309092cdc0c430e4ee50ca9533b3959bffe0d5af8b25f8dd06708c2c7aafa618',NULL,'2027-09-30 11:31:59',0,'2026-09-30 06:01:59'),(21,2,'43a3405d3ceb37aa77bf54fe399ae71fa05eae999690ad3a161a96684273c212',NULL,'2027-09-30 12:38:17',0,'2026-09-30 07:08:17'),(22,5,'21faec7983892fc32713162a2842a96dfec2dae51f08c83968cdacf6449ded3f',NULL,'2027-09-30 12:38:17',0,'2026-09-30 07:08:17'),(23,1,'c8263d6498b5b21bcdad8341d615d832a6573e9098a6f8311ddfa740b3d242cd',NULL,'2027-09-30 12:52:52',0,'2026-09-30 07:22:52'),(24,2,'13168a96b0f067a000004a3aab7830cd2603ed51a27ba5b4805ec61d7982ad0d',NULL,'2027-09-30 13:11:22',0,'2026-09-30 07:41:22'),(25,5,'6b1bf7b10b8e52692aa6ee5d57373759d196e6c592d2ecee5d966442875c9477',NULL,'2027-09-30 13:11:23',0,'2026-09-30 07:41:23'),(26,1,'bc13986fddf6fdef573d55839205eb5b66b55bdb50adea83016904e3019fdefb',NULL,'2027-09-30 13:11:23',0,'2026-09-30 07:41:23'),(27,1,'84fb7be3e3bbc7f8b8ce1798bb7d3b62d5dc16762887b2c11a741e6de29a85b8',NULL,'2027-09-30 13:27:37',0,'2026-09-30 07:57:37'),(28,1,'83cb2a657e8256d89ed62dd4f44fb77fe3f5983162e4aa3e472f5ffeb73ffa3b',NULL,'2027-09-30 13:28:10',0,'2026-09-30 07:58:10'),(29,1,'f2d0957a1ef0328ec35f3b836f31bb8c5e36f895eb56c6d3369a95d3bc93d00d',NULL,'2027-09-30 13:57:59',0,'2026-09-30 08:27:59'),(30,2,'ff9a94455eee99596def1997154a470b77dd252e700dd2a35578335e45b2f14c',NULL,'2027-09-30 13:57:59',0,'2026-09-30 08:27:59'),(31,1,'a121ca5b8c1673fd73b4a3cd1e6deedbeff51cfa3bd68c85d31ff1e50de32d78',NULL,'2027-09-30 13:58:24',0,'2026-09-30 08:28:24'),(32,2,'f1c7ca5c51e83755b5b5d458a253d93ecf7860427f0aa520ebd658af8e7d5527',NULL,'2027-09-30 13:58:25',0,'2026-09-30 08:28:25'),(34,1,'bad233e87dfc15b72c7f23793bd66b33b3fd7e905df612e418e8c440a8ba93ac',NULL,'2027-09-30 15:36:56',0,'2026-09-30 10:06:56'),(35,2,'c9f41c3035bd244f56c0a526326751f3ef15763e96189073baaf6719cefe6e75',NULL,'2027-09-30 15:36:57',0,'2026-09-30 10:06:57'),(36,1,'f6289f0c7de1bde0bfc64fb3fc3f7e3e624ed90cd75bf30e25c4ce1e2857d886',NULL,'2027-09-30 15:45:22',0,'2026-09-30 10:15:22'),(37,2,'1aaaea78f5e05cb2a3fea86d09d86f3f923070b61165234bc04b11143dda8138',NULL,'2027-09-30 15:45:23',0,'2026-09-30 10:15:23'),(38,1,'8efb3f9711803214624f98a41a7593bda8fa675d191af97d16a30fb85d90f3de',NULL,'2027-09-30 16:28:32',0,'2026-09-30 10:58:32'),(39,2,'d8a65b494df9785b75453cf2ec03efe445dd7a16a580a42cde02a1a18c299ed4',NULL,'2027-09-30 16:28:33',0,'2026-09-30 10:58:33'),(40,1,'50239156e2805385ef04295944c539bee40cfe7e1ceec031bf3a1f4efb50d422',NULL,'2027-09-30 16:33:35',0,'2026-09-30 11:03:35'),(41,1,'4635536081473db91e62a69fe1aab5f567073aa089c70c1c92d1c59c2d29b1a6',NULL,'2027-09-30 16:46:18',0,'2026-09-30 11:16:18'),(42,1,'b0b374ee72d2bd0bfc54d5ecad8441a9427c76f5b3260805d4334794836ad2c5',NULL,'2027-09-30 16:46:57',0,'2026-09-30 11:16:57'),(43,1,'9934a1ba436ec960a57f8e69f95b43df3f2b831fd54e1289618b3a0114e22087',NULL,'2027-09-30 16:47:09',0,'2026-09-30 11:17:09'),(44,1,'7d784025c209bdd134ffa5e825215aa510ee89877cdb488b2bb7289a959a7d19',NULL,'2027-09-30 16:47:33',0,'2026-09-30 11:17:33'),(45,1,'12e74436d03619d2d7755eeb91b7fd426cf3faff5fc5adf8ebcb4867d43291ed',NULL,'2027-09-30 17:08:39',0,'2026-09-30 11:38:39'),(46,1,'3395009393bcff0318e8878a655d30e516defb3f018adc0cc741facfda31e90c',NULL,'2027-09-30 17:11:31',0,'2026-09-30 11:41:31'),(47,12,'9f011b02e6a33404441c1f51f0d10ddc30577196abff28a0a3953def9c6983c0','mobile-app','2027-10-01 06:58:54',0,'2026-10-01 01:28:54');
/*!40000 ALTER TABLE `refresh_tokens` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `settings`
--

DROP TABLE IF EXISTS `settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `settings` (
  `id` tinyint(3) unsigned NOT NULL DEFAULT 1,
  `store_email` varchar(190) DEFAULT NULL,
  `delivery_charge` int(11) NOT NULL DEFAULT 10,
  `free_delivery_above` int(11) NOT NULL DEFAULT 500,
  `upi_id` varchar(120) DEFAULT NULL,
  `upi_name` varchar(120) DEFAULT NULL,
  `hide_mrp` tinyint(1) NOT NULL DEFAULT 0,
  `store_phone` varchar(15) DEFAULT NULL,
  `store_address` varchar(500) DEFAULT NULL,
  `store_latitude` double DEFAULT NULL,
  `store_longitude` double DEFAULT NULL,
  `serviceable_villages` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `settings`
--

LOCK TABLES `settings` WRITE;
/*!40000 ALTER TABLE `settings` DISABLE KEYS */;
INSERT INTO `settings` VALUES (1,'online4astore@gmail.com',10,500,'Q623952089@ybl','4A Store',0,'7543888698','Gajna Road, Chandargarh, Nabinagar, Aurangabad, Bihar - 824301',24.580164,84.114194,'Chandragarh (चंद्रगढ़), Misra Bigha (मिश्र बिगहा), Singhpur (सिंहपुर), Mahdua (महदुआ), Mahsu (महसू), Ratanwan (रतनवां), Patna (पटना), Bardiha (बरदिहा), Maigara (मैगरा), Kharaundha (खरौंधा), Mansara (मनसारा), Mauapur (मौआपूर), Shiwa Sagar (शिवसागर), Belaspur (बेलासपुर), Lakhanpur (लखनपुर), Kajhpa (कझपा), Darmi Khurd (डर्मी खुर्द),Shankarpur (शंकरपुर)');
/*!40000 ALTER TABLE `settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tracking`
--

DROP TABLE IF EXISTS `tracking`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tracking` (
  `order_id` varchar(20) NOT NULL,
  `status` varchar(40) DEFAULT NULL,
  `rider_name` varchar(120) DEFAULT NULL,
  `rider_mobile` varchar(15) DEFAULT NULL,
  `lat` double DEFAULT NULL,
  `lng` double DEFAULT NULL,
  `heading` double DEFAULT NULL,
  `speed` double DEFAULT NULL,
  `accuracy` double DEFAULT NULL,
  `source` varchar(20) DEFAULT NULL,
  `dest_lat` double DEFAULT NULL,
  `dest_lng` double DEFAULT NULL,
  `assigned_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`order_id`),
  CONSTRAINT `fk_tracking_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tracking`
--

LOCK TABLES `tracking` WRITE;
/*!40000 ALTER TABLE `tracking` DISABLE KEYS */;
INSERT INTO `tracking` VALUES ('4A6E7781C9','Out for Delivery','Cust2','9811122233',24.585,84.118,NULL,8,12,'device_gps',NULL,NULL,'2026-09-30 13:49:19','2026-09-30 13:49:19'),('4ADD8617B0','Out for Delivery','Cust2','9811122233',24.59,84.12,NULL,NULL,10,'device_gps',24.582,84.116,'2026-09-30 13:49:46','2026-09-30 13:49:46');
/*!40000 ALTER TABLE `tracking` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `users` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(120) NOT NULL,
  `mobile` varchar(15) NOT NULL,
  `username` varchar(64) NOT NULL,
  `email` varchar(190) DEFAULT NULL,
  `recovery_email` varchar(190) DEFAULT NULL,
  `recovery_email_verified` tinyint(1) NOT NULL DEFAULT 0,
  `password` varchar(255) NOT NULL,
  `role` enum('owner','superadmin','admin','rider','customer') NOT NULL DEFAULT 'customer',
  `permissions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`permissions`)),
  `backend_rider` tinyint(1) NOT NULL DEFAULT 0,
  `custom_delivery` int(11) DEFAULT NULL,
  `registered_at` datetime DEFAULT NULL,
  `last_login` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_mobile` (`mobile`),
  UNIQUE KEY `uq_users_username` (`username`),
  KEY `idx_users_role` (`role`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'Store Owner','7543888698','owner',NULL,NULL,0,'$2a$10$ceTrEST8v29JIwpp5ZRs8eiulQaeXYrCKaJW5ZPf39K7IXMMWisH2','owner','[\"*\"]',0,NULL,'2026-09-30 13:28:32','2026-09-30 17:11:31','2026-09-30 07:58:32','2026-09-30 11:41:31'),(2,'Test User','9876543210','testuser',NULL,'recover33939@example.com',1,'$2a$10$xYmB14LfVrF5x8gFlI1VoOtEFaq1QWrz/IKT366kK0jizt15mtlxu','admin','[\"orders\",\"products\"]',0,NULL,'2026-09-30 07:59:52','2026-09-30 16:28:33','2026-09-30 02:29:52','2026-09-30 10:58:33'),(5,'Cust2','9811122233','cust2',NULL,'c2@example.com',1,'$2a$10$CZmlInBA9AOwvMMYHnFmEuRhasaetwIX37YHIVmjiXdyYx8dWS4dG','rider','[]',1,NULL,'2026-09-30 08:19:00','2026-09-30 13:11:23','2026-09-30 02:49:00','2026-09-30 07:41:23'),(12,'Akash kumar','8002116652','aka',NULL,'akashjii300@gmail.com',1,'$2a$10$gNqWR88uIcmH9lVn/o7hIufgfIfXhqv73FWIOI2H2Dkx1dex91R/.','customer',NULL,0,NULL,'2026-10-01 06:58:53','2026-10-01 06:58:53','2026-10-01 01:28:53','2026-10-01 01:28:53');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `video_jobs`
--

DROP TABLE IF EXISTS `video_jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `video_jobs` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `status` varchar(12) NOT NULL DEFAULT 'queued',
  `progress` tinyint(3) unsigned NOT NULL DEFAULT 0,
  `source` varchar(10) NOT NULL DEFAULT 'manual',
  `title` varchar(160) NOT NULL DEFAULT '',
  `template` varchar(12) NOT NULL,
  `format` varchar(8) NOT NULL,
  `lang` varchar(10) NOT NULL DEFAULT 'hinglish',
  `duration_sec` tinyint(3) unsigned NOT NULL,
  `options` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`options`)),
  `file_name` varchar(80) DEFAULT NULL,
  `size_bytes` int(10) unsigned DEFAULT NULL,
  `caption` text DEFAULT NULL,
  `error` varchar(500) DEFAULT NULL,
  `created_by` varchar(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `started_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_video_jobs_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `video_jobs`
--

LOCK TABLES `video_jobs` WRITE;
/*!40000 ALTER TABLE `video_jobs` DISABLE KEYS */;
INSERT INTO `video_jobs` VALUES (1,'done',100,'manual','Diwali Video','festival','reel','hinglish',24,'{\"template\":\"festival\",\"title\":\"Diwali Video\",\"festivalName\":\"Diwali\",\"greeting\":\"Happy Diwali!\",\"subText\":\"Deepawali ki hardik Shubhkamnayein\",\"offerText\":\"Diwali Dhamaka — mithai, dry fruits, pooja saamagri\",\"couponCode\":\"DIWALI50\",\"featuredProducts\":[{\"id\":1,\"name\":\"Aashirvaad Atta\",\"weight\":\"5 Kg\",\"price\":200,\"mrp\":280,\"image\":\"https://www.bbassets.com/media/uploads/p/m/40053356_9-ganesh-whole-wheat-chakki-atta.jpg?tr=w-154,q-80\",\"emoji\":\"🌾\"},{\"id\":3,\"name\":\"Fortune Mustard Oil\",\"weight\":\"1 Litre\",\"price\":165,\"mrp\":180,\"image\":\"https://www.bbassets.com/media/uploads/p/m/276756_16-fortune-fortune-premium-kachi-ghani-pure-mustard-oil.jpg?tr=w-154,q-80\",\"emoji\":\"🫒\"},{\"id\":4,\"name\":\"Soya Health Refined Soyabean Oil\",\"weight\":\"1 Litre\",\"price\":145,\"mrp\":160,\"image\":\"https://www.bbassets.com/media/uploads/p/m/40361379_2-fortune-sunlite-refined-sunflower-oil.jpg?tr=w-154,q-80\",\"emoji\":\"🫒\"},{\"id\":5,\"name\":\"Tata Salt\",\"weight\":\"1 Kg\",\"price\":28,\"mrp\":30,\"image\":\"https://www.bbassets.com/media/uploads/p/l/241600_11-tata-salt-iodized.jpg\",\"emoji\":\"🛒\"}],\"colors\":{\"primary\":\"#1a1a2e\",\"secondary\":\"#b8860b\",\"accent\":\"#ffd700\"},\"emojis\":[\"🪔\",\"✨\",\"🎆\",\"🪙\"],\"durationSec\":24,\"format\":\"reel\",\"musicStyle\":\"festive\",\"store\":{\"name\":\"4astore\",\"tagline\":\"Aapka Apna Grocery Store\",\"phone\":\"82108 74123\",\"whatsapp\":\"82108 74123\",\"address\":\"Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\",\"area\":\"Nabinagar, Aurangabad (Bihar)\",\"deliveryCharge\":30,\"freeAbove\":500,\"payment\":\"UPI (GPay/PhonePe/Paytm)\",\"theme\":{\"primary\":\"#ff6600\",\"dark\":\"#e55b00\",\"light\":\"#fff3e0\",\"accent\":\"#d32f2f\",\"ink\":\"#1a1a2e\"}}}','v1_d2665a95dfe8',6048002,'🪔✨🎆 Happy Diwali! 🪔✨🎆\n4astore parivaar ki taraf se aapko aur aapke parivaar ko Diwali ki dher saari shubhkamnayein! 🙏\nDeepawali ki hardik Shubhkamnayein\n\n🎁 Diwali Dhamaka — mithai, dry fruits, pooja saamagri\n🏷️ Coupon code: DIWALI50\n\n🚚 FREE delivery ₹500 se upar • baaki sirf ₹30\n💳 Payment: UPI (GPay/PhonePe/Paytm)\n📞 Call / 💬 WhatsApp: 82108 74123\n📍 Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\n📲 4astore app download karein aur aaj hi order karein!\n\n#4astore #Nabinagar #Aurangabad #Bihar #GroceryDelivery #OnlineGrocery #HomeDelivery #Diwali #HappyDiwali #DiwaliOffer #FestivalOffer',NULL,'owner','2026-09-30 16:33:37','2026-09-30 22:03:38','2026-09-30 22:07:57'),(2,'done',100,'manual','Diwali Video','festival','square','hinglish',24,'{\"template\":\"festival\",\"title\":\"Diwali Video\",\"festivalName\":\"Diwali\",\"greeting\":\"Happy Diwali!\",\"subText\":\"Deepawali ki hardik Shubhkamnayein\",\"offerText\":\"Diwali Dhamaka — mithai, dry fruits, pooja saamagri\",\"couponCode\":\"DIWALI50\",\"featuredProducts\":[{\"id\":1,\"name\":\"Aashirvaad Atta\",\"weight\":\"5 Kg\",\"price\":200,\"mrp\":280,\"image\":\"https://www.bbassets.com/media/uploads/p/m/40053356_9-ganesh-whole-wheat-chakki-atta.jpg?tr=w-154,q-80\",\"emoji\":\"🌾\"},{\"id\":3,\"name\":\"Fortune Mustard Oil\",\"weight\":\"1 Litre\",\"price\":165,\"mrp\":180,\"image\":\"https://www.bbassets.com/media/uploads/p/m/276756_16-fortune-fortune-premium-kachi-ghani-pure-mustard-oil.jpg?tr=w-154,q-80\",\"emoji\":\"🫒\"},{\"id\":4,\"name\":\"Soya Health Refined Soyabean Oil\",\"weight\":\"1 Litre\",\"price\":145,\"mrp\":160,\"image\":\"https://www.bbassets.com/media/uploads/p/m/40361379_2-fortune-sunlite-refined-sunflower-oil.jpg?tr=w-154,q-80\",\"emoji\":\"🫒\"},{\"id\":5,\"name\":\"Tata Salt\",\"weight\":\"1 Kg\",\"price\":28,\"mrp\":30,\"image\":\"https://www.bbassets.com/media/uploads/p/l/241600_11-tata-salt-iodized.jpg\",\"emoji\":\"🛒\"}],\"colors\":{\"primary\":\"#1a1a2e\",\"secondary\":\"#b8860b\",\"accent\":\"#ffd700\"},\"emojis\":[\"🪔\",\"✨\",\"🎆\",\"🪙\"],\"durationSec\":24,\"format\":\"square\",\"musicStyle\":\"festive\",\"store\":{\"name\":\"4astore\",\"tagline\":\"Aapka Apna Grocery Store\",\"phone\":\"82108 74123\",\"whatsapp\":\"82108 74123\",\"address\":\"Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\",\"area\":\"Nabinagar, Aurangabad (Bihar)\",\"deliveryCharge\":30,\"freeAbove\":500,\"payment\":\"UPI (GPay/PhonePe/Paytm)\",\"theme\":{\"primary\":\"#ff6600\",\"dark\":\"#e55b00\",\"light\":\"#fff3e0\",\"accent\":\"#d32f2f\",\"ink\":\"#1a1a2e\"}}}','v2_891b4227bcc1',3687385,'🪔✨🎆 Happy Diwali! 🪔✨🎆\n4astore parivaar ki taraf se aapko aur aapke parivaar ko Diwali ki dher saari shubhkamnayein! 🙏\nDeepawali ki hardik Shubhkamnayein\n\n🎁 Diwali Dhamaka — mithai, dry fruits, pooja saamagri\n🏷️ Coupon code: DIWALI50\n\n🚚 FREE delivery ₹500 se upar • baaki sirf ₹30\n💳 Payment: UPI (GPay/PhonePe/Paytm)\n📞 Call / 💬 WhatsApp: 82108 74123\n📍 Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\n📲 4astore app download karein aur aaj hi order karein!\n\n#4astore #Nabinagar #Aurangabad #Bihar #GroceryDelivery #OnlineGrocery #HomeDelivery #Diwali #HappyDiwali #DiwaliOffer #FestivalOffer',NULL,'owner','2026-09-30 16:33:37','2026-09-30 22:07:57','2026-09-30 22:10:17'),(3,'done',100,'manual','Aaj ka Special','daily','reel','hinglish',24,'{\"template\":\"daily\",\"title\":\"Aaj ka Special\",\"festivalName\":\"\",\"greeting\":\"Aaj ka Special\",\"subText\":\"\",\"offerText\":\"Aaj Rs 999+ ke order par 5% extra chhoot\",\"couponCode\":\"\",\"featuredProducts\":[{\"id\":9,\"name\":\"Vim Dishwash Bar\",\"weight\":\"600 g\",\"price\":45,\"mrp\":52,\"image\":\"https://www.bbassets.com/media/uploads/p/m/100006809_16-vim-dishwash-bar-lemon.jpg?tr=w-154,q-80\",\"emoji\":\"🧹\"},{\"id\":1,\"name\":\"Aashirvaad Atta\",\"weight\":\"5 Kg\",\"price\":200,\"mrp\":280,\"image\":\"https://www.bbassets.com/media/uploads/p/m/40053356_9-ganesh-whole-wheat-chakki-atta.jpg?tr=w-154,q-80\",\"emoji\":\"🌾\"},{\"id\":55,\"name\":\"Mustard Seeds (Rai)\",\"weight\":\"200 g\",\"price\":30,\"mrp\":35,\"image\":\"https://www.bigbasket.com/media/uploads/p/l/40015120_2-bb-popular-mustard-seeds-rai-big.jpg\",\"emoji\":\"🛒\"},{\"id\":10,\"name\":\"Dettol Original Soap\",\"weight\":\"125 g\",\"price\":48,\"mrp\":55,\"image\":\"https://www.bbassets.com/media/uploads/p/l/40325774_6-dettol-skincare-soap.jpg\",\"emoji\":\"🧴\"}],\"colors\":{\"primary\":\"#ff6600\",\"secondary\":\"#ff9800\",\"accent\":\"#d32f2f\"},\"emojis\":[],\"durationSec\":24,\"format\":\"reel\",\"musicStyle\":\"upbeat\",\"store\":{\"name\":\"4astore\",\"tagline\":\"Aapka Apna Grocery Store\",\"phone\":\"82108 74123\",\"whatsapp\":\"82108 74123\",\"address\":\"Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\",\"area\":\"Nabinagar, Aurangabad (Bihar)\",\"deliveryCharge\":30,\"freeAbove\":500,\"payment\":\"UPI (GPay/PhonePe/Paytm)\",\"theme\":{\"primary\":\"#ff6600\",\"dark\":\"#e55b00\",\"light\":\"#fff3e0\",\"accent\":\"#d32f2f\",\"ink\":\"#1a1a2e\"}}}','v3_efae9f89b4d1',4627460,'🔥 Aaj ka Special — 4astore par!\n\n✅ Vim Dishwash Bar 600 g — sirf ₹45 (MRP ₹52)\n✅ Aashirvaad Atta 5 Kg — sirf ₹200 (MRP ₹280)\n✅ Mustard Seeds (Rai) 200 g — sirf ₹30 (MRP ₹35)\n✅ Dettol Original Soap 125 g — sirf ₹48 (MRP ₹55)\n\n🎁 Aaj Rs 999+ ke order par 5% extra chhoot\n\n🚚 FREE delivery ₹500 se upar • baaki sirf ₹30\n💳 Payment: UPI (GPay/PhonePe/Paytm)\n📞 Call / 💬 WhatsApp: 82108 74123\n📍 Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\n📲 4astore app download karein aur aaj hi order karein!\n\n#4astore #Nabinagar #Aurangabad #Bihar #GroceryDelivery #OnlineGrocery #HomeDelivery #AajKaSpecial #DealOfTheDay #GroceryOffers',NULL,'owner','2026-09-30 16:33:38','2026-09-30 22:10:17','2026-09-30 22:13:31'),(4,'done',100,'manual','Aaj ka Special','daily','square','hinglish',24,'{\"template\":\"daily\",\"title\":\"Aaj ka Special\",\"festivalName\":\"\",\"greeting\":\"Aaj ka Special\",\"subText\":\"\",\"offerText\":\"Aaj Rs 999+ ke order par 5% extra chhoot\",\"couponCode\":\"\",\"featuredProducts\":[{\"id\":9,\"name\":\"Vim Dishwash Bar\",\"weight\":\"600 g\",\"price\":45,\"mrp\":52,\"image\":\"https://www.bbassets.com/media/uploads/p/m/100006809_16-vim-dishwash-bar-lemon.jpg?tr=w-154,q-80\",\"emoji\":\"🧹\"},{\"id\":1,\"name\":\"Aashirvaad Atta\",\"weight\":\"5 Kg\",\"price\":200,\"mrp\":280,\"image\":\"https://www.bbassets.com/media/uploads/p/m/40053356_9-ganesh-whole-wheat-chakki-atta.jpg?tr=w-154,q-80\",\"emoji\":\"🌾\"},{\"id\":55,\"name\":\"Mustard Seeds (Rai)\",\"weight\":\"200 g\",\"price\":30,\"mrp\":35,\"image\":\"https://www.bigbasket.com/media/uploads/p/l/40015120_2-bb-popular-mustard-seeds-rai-big.jpg\",\"emoji\":\"🛒\"},{\"id\":10,\"name\":\"Dettol Original Soap\",\"weight\":\"125 g\",\"price\":48,\"mrp\":55,\"image\":\"https://www.bbassets.com/media/uploads/p/l/40325774_6-dettol-skincare-soap.jpg\",\"emoji\":\"🧴\"}],\"colors\":{\"primary\":\"#ff6600\",\"secondary\":\"#ff9800\",\"accent\":\"#d32f2f\"},\"emojis\":[],\"durationSec\":24,\"format\":\"square\",\"musicStyle\":\"upbeat\",\"store\":{\"name\":\"4astore\",\"tagline\":\"Aapka Apna Grocery Store\",\"phone\":\"82108 74123\",\"whatsapp\":\"82108 74123\",\"address\":\"Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\",\"area\":\"Nabinagar, Aurangabad (Bihar)\",\"deliveryCharge\":30,\"freeAbove\":500,\"payment\":\"UPI (GPay/PhonePe/Paytm)\",\"theme\":{\"primary\":\"#ff6600\",\"dark\":\"#e55b00\",\"light\":\"#fff3e0\",\"accent\":\"#d32f2f\",\"ink\":\"#1a1a2e\"}}}','v4_a950b7bfa1aa',2990301,'🔥 Aaj ka Special — 4astore par!\n\n✅ Vim Dishwash Bar 600 g — sirf ₹45 (MRP ₹52)\n✅ Aashirvaad Atta 5 Kg — sirf ₹200 (MRP ₹280)\n✅ Mustard Seeds (Rai) 200 g — sirf ₹30 (MRP ₹35)\n✅ Dettol Original Soap 125 g — sirf ₹48 (MRP ₹55)\n\n🎁 Aaj Rs 999+ ke order par 5% extra chhoot\n\n🚚 FREE delivery ₹500 se upar • baaki sirf ₹30\n💳 Payment: UPI (GPay/PhonePe/Paytm)\n📞 Call / 💬 WhatsApp: 82108 74123\n📍 Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\n📲 4astore app download karein aur aaj hi order karein!\n\n#4astore #Nabinagar #Aurangabad #Bihar #GroceryDelivery #OnlineGrocery #HomeDelivery #AajKaSpecial #DealOfTheDay #GroceryOffers',NULL,'owner','2026-09-30 16:33:38','2026-09-30 22:13:32','2026-09-30 22:15:54'),(5,'done',100,'auto','Diwali','festival','reel','hinglish',24,'{\"template\":\"festival\",\"title\":\"Diwali\",\"festivalName\":\"Diwali\",\"greeting\":\"Happy Diwali!\",\"subText\":\"Deepawali ki hardik Shubhkamnayein\",\"offerText\":\"Diwali Dhamaka — mithai, dry fruits, pooja saamagri\",\"couponCode\":\"\",\"featuredProducts\":[{\"id\":9,\"name\":\"Vim Dishwash Bar\",\"weight\":\"600 g\",\"price\":45,\"mrp\":52,\"image\":\"https://www.bbassets.com/media/uploads/p/m/100006809_16-vim-dishwash-bar-lemon.jpg?tr=w-154,q-80\",\"emoji\":\"🧹\"},{\"id\":1,\"name\":\"Aashirvaad Atta\",\"weight\":\"5 Kg\",\"price\":200,\"mrp\":280,\"image\":\"https://www.bbassets.com/media/uploads/p/m/40053356_9-ganesh-whole-wheat-chakki-atta.jpg?tr=w-154,q-80\",\"emoji\":\"🌾\"},{\"id\":55,\"name\":\"Mustard Seeds (Rai)\",\"weight\":\"200 g\",\"price\":30,\"mrp\":35,\"image\":\"https://www.bigbasket.com/media/uploads/p/l/40015120_2-bb-popular-mustard-seeds-rai-big.jpg\",\"emoji\":\"🛒\"},{\"id\":10,\"name\":\"Dettol Original Soap\",\"weight\":\"125 g\",\"price\":48,\"mrp\":55,\"image\":\"https://www.bbassets.com/media/uploads/p/l/40325774_6-dettol-skincare-soap.jpg\",\"emoji\":\"🧴\"}],\"colors\":{\"primary\":\"#1a1a2e\",\"secondary\":\"#b8860b\",\"accent\":\"#ffd700\"},\"emojis\":[\"🪔\",\"✨\",\"🎆\",\"🪙\"],\"durationSec\":24,\"format\":\"reel\",\"musicStyle\":\"festive\",\"store\":{\"name\":\"4astore\",\"tagline\":\"Aapka Apna Grocery Store\",\"phone\":\"82108 74123\",\"whatsapp\":\"82108 74123\",\"address\":\"Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\",\"area\":\"Nabinagar, Aurangabad (Bihar)\",\"deliveryCharge\":30,\"freeAbove\":500,\"payment\":\"UPI (GPay/PhonePe/Paytm)\",\"theme\":{\"primary\":\"#ff6600\",\"dark\":\"#e55b00\",\"light\":\"#fff3e0\",\"accent\":\"#d32f2f\",\"ink\":\"#1a1a2e\"}}}','v5_76d552da0dd7',5992801,'🪔✨🎆 Happy Diwali! 🪔✨🎆\n4astore parivaar ki taraf se aapko aur aapke parivaar ko Diwali ki dher saari shubhkamnayein! 🙏\nDeepawali ki hardik Shubhkamnayein\n\n🎁 Diwali Dhamaka — mithai, dry fruits, pooja saamagri\n\n🚚 FREE delivery ₹500 se upar • baaki sirf ₹30\n💳 Payment: UPI (GPay/PhonePe/Paytm)\n📞 Call / 💬 WhatsApp: 82108 74123\n📍 Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\n📲 4astore app download karein aur aaj hi order karein!\n\n#4astore #Nabinagar #Aurangabad #Bihar #GroceryDelivery #OnlineGrocery #HomeDelivery #Diwali #HappyDiwali #DiwaliOffer #FestivalOffer',NULL,'owner','2026-09-30 17:11:32','2026-09-30 22:41:32','2026-09-30 22:42:49'),(6,'done',100,'manual','Aaj ka Special','daily','reel','hinglish',24,'{\"template\":\"daily\",\"title\":\"Aaj ka Special\",\"festivalName\":\"\",\"greeting\":\"Aaj ka Special\",\"subText\":\"\",\"offerText\":\"\",\"couponCode\":\"\",\"featuredProducts\":[{\"id\":9,\"name\":\"Vim Dishwash Bar\",\"weight\":\"600 g\",\"price\":45,\"mrp\":52,\"image\":\"https://www.bbassets.com/media/uploads/p/m/100006809_16-vim-dishwash-bar-lemon.jpg?tr=w-154,q-80\",\"emoji\":\"🧹\"},{\"id\":1,\"name\":\"Aashirvaad Atta\",\"weight\":\"5 Kg\",\"price\":200,\"mrp\":280,\"image\":\"https://www.bbassets.com/media/uploads/p/m/40053356_9-ganesh-whole-wheat-chakki-atta.jpg?tr=w-154,q-80\",\"emoji\":\"🌾\"},{\"id\":55,\"name\":\"Mustard Seeds (Rai)\",\"weight\":\"200 g\",\"price\":30,\"mrp\":35,\"image\":\"https://www.bigbasket.com/media/uploads/p/l/40015120_2-bb-popular-mustard-seeds-rai-big.jpg\",\"emoji\":\"🛒\"},{\"id\":10,\"name\":\"Dettol Original Soap\",\"weight\":\"125 g\",\"price\":48,\"mrp\":55,\"image\":\"https://www.bbassets.com/media/uploads/p/l/40325774_6-dettol-skincare-soap.jpg\",\"emoji\":\"🧴\"}],\"colors\":{\"primary\":\"#ff6600\",\"secondary\":\"#ff9800\",\"accent\":\"#d32f2f\"},\"emojis\":[],\"durationSec\":24,\"format\":\"reel\",\"musicStyle\":\"upbeat\",\"store\":{\"name\":\"4astore\",\"tagline\":\"Aapka Apna Grocery Store\",\"phone\":\"82108 74123\",\"whatsapp\":\"82108 74123\",\"address\":\"Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\",\"area\":\"Nabinagar, Aurangabad (Bihar)\",\"deliveryCharge\":30,\"freeAbove\":500,\"payment\":\"UPI (GPay/PhonePe/Paytm)\",\"theme\":{\"primary\":\"#ff6600\",\"dark\":\"#e55b00\",\"light\":\"#fff3e0\",\"accent\":\"#d32f2f\",\"ink\":\"#1a1a2e\"}}}','v6_ef9069036f78',4555261,'🔥 Aaj ka Special — 4astore par!\n\n✅ Vim Dishwash Bar 600 g — sirf ₹45 (MRP ₹52)\n✅ Aashirvaad Atta 5 Kg — sirf ₹200 (MRP ₹280)\n✅ Mustard Seeds (Rai) 200 g — sirf ₹30 (MRP ₹35)\n✅ Dettol Original Soap 125 g — sirf ₹48 (MRP ₹55)\n\n🚚 FREE delivery ₹500 se upar • baaki sirf ₹30\n💳 Payment: UPI (GPay/PhonePe/Paytm)\n📞 Call / 💬 WhatsApp: 82108 74123\n📍 Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\n📲 4astore app download karein aur aaj hi order karein!\n\n#4astore #Nabinagar #Aurangabad #Bihar #GroceryDelivery #OnlineGrocery #HomeDelivery #AajKaSpecial #DealOfTheDay #GroceryOffers',NULL,'owner','2026-09-30 17:19:59','2026-09-30 22:50:00','2026-09-30 22:52:56'),(7,'done',100,'auto','Aaj ka Special — 2026-09-30','daily','reel','hinglish',24,'{\"template\":\"daily\",\"title\":\"Aaj ka Special — 2026-09-30\",\"festivalName\":\"\",\"greeting\":\"Aaj ka Special\",\"subText\":\"\",\"offerText\":\"\",\"couponCode\":\"\",\"featuredProducts\":[{\"id\":9,\"name\":\"Vim Dishwash Bar\",\"weight\":\"600 g\",\"price\":45,\"mrp\":52,\"image\":\"https://www.bbassets.com/media/uploads/p/m/100006809_16-vim-dishwash-bar-lemon.jpg?tr=w-154,q-80\",\"emoji\":\"🧹\"},{\"id\":1,\"name\":\"Aashirvaad Atta\",\"weight\":\"5 Kg\",\"price\":200,\"mrp\":280,\"image\":\"https://www.bbassets.com/media/uploads/p/m/40053356_9-ganesh-whole-wheat-chakki-atta.jpg?tr=w-154,q-80\",\"emoji\":\"🌾\"},{\"id\":55,\"name\":\"Mustard Seeds (Rai)\",\"weight\":\"200 g\",\"price\":30,\"mrp\":35,\"image\":\"https://www.bigbasket.com/media/uploads/p/l/40015120_2-bb-popular-mustard-seeds-rai-big.jpg\",\"emoji\":\"🛒\"},{\"id\":10,\"name\":\"Dettol Original Soap\",\"weight\":\"125 g\",\"price\":48,\"mrp\":55,\"image\":\"https://www.bbassets.com/media/uploads/p/l/40325774_6-dettol-skincare-soap.jpg\",\"emoji\":\"🧴\"}],\"colors\":{\"primary\":\"#ff6600\",\"secondary\":\"#ff9800\",\"accent\":\"#d32f2f\"},\"emojis\":[],\"durationSec\":24,\"format\":\"reel\",\"musicStyle\":\"upbeat\",\"store\":{\"name\":\"4astore\",\"tagline\":\"Aapka Apna Grocery Store\",\"phone\":\"82108 74123\",\"whatsapp\":\"82108 74123\",\"address\":\"Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\",\"area\":\"Nabinagar, Aurangabad (Bihar)\",\"deliveryCharge\":30,\"freeAbove\":500,\"payment\":\"UPI (GPay/PhonePe/Paytm)\",\"theme\":{\"primary\":\"#ff6600\",\"dark\":\"#e55b00\",\"light\":\"#fff3e0\",\"accent\":\"#d32f2f\",\"ink\":\"#1a1a2e\"}}}','v7_f061ffddb59b',4555261,'🔥 Aaj ka Special — 4astore par!\n\n✅ Vim Dishwash Bar 600 g — sirf ₹45 (MRP ₹52)\n✅ Aashirvaad Atta 5 Kg — sirf ₹200 (MRP ₹280)\n✅ Mustard Seeds (Rai) 200 g — sirf ₹30 (MRP ₹35)\n✅ Dettol Original Soap 125 g — sirf ₹48 (MRP ₹55)\n\n🚚 FREE delivery ₹500 se upar • baaki sirf ₹30\n💳 Payment: UPI (GPay/PhonePe/Paytm)\n📞 Call / 💬 WhatsApp: 82108 74123\n📍 Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\n📲 4astore app download karein aur aaj hi order karein!\n\n#4astore #Nabinagar #Aurangabad #Bihar #GroceryDelivery #OnlineGrocery #HomeDelivery #AajKaSpecial #DealOfTheDay #GroceryOffers',NULL,'owner','2026-09-30 17:23:22','2026-09-30 22:53:22','2026-09-30 22:55:43'),(8,'done',100,'manual','Aaj ka Special','daily','reel','hinglish',24,'{\"template\":\"daily\",\"title\":\"Aaj ka Special\",\"festivalName\":\"\",\"greeting\":\"Aaj ka Special\",\"subText\":\"\",\"offerText\":\"\",\"couponCode\":\"\",\"featuredProducts\":[{\"id\":9,\"name\":\"Vim Dishwash Bar\",\"weight\":\"600 g\",\"price\":45,\"mrp\":52,\"image\":\"https://www.bbassets.com/media/uploads/p/m/100006809_16-vim-dishwash-bar-lemon.jpg?tr=w-154,q-80\",\"emoji\":\"🧹\"},{\"id\":1,\"name\":\"Aashirvaad Atta\",\"weight\":\"5 Kg\",\"price\":200,\"mrp\":280,\"image\":\"https://www.bbassets.com/media/uploads/p/m/40053356_9-ganesh-whole-wheat-chakki-atta.jpg?tr=w-154,q-80\",\"emoji\":\"🌾\"},{\"id\":55,\"name\":\"Mustard Seeds (Rai)\",\"weight\":\"200 g\",\"price\":30,\"mrp\":35,\"image\":\"https://www.bigbasket.com/media/uploads/p/l/40015120_2-bb-popular-mustard-seeds-rai-big.jpg\",\"emoji\":\"🛒\"},{\"id\":10,\"name\":\"Dettol Original Soap\",\"weight\":\"125 g\",\"price\":48,\"mrp\":55,\"image\":\"https://www.bbassets.com/media/uploads/p/l/40325774_6-dettol-skincare-soap.jpg\",\"emoji\":\"🧴\"}],\"colors\":{\"primary\":\"#ff6600\",\"secondary\":\"#ff9800\",\"accent\":\"#d32f2f\"},\"emojis\":[],\"durationSec\":24,\"format\":\"reel\",\"musicStyle\":\"upbeat\",\"store\":{\"name\":\"4astore\",\"tagline\":\"Aapka Apna Grocery Store\",\"phone\":\"82108 74123\",\"whatsapp\":\"82108 74123\",\"address\":\"Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\",\"area\":\"Nabinagar, Aurangabad (Bihar)\",\"deliveryCharge\":30,\"freeAbove\":500,\"payment\":\"UPI (GPay/PhonePe/Paytm)\",\"theme\":{\"primary\":\"#ff6600\",\"dark\":\"#e55b00\",\"light\":\"#fff3e0\",\"accent\":\"#d32f2f\",\"ink\":\"#1a1a2e\"}}}','v8_be4b4a9d9af6',4555261,'🔥 Aaj ka Special — 4astore par!\n\n✅ Vim Dishwash Bar 600 g — sirf ₹45 (MRP ₹52)\n✅ Aashirvaad Atta 5 Kg — sirf ₹200 (MRP ₹280)\n✅ Mustard Seeds (Rai) 200 g — sirf ₹30 (MRP ₹35)\n✅ Dettol Original Soap 125 g — sirf ₹48 (MRP ₹55)\n\n🚚 FREE delivery ₹500 se upar • baaki sirf ₹30\n💳 Payment: UPI (GPay/PhonePe/Paytm)\n📞 Call / 💬 WhatsApp: 82108 74123\n📍 Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301\n📲 4astore app download karein aur aaj hi order karein!\n\n#4astore #Nabinagar #Aurangabad #Bihar #GroceryDelivery #OnlineGrocery #HomeDelivery #AajKaSpecial #DealOfTheDay #GroceryOffers',NULL,'owner','2026-09-30 17:24:21','2026-09-30 22:55:43','2026-09-30 22:57:38');
/*!40000 ALTER TABLE `video_jobs` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-10-01 12:34:30
