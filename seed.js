import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import dotenv from 'dotenv';
import mongoose from 'mongoose';

import User             from './models/User.js';
import Category          from './models/Category.js';
import Product            from './models/Product.js';
import FulfillmentNode    from './models/FulfillmentNode.js';
import InventoryItem      from './models/InventoryItem.js';
import DealerOffer        from './models/DealerOffer.js';
import DealerRequest      from './models/DealerRequest.js';
import Cart                from './models/Cart.js';
import Wishlist            from './models/Wishlist.js';
import Order               from './models/Order.js';
import Notification        from './models/Notification.js';

import { findOrCreateDealerNode, buildSku } from './services/inventory/migrationService.js';

dotenv.config();

/* ═══════════════════════════════════════════════════════════════════════
   THE SINGLE SEED FILE  (npm run seed)
   ─────────────────────────────────────────────────────────────────────
   Wipes every collection that holds seed-derived or user-generated data
   and rebuilds a clean, internally-consistent dataset:

     Users (admin / 3 dealers / 1 customer)
       → Categories (+ sub-categories)
       → Products            — ONE catalogue document per item (no
                                 duplicates — this is what previously
                                 caused the same product to show up
                                 once per dealer in search results)
       → FulfillmentNodes    — one per dealer, with REAL city-center
                                 coordinates so Phase 2 geo search works
       → DealerOffers        — every product is offered by all 3 dealers
                                 at independently varied prices
       → InventoryItems      — independently varied stock per dealer

   Safe to re-run any time: it always starts by clearing the relevant
   collections, so there is never a way to end up with duplicates.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── 1. USERS ────────────────────────────────────────────────────────── */

const adminUser = {
  name: 'Admin',
  email: 'admin@tvsauto.com',
  password: 'Admin@123',
  phone: '9000000001',
  role: 'admin',
  isActive: true,
  addresses: [{
    label: 'Office', street: 'TVS Tower, 14th Floor', city: 'Chennai',
    state: 'Tamil Nadu', pincode: '600032', country: 'India',
    isDefault: true, latitude: 13.0827, longitude: 80.2707,
  }],
};

const customerUser = {
  name: 'Test User',
  email: 'user@tvsauto.com',
  password: 'User@123',
  phone: '9000000003',
  role: 'user',
  isActive: true,
  addresses: [{
    label: 'Home', street: '42, MG Road', city: 'Vellore',
    state: 'Tamil Nadu', pincode: '632004', country: 'India',
    isDefault: true, latitude: 12.9165, longitude: 79.1325,
  }],
};

// Real city-center coordinates ([lng, lat] stored on the node; lat/lng kept
// here as plain numbers for convenience) — used for both the dealer's own
// saved address AND their FulfillmentNode.location, so Phase 2 geospatial
// search behaves realistically out of the box. These are genuine public
// coordinates for each city center, not fabricated per-business precision
// (Phase 1/2 spec §20 — never invent a location).
const dealersData = [
  {
    name: 'Rajesh Motors', email: 'rajesh@tvsdealer.com', password: 'Dealer@123',
    phone: '9876543210', dealerId: 'TVSD-001', businessName: 'Rajesh Motors Pvt Ltd',
    businessLocation: 'Chennai, Tamil Nadu', dealerState: 'Tamil Nadu',
    dealerApproved: true, dealerRequestedAt: new Date(),
    city: 'Chennai', lat: 13.0827, lng: 80.2707, serviceRadiusKm: 15, expressEnabled: true,
    addresses: [{
      label: 'Showroom', street: '123 Anna Salai', city: 'Chennai', state: 'Tamil Nadu',
      pincode: '600001', country: 'India', isDefault: true, latitude: 13.0827, longitude: 80.2707,
    }],
  },
  {
    name: 'Vikram Auto', email: 'vikram@tvsdealer.com', password: 'Dealer@123',
    phone: '9876543211', dealerId: 'TVSD-002', businessName: 'Vikram Auto Supplies',
    businessLocation: 'Bangalore, Karnataka', dealerState: 'Karnataka',
    dealerApproved: true, dealerRequestedAt: new Date(),
    city: 'Bangalore', lat: 12.9716, lng: 77.5946, serviceRadiusKm: 20, expressEnabled: true,
    addresses: [{
      label: 'Showroom', street: '456 MG Road', city: 'Bangalore', state: 'Karnataka',
      pincode: '560001', country: 'India', isDefault: true, latitude: 12.9716, longitude: 77.5946,
    }],
  },
  {
    name: 'Vellore Auto Hub', email: 'vellore@tvsdealer.com', password: 'Dealer@123',
    phone: '9876543212', dealerId: 'TVSD-003', businessName: 'Vellore Auto Hub Pvt Ltd',
    businessLocation: 'Vellore, Tamil Nadu', dealerState: 'Tamil Nadu',
    dealerApproved: true, dealerRequestedAt: new Date(),
    city: 'Vellore', lat: 12.9165, lng: 79.1325, serviceRadiusKm: 15, expressEnabled: true,
    addresses: [{
      label: 'Warehouse', street: 'Katpadi Road', city: 'Vellore', state: 'Tamil Nadu',
      pincode: '632004', country: 'India', isDefault: true, latitude: 12.9165, longitude: 79.1325,
    }],
  },
];

