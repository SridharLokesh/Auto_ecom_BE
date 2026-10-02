// models/SiteSettings.js
import mongoose from 'mongoose';

/* ─── footer sub-schemas ─── */
const footerItemSchema = new mongoose.Schema(
  { label: String, href: String },
  { _id: false }
);
const footerColumnSchema = new mongoose.Schema(
  {
    id:          String,
    type:        { type: String, enum: ['brand', 'links', 'contact'], default: 'links' },
    title:       String,
    enabled:     { type: Boolean, default: true },
    items:       { type: [footerItemSchema], default: [] },
    phone:       String,
    phoneNote:   String,
    email:       String,
    emailNote:   String,
    address:     String,
    addressNote: String,
  },
  { _id: false }
);

/* ─── dealer page sub-schemas ─── */
const dealerBadgeSchema = new mongoose.Schema(
  { text: { type: String, default: '' } },
  { _id: false }
);
const dealerBenefitSchema = new mongoose.Schema(
  {
    icon:  { type: String, default: 'TrendingUp' },
    title: { type: String, default: '' },
    desc:  { type: String, default: '' },
  },
  { _id: false }
);

/* ─── customer-care sub-schemas ─── */
const supportChannelSchema = new mongoose.Schema(
  {
    icon:      { type: String, default: 'Phone' },
    title:     { type: String, default: '' },
    primary:   { type: String, default: '' },
    secondary: { type: String, default: '' },
    desc:      { type: String, default: '' },
  },
  { _id: false }
);
const faqSchema = new mongoose.Schema(
  {
    q: { type: String, default: '' },
    a: { type: String, default: '' },
  },
  { _id: false }
);

/* ─── homepage sub-schemas ─── */
const homeBannerSchema = new mongoose.Schema(
  {
    title:    { type: String, default: '' },
    subtitle: { type: String, default: '' },
    btn:      { type: String, default: 'Shop Now' },
    catSlug:  { type: String, default: '' },
    bgType:   { type: String, enum: ['gradient', 'image'], default: 'gradient' },
    bgFrom:   { type: String, default: '#0a1f44' },
    bgTo:     { type: String, default: '#334155' },
    bgImage:  { type: String, default: null },
  },
  { _id: false }
);
const homeBadgeSchema = new mongoose.Schema(
  {
    icon:  { type: String, default: 'Star' },
    title: { type: String, default: '' },
    sub:   { type: String, default: '' },
    bg:    { type: String, default: '#eff6ff' },
    ic:    { type: String, default: '#0a1f44' },
  },
  { _id: false }
);

