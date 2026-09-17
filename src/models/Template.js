import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, deleteById } from '../config/database.js';

export const BUILTIN_TEMPLATES_DEFS = [
    {
        id: "classic",
        templateId: "1",
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
        features: JSON.stringify(["Shop header & GSTIN", "Itemized table (Qty, Rate, Total)", "Tax / GST calculation", "Payment mode & barcode"]),
        is_builtin: 1,
        is_default: 1
    },
    {
        id: "minimal",
        templateId: "2",
        name: "Minimal Clean Bill",
        category: "Minimal",
        badge: "Most Popular",
        width: "58mm",
        show_tax: 0,
        tax_rate: 0.00,
        footer: "Thank you for visiting! Please come again.",
        description: "Streamlined layout engineered to reduce paper roll consumption while maintaining crystal clear readability.",
        gradient: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
        accent_color: "#0ea5e9",
        features: JSON.stringify(["Compact receipt layout", "Large legible totals", "Zero-waste spacing", "Thermal optimized"]),
        is_builtin: 1,
        is_default: 0
    },
    {
        id: "pro",
        templateId: "3",
        name: "Shop Pro",
        category: "Business",
        badge: "Retail Choice",
        width: "80mm",
        show_tax: 1,
        tax_rate: 18.00,
        footer: "Thank you for shopping with us! Please come again.",
        description: "Professional high-volume retail POS receipt with clean column headers, item discounts, and net totals.",
        gradient: "linear-gradient(135deg, #60a5fa 0%, #1d4ed8 100%)",
        accent_color: "#2563eb",
        features: JSON.stringify(["Retail store header", "Itemized table with quantity", "Tax / GST calculation", "Editable footer note"]),
        is_builtin: 1,
        is_default: 0
    },
    {
        id: "eco",
        templateId: "4",
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
        features: JSON.stringify(["58mm compact layout", "Monospace font alignment", "High-density item lines", "Paper saving spacing"]),
        is_builtin: 1,
        is_default: 0
    },
    {
        id: "modern",
        templateId: "5",
        name: "Modern Shop",
        category: "Modern",
        badge: "Trendy",
        width: "58mm",
        show_tax: 0,
        tax_rate: 0.00,
        footer: "Thank you for your visit! Please come again.",
        description: "Contemporary aesthetic for boutiques, cafes, and modern shops with clean typography and spacing.",
        gradient: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)",
        accent_color: "#0ea5e9",
        features: JSON.stringify(["Modern typography", "Clean item list with rates", "Clear amount due card", "Custom footer note"]),
        is_builtin: 1,
        is_default: 0
    },
    {
        id: "elite",
        templateId: "6",
        name: "Business Elite",
        category: "Business",
        badge: "Premium",
        width: "80mm",
        show_tax: 1,
        tax_rate: 18.00,
        footer: "Thank you for your business. Terms & conditions apply.",
        description: "Formal tax invoice template designed for businesses requiring full GST details, itemized totals, and formal terms.",
        gradient: "linear-gradient(135deg, #38bdf8 0%, #0369a1 100%)",
        accent_color: "#0284c7",
        features: JSON.stringify(["Formal Tax Invoice header", "GSTIN & seller details", "Itemized table with rates", "Tax breakdown & totals"]),
        is_builtin: 1,
        is_default: 0
    }
];

export default class Template {
    constructor(data) {
        this.id = data.id || uuidv4();
        this.templateId = data.templateId || data.id;
        this.user_id = data.user_id;
        this.name = data.name || 'Default Receipt';
        this.category = data.category || 'Standard';
        this.badge = data.badge || '';
        this.width = data.width || '58mm';
        this.show_tax = data.show_tax !== undefined ? Boolean(data.show_tax) : true;
        this.tax_rate = Number(data.tax_rate || 0);
        this.footer = data.footer || 'Thank you for shopping with us!';
        this.description = data.description || '';
        this.gradient = data.gradient || '';
        this.accent_color = data.accent_color || '';

        try {
            if (typeof data.features === 'string') {
                this.features = data.features.startsWith('[') ? JSON.parse(data.features) : [data.features];
            } else if (Array.isArray(data.features)) {
                this.features = data.features;
            } else {
                this.features = [];
            }
        } catch (_) {
            this.features = [];
        }

        this.is_builtin = Boolean(data.is_builtin);
        this.is_default = Boolean(data.is_default);
        this.created_at = data.created_at || new Date().toISOString();
        this.updated_at = data.updated_at || new Date().toISOString();
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
        if (template.is_default && template.user_id) {
            await query('UPDATE templates SET is_default = 0 WHERE user_id = ?', [template.user_id]).catch(() => { });
        }

        await insert('templates', template);
        return new Template(template);
    }