/* ── 2. CATEGORIES + SUB-CATEGORIES ─────────────────────────────────── */

const categories = [
  { name: 'Engine Parts', slug: 'engine-parts', icon: '🔧',
    description: 'Genuine engine components – pistons, valves, gaskets & more', navOrder: 1,
    subCategories: [
      { name: 'Pistons & Rings', slug: 'pistons-rings', order: 1 },
      { name: 'Oil Filter',      slug: 'oil-filter',    order: 2 },
      { name: 'Spark Plug',      slug: 'spark-plug',    order: 3 },
      { name: 'Air Filter',      slug: 'air-filter',    order: 4 },
    ] },
  { name: 'Braking System', slug: 'braking-system', icon: '🛑',
    description: 'Brake pads, discs, shoes & hydraulic components', navOrder: 2,
    subCategories: [
      { name: 'Brake Pads',  slug: 'brake-pads',  order: 1 },
      { name: 'Brake Discs', slug: 'brake-discs', order: 2 },
    ] },
  { name: 'Electrical & Lighting', slug: 'electrical-lighting', icon: '💡',
    description: 'Headlamps, batteries, CDI units & wiring harnesses', navOrder: 3,
    subCategories: [
      { name: 'Headlamps', slug: 'headlamps', order: 1 },
      { name: 'Battery',   slug: 'battery',   order: 2 },
    ] },
  { name: 'Transmission & Clutch', slug: 'transmission-clutch', icon: '⚙️',
    description: 'Clutch plates, chains, sprockets & gear components', navOrder: 4,
    subCategories: [
      { name: 'Clutch Plates',      slug: 'clutch-plates',      order: 1 },
      { name: 'Chains & Sprockets', slug: 'chains-sprockets',   order: 2 },
    ] },
  { name: 'Tyres & Wheels', slug: 'tyres-wheels', icon: '🛞',
    description: 'TVS Eurogrip tyres, alloy wheels, tubes & rim tapes', navOrder: 5,
    subCategories: [
      { name: 'Rear Tyres',   slug: 'rear-tyres',   order: 1 },
      { name: 'Alloy Wheels', slug: 'alloy-wheels', order: 2 },
    ] },
  { name: 'Oils & Lubricants', slug: 'oils-lubricants', icon: '🛢️',
    description: 'Engine oils, gear oils, chain lubes & coolants', navOrder: 6,
    subCategories: [
      { name: 'Engine Oil', slug: 'engine-oil', order: 1 },
      { name: 'Chain Lube', slug: 'chain-lube', order: 2 },
    ] },
];

/* ── 3. PRODUCTS — ONE catalogue document per item ──────────────────── */
/*    `ownerIndex` picks which dealer (0/1/2) is the "anchor" owner for
       legacy Product.dealer/price/stock — every product is still listed
       by ALL THREE dealers via DealerOffer/InventoryItem below, each at
       its own price/stock (Phase 1 spec §33/§34 multi-dealer scenario). */

