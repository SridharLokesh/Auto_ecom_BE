import Category from '../models/Category.js';

const makeSlug = (str) =>
  str.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

// ── PUBLIC ────────────────────────────────────────────────────────────

// GET /api/categories
export const getCategories = async (req, res) => {
  try {
    const query = { isActive: true };
    if (req.query.nav    === 'true') query.showInNav    = true;
    if (req.query.footer === 'true') query.showInFooter = true;
    const cats = await Category.find(query).sort('navOrder');
    res.json(cats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/categories/:slug
export const getCategoryBySlug = async (req, res) => {
  try {
    const cat = await Category.findOne({ slug: req.params.slug, isActive: true });
    if (!cat) return res.status(404).json({ message: 'Category not found' });
    res.json(cat);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── ADMIN ─────────────────────────────────────────────────────────────

// GET /api/categories/admin/all
export const getAllCategories = async (req, res) => {
  try {
    const cats = await Category.find().sort('navOrder');
    res.json(cats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/categories
export const createCategory = async (req, res) => {
  try {
    const { name, icon, description, navOrder, showInNav, showInFooter, subCategories } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Name is required' });

    const slug = makeSlug(name);
    const exists = await Category.findOne({ slug });
    if (exists) return res.status(400).json({ message: 'A category with this name already exists' });

    const subs = (subCategories || []).map((s, i) => ({
      name:     s.name.trim(),
      slug:     makeSlug(s.name),
      order:    s.order ?? i,
      isActive: s.isActive ?? true,
    }));

    const cat = await Category.create({
      name: name.trim(),
      slug,
      icon:         icon         || '',
      description:  description  || '',
      navOrder:     navOrder     ?? 0,
      showInNav:    showInNav    ?? true,
      showInFooter: showInFooter ?? true,
      subCategories: subs,
    });
    res.status(201).json(cat);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'Category already exists' });
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/categories/:id
export const updateCategory = async (req, res) => {
  try {
    const { name, icon, description, navOrder, showInNav, showInFooter, isActive, subCategories } = req.body;
    const cat = await Category.findById(req.params.id);
    if (!cat) return res.status(404).json({ message: 'Category not found' });

    if (name && name.trim() !== cat.name) {
      cat.name = name.trim();
      cat.slug = makeSlug(name);
    }
    if (icon         !== undefined) cat.icon         = icon;
    if (description  !== undefined) cat.description  = description;
    if (navOrder     !== undefined) cat.navOrder      = navOrder;
    if (showInNav    !== undefined) cat.showInNav     = showInNav;
    if (showInFooter !== undefined) cat.showInFooter  = showInFooter;
    if (isActive     !== undefined) cat.isActive      = isActive;

    if (subCategories !== undefined) {
      cat.subCategories = subCategories.map((s, i) => ({
        _id:      s._id,
        name:     s.name.trim(),
        slug:     s.slug || makeSlug(s.name),
        order:    s.order ?? i,
        isActive: s.isActive ?? true,
      }));
    }

    await cat.save();
    res.json(cat);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/categories/:id
export const deleteCategory = async (req, res) => {
  try {
    const cat = await Category.findByIdAndDelete(req.params.id);
    if (!cat) return res.status(404).json({ message: 'Category not found' });
    res.json({ message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/categories/reorder   body: { order: [{ _id, navOrder }] }
export const reorderCategories = async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ message: 'order must be an array' });
    await Promise.all(
      order.map(({ _id, navOrder }) => Category.findByIdAndUpdate(_id, { navOrder }))
    );
    res.json({ message: 'Order saved' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};