/* ─── main schema ─── */
const siteSettingsSchema = new mongoose.Schema(
  {
    /* ── Navbar ── */
    navbar: {
      promoText:    { type: String,  default: 'Genuine TVS Parts & Accessories — Free shipping above ₹999 — 1 Year Warranty on all parts' },
      promoVisible: { type: Boolean, default: true  },
      promoColor:   { type: String,  default: '#de1c0e' },
      logoLight:    { type: String,  default: '' },
    },

    /* ── Footer ── */
    footer: {
      logo: { type: String, default: '' },

      tagline: {
        type: String,
        default: 'Official online store for genuine TVS spare parts, accessories and lubricants. Quality assured. Warranty backed.',
      },

      bgColor: {
        type: String,
        default: '#0a1f44',
      },

      columns: {
        type: [footerColumnSchema],
        default: [],
      },

      socials: {
        facebook: { type: String, default: '#' },
        twitter: { type: String, default: '#' },
        instagram: { type: String, default: '#' },
        youtube: { type: String, default: '#' },
      },

      bottom: {
        certified: { type: String, default: 'OEM Certified Parts' },
        secure: { type: String, default: 'Secure Checkout' },
        warranty: { type: String, default: '1 Year Warranty' },
      },
    },

    /* ── Become a Dealer page ── */
    dealerPage: {
      heroTitle:    { type: String, default: 'Become a TVS Dealer' },
      heroSubtitle: { type: String, default: "Partner with India's leading two-wheeler brand. Sell genuine TVS parts and grow your business." },
      heroBgType:   { type: String, enum: ['color', 'image'], default: 'color' },
      heroBgColor:  { type: String, default: '#0a1f44' },
      heroBgImage:  { type: String, default: '' },
      heroBadges:   {
        type: [dealerBadgeSchema],
        default: [
          { text: 'No Joining Fee' },
          { text: '4,000+ Partners Across India' },
          { text: 'Your Own Dashboard' },
        ],
      },
      whyTitle:    { type: String, default: 'Why Partner With Us?' },
      whySubtitle: { type: String, default: 'Everything you need to build a successful parts dealership' },
      benefits:    {
        type: [dealerBenefitSchema],
        default: [
          { icon: 'TrendingUp', title: 'Earn More Revenue',    desc: 'Access TVS customer base and earn consistent income from spare parts sales.' },
          { icon: 'Shield',     title: 'Official Partnership', desc: 'Become an authorised TVS dealer with official credentials and branding.' },
          { icon: 'Store',      title: 'Your Own Dashboard',   desc: 'Manage products, track orders and monitor revenue all in one place.' },
          { icon: 'Users',      title: 'Dedicated Support',    desc: 'Priority support from our dealer relations team and training materials.' },
        ],
      },
    },

    /* ── Customer Care / 24×7 Helpline page ── */
    customerCare: {
      heroTitle:        { type: String, default: '24 × 7 Customer Support' },
      heroSubtitle:     { type: String, default: 'Expert help for genuine TVS parts, orders, delivery and service — any time, any day.' },
      heroBgColor:      { type: String, default: '#0a1f44' },

      channelsTitle:    { type: String, default: 'Contact Us' },
      channelsSubtitle: { type: String, default: 'Choose the channel that works best for you' },
      channels: {
        type: [supportChannelSchema],
        default: [
          { icon: 'Phone',         title: 'Call Support',      primary: '1800-258-6454',        secondary: 'Toll-free · 24 × 7',       desc: 'Speak directly with a TVS parts specialist' },
          { icon: 'Mail',          title: 'Email Support',     primary: 'parts@tvsmotors.com',  secondary: 'Reply within 2–4 hours',   desc: 'Send your query, order ID or invoice' },
          { icon: 'MessageCircle', title: 'Live Chat',         primary: 'Available on Website', secondary: 'Avg. response: 2 minutes', desc: 'Instant help from a support agent' },
          { icon: 'Wrench',        title: 'Service Centre',    primary: 'Locate Nearest Centre',secondary: '4,000+ centres across India', desc: 'For installation, repair and diagnostics' },
        ],
      },

      faqTitle:    { type: String, default: 'Frequently Asked Questions' },
      faqSubtitle: { type: String, default: 'Quick answers to common queries about TVS parts & orders' },
      faqs: {
        type: [faqSchema],
        default: [
          { q: 'How do I check if a part is compatible with my TVS bike?', a: 'Use the model search on our website. Enter your bike model and compatible parts will be listed.' },
          { q: 'Are all parts on this store genuine TVS parts?',            a: 'Yes. Every part sold here is 100% genuine, sourced directly from TVS Motor Company.' },
          { q: 'How do I track my parts order?',                            a: 'Go to My Orders in your profile. Each order shows real-time tracking.' },
          { q: 'What is the return policy for spare parts?',                a: 'We offer a 10-day return policy for unused, unopened parts in original packaging.' },
          { q: 'Can I cancel my order?',                                    a: 'Orders can be cancelled before they are shipped. Go to My Orders and click Cancel Order.' },
        ],
      },

      formTitle:    { type: String, default: 'Send Us a Message' },
      formSubtitle: { type: String, default: 'Fill the form and our team will respond within 2–4 hours' },
      formEmail:    { type: String, default: 'parts@tvsmotors.com' },

      ctaTitle:    { type: String, default: 'Still need help?' },
      ctaSubtitle: { type: String, default: 'Our senior technical team handles escalated queries with priority turnaround.' },
      ctaBgType:   { type: String, enum: ['color', 'image'], default: 'color' },
      ctaBgColor:  { type: String, default: '#0a1f44' },
      ctaBgImage:  { type: String, default: '' },
      ctaPhone:    { type: String, default: '1800-258-6454' },
      ctaEmail:    { type: String, default: 'parts@tvsmotors.com' },
      ctaHours:    { type: String, default: '24 × 7 × 365' },
    },

    /* ── Home Page ── */
    homepage: {
      banners: {
        type: [homeBannerSchema],
        default: [
          { title: 'Genuine TVS Engine Parts', subtitle: 'OEM-certified parts for peak performance', btn: 'Shop Engine Parts', catSlug: 'engine-parts', bgType: 'gradient', bgFrom: '#0a1f44', bgTo: '#334155' },
          { title: 'Brake & Safety Components', subtitle: 'Stop safely with certified TVS brake systems', btn: 'Shop Brakes', catSlug: 'brakes', bgType: 'gradient', bgFrom: '#0f172a', bgTo: '#0a1f44' },
          { title: 'TVS Accessories Sale', subtitle: 'Personalise your ride — up to 40% off', btn: 'Shop Accessories', catSlug: 'accessories', bgType: 'gradient', bgFrom: '#0d2657', bgTo: '#1e293b' },
        ],
      },
      badges: {
        type: [homeBadgeSchema],
        default: [
          { icon: 'Truck',      title: 'Free Delivery',  sub: 'Orders above ₹999',   bg: '#eff6ff', ic: '#0a1f44' },
          { icon: 'Shield',     title: '100% Genuine',   sub: 'OEM certified parts', bg: '#f8fafc', ic: '#0a1f44' },
          { icon: 'RotateCcw',  title: '10-Day Returns', sub: 'Hassle-free policy',  bg: '#f9fafb', ic: '#0a1f44' },
          { icon: 'Headphones', title: '24×7 Support',   sub: '1800-258-6454',       bg: '#eff6ff', ic: '#0a1f44' },
        ],
      },
      sections: {
        categoriesTitle:     { type: String, default: 'Shop by Category' },
        categoriesSubtitle:  { type: String, default: 'Genuine parts for every TVS model' },
        featuredTitle:       { type: String, default: 'Featured Parts' },
        featuredSubtitle:    { type: String, default: 'Top-selling genuine TVS components' },
        recommendedTitle:    { type: String, default: 'Recommended For You' },
        recommendedSubtitle: { type: String, default: 'Parts picked based on popular models' },
        promoBadge:          { type: String, default: 'TVS Assured Quality' },
        promoHeadingLine1:   { type: String, default: 'Every Part. Every Ride.' },
        promoHeadingLine2:   { type: String, default: 'Guaranteed.' },
        promoDescription:    { type: String, default: 'All parts carry a 1-year manufacturer warranty and pass 200+ quality checks.' },
        promoButtonText:     { type: String, default: 'Browse All Parts' },
      },
    },

    /* ── Login / Register page ── */
    authPage: {
      logoImage:        { type: String, default: '' },
      loginHeading:      { type: String, default: 'Sign in to your account' },
      loginSubtitle:     { type: String, default: 'Access genuine TVS parts and accessories' },
      registerHeading:   { type: String, default: 'Create your account' },
      registerSubtitle:  { type: String, default: 'Join TVS Motors — Official Parts Store' },
    },

    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'sitesettings' }
);

export default mongoose.model('SiteSettings', siteSettingsSchema);