const products = [
  { title: 'TVS Apache RTR 160 Piston Kit', brand: 'TVS', model: 'Apache RTR 160',
    category: 'Engine Parts', subCategory: 'Pistons & Rings', price: 1450, originalPrice: 1800,
    stock: 45, partNumber: 'TVS-ENG-PST-001', material: 'Aluminum Alloy', ownerIndex: 0,
    description: 'Genuine TVS piston kit for Apache RTR 160 4V. Includes piston, rings, gudgeon pin & circlips.',
    features: ['Precision-machined', 'OEM spec', 'Includes rings & pin'], tags: ['piston', 'engine', 'apache'],
    compatibility: ['Apache RTR 160 4V'], image: 'https://placehold.co/600x400/0a1f44/ffffff?text=Piston+Kit',
    images: ['https://placehold.co/600x400/0a1f44/ffffff?text=Piston+Kit'] },

  { title: 'TVS Oil Filter Premium', brand: 'TVS', category: 'Engine Parts', subCategory: 'Oil Filter',
    price: 350, originalPrice: 450, stock: 200, partNumber: 'TVS-OF-001', ownerIndex: 1,
    description: 'Fine-filtration oil filter for TVS 4-stroke engines. Easy screw-on installation.',
    features: ['Fine filtration', 'Easy installation'], tags: ['filter', 'maintenance', 'oil'],
    compatibility: ['All TVS 4-stroke models'], image: 'https://placehold.co/600x400/1b1b35/78e08f?text=Oil+Filter',
    images: ['https://placehold.co/600x400/1b1b35/78e08f?text=Oil+Filter'] },

  { title: 'TVS Spark Plug Set', brand: 'TVS', category: 'Engine Parts', subCategory: 'Spark Plug',
    price: 800, originalPrice: 1000, stock: 120, partNumber: 'TVS-SP-001', ownerIndex: 2,
    description: 'Quality spark plugs for reliable ignition and better fuel economy.',
    features: ['Long lifespan', 'Better fuel economy'], tags: ['spark', 'ignition', 'engine'],
    compatibility: ['Apache RTR 160', 'Apache RTR 200', 'Ntorq 125'],
    image: 'https://placehold.co/600x400/1c1c2e/f38181?text=Spark+Plug',
    images: ['https://placehold.co/600x400/1c1c2e/f38181?text=Spark+Plug'] },

  { title: 'TVS Air Filter Assembly', brand: 'TVS', category: 'Engine Parts', subCategory: 'Air Filter',
    price: 450, originalPrice: 600, stock: 100, partNumber: 'TVS-AF-001', ownerIndex: 0,
    description: 'Keeps engine air intake clean, reduces emissions and improves throttle response.',
    features: ['Efficient', 'Reduces emissions'], tags: ['filter', 'air', 'engine'],
    compatibility: ['All TVS 4-stroke models'], image: 'https://placehold.co/600x400/141430/cf6a87?text=Air+Filter',
    images: ['https://placehold.co/600x400/141430/cf6a87?text=Air+Filter'] },

  { title: 'TVS Front Brake Pad Set', brand: 'TVS', category: 'Braking System', subCategory: 'Brake Pads',
    price: 1200, originalPrice: 1500, stock: 75, partNumber: 'TVS-BP-F01', ownerIndex: 1,
    description: 'Premium sintered front brake pads for smooth, low-noise braking and long life.',
    features: ['Low noise', 'Long lasting', 'Sintered compound'], tags: ['brakes', 'safety', 'pads'],
    compatibility: ['Apache RTR 160 4V', 'Apache RTR 200 4V'],
    image: 'https://placehold.co/600x400/de1c0e/ffffff?text=Brake+Pads',
    images: ['https://placehold.co/600x400/de1c0e/ffffff?text=Brake+Pads'] },

  { title: 'TVS Apache RTR 200 Brake Disc – Front', brand: 'TVS', model: 'Apache RTR 200',
    category: 'Braking System', subCategory: 'Brake Discs', price: 1850, originalPrice: 2200,
    stock: 30, partNumber: 'TVS-BD-F02', ownerIndex: 2,
    description: 'Petal-cut front disc rotor for improved heat dissipation and consistent braking.',
    features: ['Petal-cut design', 'Heat resistant', 'OEM spec'], tags: ['brakes', 'disc', 'apache'],
    compatibility: ['Apache RTR 200 4V'], image: 'https://placehold.co/600x400/8b0000/ffffff?text=Brake+Disc',
    images: ['https://placehold.co/600x400/8b0000/ffffff?text=Brake+Disc'] },

  { title: 'TVS Headlight Assembly – LED', brand: 'TVS', category: 'Electrical & Lighting',
    subCategory: 'Headlamps', price: 2800, originalPrice: 3500, stock: 35, partNumber: 'TVS-HL-LED01',
    ownerIndex: 0,
    description: 'Bright LED headlight assembly for better night visibility and lower power draw.',
    features: ['Bright', 'Energy-efficient', 'Long-lasting'], tags: ['headlight', 'lighting', 'led'],
    compatibility: ['Ntorq 125', 'Apache RTR 160'], image: 'https://placehold.co/600x400/f1c40f/0a1f44?text=Headlight',
    images: ['https://placehold.co/600x400/f1c40f/0a1f44?text=Headlight'] },

  { title: 'TVS Battery – 12V 65Ah', brand: 'TVS', category: 'Electrical & Lighting', subCategory: 'Battery',
    price: 3500, originalPrice: 4500, stock: 40, partNumber: 'TVS-BTR-001', ownerIndex: 1,
    description: 'Heavy-duty maintenance-free battery with long backup for all TVS models.',
    features: ['High capacity', 'Maintenance-free'], tags: ['battery', 'electrical', 'power'],
    compatibility: ['All TVS models'], image: 'https://placehold.co/600x400/2c3e50/ffffff?text=Battery',
    images: ['https://placehold.co/600x400/2c3e50/ffffff?text=Battery'] },

  { title: 'TVS Apache RTR 200 Clutch Plate Set', brand: 'TVS', model: 'Apache RTR 200',
    category: 'Transmission & Clutch', subCategory: 'Clutch Plates', price: 1100, originalPrice: 1350,
    stock: 40, partNumber: 'TVS-TRN-CLT-001', material: 'Cork + Steel', ownerIndex: 2,
    description: 'Complete clutch plate set (friction + steel) for smooth engagement and long service life.',
    features: ['Complete set', 'Smooth engagement', 'Heat resistant'], tags: ['clutch', 'plates', 'apache'],
    compatibility: ['Apache RTR 200 4V'], image: 'https://placehold.co/600x400/1c1c2e/f38181?text=Clutch+Plates',
    images: ['https://placehold.co/600x400/1c1c2e/f38181?text=Clutch+Plates'] },

  { title: 'TVS Star City Chain & Sprocket Kit', brand: 'TVS', model: 'Star City Plus',
    category: 'Transmission & Clutch', subCategory: 'Chains & Sprockets', price: 1650, originalPrice: 2000,
    stock: 55, partNumber: 'TVS-TRN-CHN-002', material: 'Alloy Steel', ownerIndex: 0,
    description: 'O-ring sealed chain paired with precision-cut front & rear sprockets for minimal maintenance.',
    features: ['O-ring chain', 'Pre-lubricated', 'Hardened sprockets'], tags: ['chain', 'sprocket', 'drive'],
    compatibility: ['Star City Plus'], image: 'https://placehold.co/600x400/1a1a30/20bf6b?text=Chain+Kit',
    images: ['https://placehold.co/600x400/1a1a30/20bf6b?text=Chain+Kit'] },

  { title: 'TVS Eurogrip Protorq Sport 110/70-17 Rear Tyre', brand: 'TVS', model: 'Apache RTR 200',
    category: 'Tyres & Wheels', subCategory: 'Rear Tyres', price: 3800, originalPrice: 4200,
    stock: 25, partNumber: 'TVS-TYR-RR-001', material: 'Dual-compound Rubber', ownerIndex: 1, isFeatured: true,
    description: 'Dual-compound technology — harder center for mileage, softer edges for cornering grip.',
    features: ['Dual compound', 'Sport pattern', 'Tubeless'], tags: ['tyre', 'rear', 'eurogrip'],
    compatibility: ['Apache RTR 200 4V', 'Apache RTR 160 4V'],
    image: 'https://placehold.co/600x400/0d0d2b/778beb?text=Rear+Tyre',
    images: ['https://placehold.co/600x400/0d0d2b/778beb?text=Rear+Tyre'] },

  { title: 'TVS Jupiter Alloy Wheel – Front', brand: 'TVS', model: 'Jupiter', category: 'Tyres & Wheels',
    subCategory: 'Alloy Wheels', price: 2900, originalPrice: 3400, stock: 15, partNumber: 'TVS-TYR-ALY-002',
    material: 'Die-cast Aluminum', color: 'Gunmetal Grey', ownerIndex: 2,
    description: 'Die-cast aluminum front alloy wheel for superior strength-to-weight ratio. Tubeless ready.',
    features: ['Die-cast alloy', 'Tubeless ready', 'Corrosion treated'], tags: ['alloy', 'wheel', 'jupiter'],
    compatibility: ['Jupiter', 'Jupiter ZX'], image: 'https://placehold.co/600x400/141430/cf6a87?text=Alloy+Wheel',
    images: ['https://placehold.co/600x400/141430/cf6a87?text=Alloy+Wheel'] },

  { title: 'TVS TRU4 10W-30 Semi-Synthetic Engine Oil (1L)', brand: 'TVS', category: 'Oils & Lubricants',
    subCategory: 'Engine Oil', price: 420, originalPrice: 500, stock: 300, partNumber: 'TVS-OIL-ENG-001',
    ownerIndex: 0, isFeatured: true,
    description: 'Semi-synthetic 10W-30 engine oil for TVS 4-stroke engines — thermal stability & anti-wear.',
    features: ['Semi-synthetic', 'Anti-wear additives', 'JASO MA2 rated'], tags: ['engine-oil', 'lubricant'],
    compatibility: ['All TVS 4-stroke models'], image: 'https://placehold.co/600x400/1b1b35/78e08f?text=Engine+Oil',
    images: ['https://placehold.co/600x400/1b1b35/78e08f?text=Engine+Oil'] },

  { title: 'TVS Chain Lubricant Spray (150ml)', brand: 'TVS', category: 'Oils & Lubricants',
    subCategory: 'Chain Lube', price: 280, originalPrice: 350, stock: 180, partNumber: 'TVS-OIL-CHN-002',
    ownerIndex: 1,
    description: 'Anti-fling formula penetrates deep into O-ring chains to reduce friction and extend life.',
    features: ['Anti-fling', 'O-ring safe', 'Water resistant'], tags: ['chain-lube', 'maintenance'],
    compatibility: ['All chain-drive models'], image: 'https://placehold.co/600x400/1a1a33/badc58?text=Chain+Lube',
    images: ['https://placehold.co/600x400/1a1a33/badc58?text=Chain+Lube'] },
];