    static async seedDefaultTemplates(userId) {
        try {
            const existing = await query('SELECT name FROM templates WHERE user_id = ?', [userId]).catch(() => []);
            const existingNames = new Set((existing || []).map(e => e.name));

            const toInsert = BUILTIN_TEMPLATES_DEFS.filter(t => !existingNames.has(t.name));
            if (toInsert.length > 0) {
                for (const t of toInsert) {
                    await Template.create({ user_id: userId, ...t }).catch(() => null);
                }
            }

            const rows = await query(
                'SELECT * FROM templates WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
                [userId]
            ).catch(() => []);

            if (rows && rows.length > 0) {
                return rows.map(r => new Template(r));
            }
        } catch (err) {
            console.error('⚠️ Template seeding warning:', err.message);
        }

        // Fallback: Return built-in default templates for user
        return BUILTIN_TEMPLATES_DEFS.map(t => new Template({ ...t, user_id: userId }));
    }

    static async findByUserId(userId) {
        try {
            let templates = await query(
                'SELECT * FROM templates WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
                [userId]
            ).catch(() => []);

            if (!templates || templates.length === 0) {
                return await Template.seedDefaultTemplates(userId);
            }

            return templates.map(t => new Template(t));
        } catch (err) {
            console.error('⚠️ Error in Template.findByUserId:', err);
            return BUILTIN_TEMPLATES_DEFS.map(t => new Template({ ...t, user_id: userId }));
        }
    }

    static async findById(id) {
        let data = await queryOne('SELECT * FROM templates WHERE id = ? OR name = ?', [id, id]).catch(() => null);
        if (!data) {
            const keyNameMap = {
                'classic': 'Classic Receipt',
                '1': 'Classic Receipt',
                'minimal': 'Minimal Clean Bill',
                '2': 'Minimal Clean Bill',
                'pro': 'Shop Pro',
                '3': 'Shop Pro',
                'eco': 'Eco Print',
                '4': 'Eco Print',
                'modern': 'Modern Shop',
                '5': 'Modern Shop',
                'elite': 'Business Elite',
                '6': 'Business Elite'
            };
            const mappedName = keyNameMap[String(id).toLowerCase()];
            if (mappedName) {
                data = await queryOne('SELECT * FROM templates WHERE name = ?', [mappedName]).catch(() => null);
            }
        }
        return data ? new Template(data) : null;
    }

    static async findByIdAndUser(id, userId) {
        if (!id) {
            const userTemplates = await Template.findByUserId(userId);
            return userTemplates[0] || new Template({ ...BUILTIN_TEMPLATES_DEFS[0], user_id: userId });
        }

        let data = await queryOne(
            'SELECT * FROM templates WHERE (id = ? OR name = ?) AND user_id = ?',
            [id, id, userId]
        ).catch(() => null);
        if (data) return new Template(data);

        data = await queryOne('SELECT * FROM templates WHERE id = ?', [id]).catch(() => null);
        if (data) return new Template(data);

        const keyNameMap = {
            'classic': 'Classic Receipt',
            '1': 'Classic Receipt',
            'minimal': 'Minimal Clean Bill',
            '2': 'Minimal Clean Bill',
            'pro': 'Shop Pro',
            '3': 'Shop Pro',
            'eco': 'Eco Print',
            '4': 'Eco Print',
            'modern': 'Modern Shop',
            '5': 'Modern Shop',
            'elite': 'Business Elite',
            '6': 'Business Elite'
        };
        const mappedName = keyNameMap[String(id).toLowerCase()];
        if (mappedName) {
            data = await queryOne(
                'SELECT * FROM templates WHERE name = ? AND user_id = ?',
                [mappedName, userId]
            ).catch(() => null);
            if (data) return new Template(data);
        }

        const userTemplates = await Template.findByUserId(userId);
        return userTemplates[0] || new Template({ ...BUILTIN_TEMPLATES_DEFS[0], user_id: userId });
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