import mongoose from 'mongoose';

const subCategorySchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  slug:     { type: String, required: true, trim: true, lowercase: true },
  order:    { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { _id: true });

const categorySchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  slug:        { type: String, required: true, trim: true, lowercase: true, unique: true },
  icon:        { type: String, default: '' },          // emoji or icon name
  description: { type: String, default: '' },
  navOrder:    { type: Number, default: 0 },           // display order in navbar
  isActive:    { type: Boolean, default: true },
  showInNav:   { type: Boolean, default: true },
  showInFooter:{ type: Boolean, default: true },
  subCategories: [subCategorySchema],
}, { timestamps: true });

// Auto-generate slug from name if not provided
categorySchema.pre('save', function (next) {
  if (!this.slug && this.name) {
    this.slug = this.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }
  next();
});

const Category = mongoose.model('Category', categorySchema);
export default Category;