/* ── helper ──────────────────────────────────────────────────────────── */

// Deterministic per-dealer price/stock variance so every product is
// realistically offered by all 3 dealers at slightly different terms
// (Phase 1 spec §33/§34 — same product, different dealer, different
// price/stock) rather than every dealer selling at an identical price.
const dealerVariance = (basePrice, baseStock, dealerIdx, ownerIdx) => {
  const step = (dealerIdx - ownerIdx + 3) % 3; // 0 for the owner, 1/2 for the other two
  const priceDelta   = step === 0 ? 0 : step === 1 ? 40 : -25;
  const stockFactor  = step === 0 ? 1 : step === 1 ? 0.6 : 0.35;
  return {
    sellingPrice: Math.max(1, basePrice + priceDelta),
    onHand: Math.max(5, Math.round(baseStock * stockFactor)),
  };
};

/* ── RUNNER ──────────────────────────────────────────────────────────── */

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tvs-autoparts');
    console.log('✅ Connected to MongoDB\n');

    /* ── Wipe everything this seed owns ─────────────────────────────── */
    console.log('🗑️  Clearing existing data...');
    await Promise.all([
      User.deleteMany({}), Category.deleteMany({}), Product.deleteMany({}),
      FulfillmentNode.deleteMany({}), InventoryItem.deleteMany({}), DealerOffer.deleteMany({}),
      DealerRequest.deleteMany({}), Cart.deleteMany({}), Wishlist.deleteMany({}),
      Order.deleteMany({}), Notification.deleteMany({}),
    ]);
    console.log('✅ Database cleared — starting fresh\n');

    /* ── 1. Users ────────────────────────────────────────────────────── */
    console.log('── USERS ──────────────────────────────────────');
    const admin = await User.create(adminUser);
    console.log(`  ✅ admin  — ${admin.email}`);

    const dealers = [];
    for (const d of dealersData) {
      const dealer = await User.create({ ...d, role: 'dealer', isActive: true });
      dealers.push(dealer);
      console.log(`  ✅ dealer — ${dealer.email} (${dealer.dealerId})`);
    }

    const customer = await User.create(customerUser);
    console.log(`  ✅ user   — ${customer.email}`);

    /* ── 2. Categories ───────────────────────────────────────────────── */
    console.log('\n── CATEGORIES ─────────────────────────────────');
    for (const cat of categories) {
      const created = await Category.create(cat);
      console.log(`  ✅ ${cat.icon} ${cat.name} → ${created.subCategories.length} sub-categories`);
    }

    /* ── 3. Fulfillment nodes (one per dealer, real coordinates) ──────── */
    console.log('\n── FULFILLMENT NODES ──────────────────────────');
    const nodeByDealer = new Map();
    for (const dealer of dealers) {
      const meta = dealersData.find((d) => d.dealerId === dealer.dealerId);
      const { node } = await findOrCreateDealerNode(dealer);
      node.location = { type: 'Point', coordinates: [meta.lng, meta.lat] };
      node.serviceRadiusKm = meta.serviceRadiusKm;
      node.expressEnabled = meta.expressEnabled;
      await node.save();
      nodeByDealer.set(String(dealer._id), node);
      console.log(`  ✅ ${node.name} (${meta.city}, radius ${meta.serviceRadiusKm}km, express ${meta.expressEnabled})`);
    }

    /* ── 4. Products — ONE catalogue document per item ────────────────
           Each product is owned by exactly ONE dealer and has physical
           inventory at exactly that dealer's fulfillment node.

           InventoryItem.fulfillmentNode is the source of truth for where
           the stock physically exists. This makes location testing
           deterministic and prevents every dealer from appearing to stock
           every product. */
    console.log('\n── PRODUCTS + DEALER OFFERS + INVENTORY ───────');
    let productCount = 0, offerCount = 0, inventoryCount = 0;

    for (const p of products) {
      const { ownerIndex, ...productFields } = p;
      const owner = dealers[ownerIndex];

      const product = await Product.create({
        ...productFields,
        dealer: owner._id, // legacy anchor — owning dealer's own listing
      });
      productCount++;
      console.log(`  ✅ ${product.title}`);

      const node = nodeByDealer.get(String(owner._id));
      if (!node) {
        throw new Error(`No fulfillment node found for dealer ${owner.dealerId}`);
      }

      const sellingPrice = Number(p.price);
      const onHand = Math.max(1, Number(p.stock || 0));
      const sku = `${buildSku(product)}-${owner.dealerId}`;

      await DealerOffer.create({
        product: product._id,
        dealer: owner._id,
        sku,
        mrp: p.originalPrice || p.price,
        sellingPrice,
        isActive: true,
        fulfillmentNodes: [node._id],
      });
      offerCount++;

      await InventoryItem.create({
        product: product._id,
        dealer: owner._id,
        fulfillmentNode: node._id,
        sku,
        onHand,
        reserved: 0,
        damaged: 0,
        blocked: 0,
        isActive: true,
      });
      inventoryCount++;

      console.log(`     └─ ${owner.businessName}: ₹${sellingPrice}, ${onHand} units → ${node.name}`);
    }

    /* ── Summary ─────────────────────────────────────────────────────── */
    console.log('\n🎉 Seeding complete!\n');
    console.log('┌─────────────────────┬───────┐');
    console.log('│  Collection         │ Count │');
    console.log('├─────────────────────┼───────┤');
    console.log(`│  Users              │  ${String(2 + dealers.length).padStart(3)}  │`);
    console.log(`│  Categories         │  ${String(categories.length).padStart(3)}  │`);
    console.log(`│  Products (unique)  │  ${String(productCount).padStart(3)}  │`);
    console.log(`│  Fulfillment nodes  │  ${String(dealers.length).padStart(3)}  │`);
    console.log(`│  Dealer offers      │  ${String(offerCount).padStart(3)}  │`);
    console.log(`│  Inventory items    │  ${String(inventoryCount).padStart(3)}  │`);
    console.log('└─────────────────────┴───────┘');

    console.log('\n┌──────────┬──────────────────────────┬──────────────┐');
    console.log('│  Role    │  Email                    │  Password    │');
    console.log('├──────────┼──────────────────────────┼──────────────┤');
    console.log('│  admin   │  admin@tvsauto.com        │  Admin@123   │');
    dealersData.forEach((d) => {
      console.log(`│  dealer  │  ${d.email.padEnd(25)}│  Dealer@123  │`);
    });
    console.log('│  user    │  user@tvsauto.com         │  User@123    │');
    console.log('└──────────┴──────────────────────────┴──────────────┘');
    console.log(`\n👉 Each product has exactly one dealer offer and one physical inventory node.\n`);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

seed();