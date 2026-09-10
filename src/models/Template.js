import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, deleteById } from '../config/database.js';

export const BUILTIN_TEMPLATES_DEFS = [
  {
    name: "Classic Receipt",
    category: "Standard",
    badge: "Standard",
    width: "58mm",
    show_tax: 1,
    tax_rate: 18.00,
    footer: "Thank you for shopping with us! Please come again.",
    description: "Clean and professional receipt template with itemized table, GST breakdown, and clear totals.",
    gradient: "linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)",
    accent_color: "#0284c7",
    features: JSON.stringify(["Shop logo header", "Itemized list with quantity", "Tax / GST calculation", "Payment mode badge"]),
    is_builtin: 1,
    is_default: 1
  },
  {
    name: "Minimal Clean Bill",
    category: "Minimal",
    badge: "Most Popular",
    width: "58mm",
    show_tax: 0,
    tax_rate: 0.00,
    footer: "Thank you for visiting Minimal Cafe!",
    description: "Streamlined layout engineered to reduce paper roll consumption while maintaining crystal clear readability.",
    gradient: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
    accent_color: "#0ea5e9",
    features: JSON.stringify(["Compact receipt layout", "Large legible totals", "Zero-waste spacing", "Thermal optimized"]),
    is_builtin: 1,
    is_default: 0
  },
  {
    name: "Shop Pro",
    category: "Business",
    badge: "Retail Choice",
    width: "80mm",
    show_tax: 1,
    tax_rate: 18.00,
    footer: "★ You earned 60 Loyalty Points with this purchase!",
    description: "Professional high-volume retail template with loyalty points display, item discounts, and payment QR code.",
    gradient: "linear-gradient(135deg, #60a5fa 0%, #1d4ed8 100%)",
    accent_color: "#2563eb",
    features: JSON.stringify(["Brand accent header", "Discount highlight tags", "Loyalty rewards counter", "Dynamic UPI QR code"]),
    is_builtin: 1,
    is_default: 0
  },
  {
    name: "Eco Print",
    category: "Thermal",
    badge: "Paper Saver",
    width: "58mm",
    show_tax: 0,
    tax_rate: 0.00,
    footer: "Save paper, save trees! Thank you.",
    description: "Ultra-compact monospace thermal bill layout engineered specifically to maximize speed and minimize roll paper consumption.",
    gradient: "linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)",
    accent_color: "#0d9488",
    features: JSON.stringify(["Fast thermal printing", "Monospace font alignment", "High-density item lines", "Less paper usage"]),
    is_builtin: 1,
    is_default: 0
  },
  {
    name: "Modern Shop",
    category: "Modern",
    badge: "Trendy",
    width: "58mm",
    show_tax: 0,
    tax_rate: 0.00,
    footer: "Tag us on Instagram @luminabeauty for 10% off next visit!",
    description: "Contemporary aesthetic for boutiques, cafes, and salons with pill badges, stylish spacing, and Instagram handle.",
    gradient: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)",
    accent_color: "#0ea5e9",
    features: JSON.stringify(["Modern typography", "Category pill badges", "Social media footer", "Clean spacing"]),
    is_builtin: 1,
    is_default: 0
  },
  {
    name: "Business Elite",
    category: "Business",
    badge: "Premium",
    width: "80mm",
    show_tax: 1,
    tax_rate: 18.00,
    footer: "Thank you for your business. Terms & conditions apply.",
    description: "Formal tax invoice template designed for electronics, hardware, and B2B services requiring HSN, CGST/SGST & signature.",
    gradient: "linear-gradient(135deg, #38bdf8 0%, #0369a1 100%)",
    accent_color: "#0284c7",
    features: JSON.stringify(["HSN / SAC Code column", "Split CGST & SGST", "Authorized signatory box", "Terms & conditions"]),
    is_builtin: 1,
    is_default: 0
  }
];

export default class Template {
    constructor(data) {
        this.id = data.id || uuidv4();
        this.user_id = data.user_id;
        this.name = data.name;
        this.category = data.category || 'Standard';
        this.badge = data.badge || '';
        this.width = data.width || '58mm';
        this.show_tax = data.show_tax !== undefined ? Boolean(data.show_tax) : true;
        this.tax_rate = Number(data.tax_rate || 0);
        this.footer = data.footer || 'Thank you for shopping with us!';
        this.description = data.description || '';
        this.gradient = data.gradient || '';
        this.accent_color = data.accent_color || '';
        this.features = typeof data.features === 'string' ? (data.features.startsWith('[') ? JSON.parse(data.features) : data.features) : (data.features || []);
        this.is_builtin = Boolean(data.is_builtin);
        this.is_default = Boolean(data.is_default);
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }

    static async create(templateData) {
        const template = {
            id: uuidv4(),
            ...templateData,
            is_default: templateData.is_default || false,
            footer: templateData.footer || 'Thank you for shopping with us!'
        };

        if (template.features && typeof template.features !== 'string') {
            template.features = JSON.stringify(template.features);
        }

        // If setting as default, unset other defaults
        if (template.is_default) {
            await query('UPDATE templates SET is_default = FALSE WHERE user_id = ?', [template.user_id]);
        }

        await insert('templates', template);
        return new Template(template);
    }

    static async seedDefaultTemplates(userId) {
        for (const t of BUILTIN_TEMPLATES_DEFS) {
            const check = await queryOne(
                'SELECT id FROM templates WHERE user_id = ? AND name = ?',
                [userId, t.name]
            );
            if (!check) {
                await Template.create({
                    user_id: userId,
                    ...t
                });
            }
        }
        return await Template.findByUserId(userId);
    }

    static async findByUserId(userId) {
        let templates = await query(
            'SELECT * FROM templates WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
            [userId]
        );

        if (!templates || templates.length === 0) {
            templates = await Template.seedDefaultTemplates(userId);
            return templates;
        }

        return templates.map(t => new Template(t));
    }

    static async findById(id) {
        const data = await queryOne('SELECT * FROM templates WHERE id = ?', [id]);
        return data ? new Template(data) : null;
    }

    static async findByIdAndUser(id, userId) {
        const data = await queryOne(
            'SELECT * FROM templates WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        return data ? new Template(data) : null;
    }

    static async deleteById(id, userId) {
        const template = await Template.findByIdAndUser(id, userId);
        if (!template) return false;
        
        if (template.is_default) {
            throw new Error('Cannot delete default template');
        }

        return await deleteById('templates', id);
    }
}