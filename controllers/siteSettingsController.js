// controllers/siteSettingsController.js
import SiteSettings from '../models/SiteSettings.js';

/* helper: find an uploaded file by its exact fieldname
   (req.files is a flat array when the route uses upload.any()) */
const findFile = (req, fieldname) =>
  (req.files || []).find(f => f.fieldname === fieldname);

/* ───────────────────────────────────────────────
   GET /api/admin/site-settings
   Public — all frontend pages read this on mount
─────────────────────────────────────────────── */
export const getSettings = async (req, res) => {
  try {
    let settings = await SiteSettings.findOne();
    if (!settings) settings = await SiteSettings.create({});
    res.json(settings);
  } catch (err) {
    console.error('getSettings:', err);
    res.status(500).json({ message: 'Failed to load site settings' });
  }
};

/* ───────────────────────────────────────────────
   POST /api/admin/site-settings
   Admin only · multipart/form-data
   Required body field: section
─────────────────────────────────────────────── */
export const updateSettings = async (req, res) => {
  try {
    const { section } = req.body;
    if (!section) return res.status(400).json({ message: '`section` is required' });

    let settings = await SiteSettings.findOne();
    if (!settings) settings = new SiteSettings({});

    /* ─── NAVBAR ─── */
    if (section === 'navbar') {
      if (!settings.navbar) settings.navbar = {};
      const { promoText, promoVisible, promoColor } = req.body;
      if (promoText    != null) settings.navbar.promoText    = promoText;
      if (promoColor   != null) settings.navbar.promoColor   = promoColor;
      if (promoVisible != null) settings.navbar.promoVisible = promoVisible === 'true' || promoVisible === true;

      const logoFile = findFile(req, 'logoLight');
      if (logoFile) settings.navbar.logoLight = `/uploads/logos/${logoFile.filename}`;

      settings.markModified('navbar');
    }

    /* ─── FOOTER ─── */
    else if (section === 'footer') {
      if (!settings.footer) settings.footer = {};
      const { tagline, columns, socials, bottom, bgColor } = req.body;

      if (tagline != null) settings.footer.tagline = tagline;
      if (columns != null) settings.footer.columns = JSON.parse(columns);
      if (socials != null) settings.footer.socials = JSON.parse(socials);
      if (bottom  != null) settings.footer.bottom  = JSON.parse(bottom);
      if (bgColor != null) settings.footer.bgColor = bgColor;

      const footerLogoFile = findFile(req, 'footerLogo');
      if (footerLogoFile) settings.footer.logo = `/uploads/logos/${footerLogoFile.filename}`;

      settings.markModified('footer');
    }

    /* ─── DEALER PAGE ─── */
    else if (section === 'dealerPage') {
      if (!settings.dealerPage) settings.dealerPage = {};
      const {
        heroTitle, heroSubtitle, heroBgType, heroBgColor,
        heroBadges, whyTitle, whySubtitle, benefits,
      } = req.body;
      if (heroTitle    != null) settings.dealerPage.heroTitle    = heroTitle;
      if (heroSubtitle != null) settings.dealerPage.heroSubtitle = heroSubtitle;
      if (heroBgType   != null) settings.dealerPage.heroBgType   = heroBgType;
      if (heroBgColor  != null) settings.dealerPage.heroBgColor  = heroBgColor;
      if (heroBadges   != null) settings.dealerPage.heroBadges   = JSON.parse(heroBadges);
      if (whyTitle     != null) settings.dealerPage.whyTitle     = whyTitle;
      if (whySubtitle  != null) settings.dealerPage.whySubtitle  = whySubtitle;
      if (benefits     != null) settings.dealerPage.benefits     = JSON.parse(benefits);

      const heroBgFile = findFile(req, 'heroBgImage');
      if (heroBgFile) settings.dealerPage.heroBgImage = `/uploads/site/${heroBgFile.filename}`;

      settings.markModified('dealerPage');
    }

    /* ─── CUSTOMER CARE ─── */
    else if (section === 'customerCare') {
      if (!settings.customerCare) settings.customerCare = {};
      const cc = settings.customerCare;
      const {
        heroTitle, heroSubtitle, heroBgColor,
        channelsTitle, channelsSubtitle, channels,
        faqTitle, faqSubtitle, faqs,
        formTitle, formSubtitle, formEmail,
        ctaTitle, ctaSubtitle, ctaBgType, ctaBgColor,
        ctaPhone, ctaEmail, ctaHours,
      } = req.body;

      if (heroTitle        != null) cc.heroTitle        = heroTitle;
      if (heroSubtitle     != null) cc.heroSubtitle     = heroSubtitle;
      if (heroBgColor      != null) cc.heroBgColor      = heroBgColor;
      if (channelsTitle    != null) cc.channelsTitle    = channelsTitle;
      if (channelsSubtitle != null) cc.channelsSubtitle = channelsSubtitle;
      if (channels         != null) cc.channels         = JSON.parse(channels);
      if (faqTitle         != null) cc.faqTitle         = faqTitle;
      if (faqSubtitle      != null) cc.faqSubtitle      = faqSubtitle;
      if (faqs             != null) cc.faqs             = JSON.parse(faqs);
      if (formTitle        != null) cc.formTitle        = formTitle;
      if (formSubtitle     != null) cc.formSubtitle     = formSubtitle;
      if (formEmail        != null) cc.formEmail        = formEmail;
      if (ctaTitle         != null) cc.ctaTitle         = ctaTitle;
      if (ctaSubtitle      != null) cc.ctaSubtitle      = ctaSubtitle;
      if (ctaBgType        != null) cc.ctaBgType        = ctaBgType;
      if (ctaBgColor       != null) cc.ctaBgColor       = ctaBgColor;
      if (ctaPhone         != null) cc.ctaPhone         = ctaPhone;
      if (ctaEmail         != null) cc.ctaEmail         = ctaEmail;
      if (ctaHours         != null) cc.ctaHours         = ctaHours;

      const ctaBgFile = findFile(req, 'ctaBgImage');
      if (ctaBgFile) cc.ctaBgImage = `/uploads/site/${ctaBgFile.filename}`;

      settings.markModified('customerCare');
    }

    /* ─── HOMEPAGE ─── */
    else if (section === 'homepage') {
      if (!settings.homepage) settings.homepage = {};
      const hp = settings.homepage;
      const { banners, badges, sections: sectionsText } = req.body;

      if (banners != null) {
        const parsed = JSON.parse(banners);
        // match each banner's uploaded file (bannerImage_<key>) back by bgImageKey
        hp.banners = parsed.map(b => {
          const { bgImageKey, ...rest } = b;
          if (bgImageKey) {
            const file = findFile(req, `bannerImage_${bgImageKey}`);
            if (file) rest.bgImage = `/uploads/site/${file.filename}`;
          }
          return rest;
        });
      }

      if (badges != null) hp.badges = JSON.parse(badges);
      if (sectionsText != null) hp.sections = JSON.parse(sectionsText);

      settings.markModified('homepage');
    }

    /* ─── LOGIN / REGISTER (authPage) ─── */
    else if (section === 'authPage') {
      if (!settings.authPage) settings.authPage = {};
      const ap = settings.authPage;
      const { loginHeading, loginSubtitle, registerHeading, registerSubtitle } = req.body;

      if (loginHeading     != null) ap.loginHeading     = loginHeading;
      if (loginSubtitle    != null) ap.loginSubtitle    = loginSubtitle;
      if (registerHeading  != null) ap.registerHeading  = registerHeading;
      if (registerSubtitle != null) ap.registerSubtitle = registerSubtitle;

      const logoFile = findFile(req, 'logoImage');
      if (logoFile) ap.logoImage = `/uploads/logos/${logoFile.filename}`;

      settings.markModified('authPage');
    }

    else {
      return res.status(400).json({ message: `Unknown section: "${section}"` });
    }

    settings.updatedAt = new Date();
    await settings.save();
    res.json({ message: 'Settings saved', settings });
  } catch (err) {
    console.error('updateSettings:', err);
    res.status(500).json({ message: err.message || 'Failed to save settings' });
  }
};