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

    static async getMasterTemplates() {
        try {
            const rows = await query('SELECT * FROM templates ORDER BY created_at ASC');
            if (rows && rows.length > 0) {
                return rows.map(r => new Template(r));
            }
        } catch (err) {
            console.error('⚠️ Error in Template.getMasterTemplates:', err);
        }
        return BUILTIN_TEMPLATES_DEFS.map(t => new Template(t));
    }

    static async findByUserId(userId) {
        // Templates table represents the master catalog, so all users access the master templates
        return await Template.getMasterTemplates();
    }

    static async findById(id) {
        if (!id) return null;
        let data = await queryOne('SELECT * FROM templates WHERE id = ? OR name = ?', [id, id]).catch(() => null);
        if (!data) {
            const keyNameMap = {
                'classic': 'Classic Receipt',
                '1': 'Classic Receipt',
                '0442d846-0a89-4d90-800a-48278ec089d7': 'Classic Receipt',
                'minimal': 'Minimal Clean Bill',
                '2': 'Minimal Clean Bill',
                'bcaa2c28-0aeb-468e-8789-d5edfd2eee0c': 'Minimal Clean Bill',
                'pro': 'Shop Pro',
                '3': 'Shop Pro',
                'b55d6642-d218-43c3-b8a8-918e87d9712d': 'Shop Pro',
                'eco': 'Eco Print',
                '4': 'Eco Print',
                'cc510d5f-07bf-4ce4-8c50-6ec1995c85f4': 'Eco Print',
                'modern': 'Modern Shop',
                '5': 'Modern Shop',
                '4638c377-7094-4325-bf15-eb7c6de54ff6': 'Modern Shop',
                'elite': 'Business Elite',
                '6': 'Business Elite',
                'ee17a09d-5b86-47bc-b862-2fc6bbcba2b9': 'Business Elite'
            };
            const mappedName = keyNameMap[String(id).toLowerCase()];
            if (mappedName) {
                data = await queryOne('SELECT * FROM templates WHERE name = ?', [mappedName]).catch(() => null);
            }
        }
        if (!data) {
            const sId = String(id).toLowerCase().trim();
            const builtin = BUILTIN_TEMPLATES_DEFS.find(t => 
                String(t.id).toLowerCase() === sId ||
                String(t.templateId).toLowerCase() === sId ||
                String(t.name).toLowerCase() === sId ||
                String(t.name).toLowerCase().includes(sId)
            );
            if (builtin) return new Template(builtin);
        }
        return data ? new Template(data) : null;
    }

    static async findByIdAndUser(id, userId) {
        if (!id) {
            const master = await Template.getMasterTemplates();
            return master.find(t => t.is_default) || master[0];
        }

        const template = await Template.findById(id);
        if (template) return template;

        const userTemplates = await Template.findByUserId(userId);
        if (Array.isArray(userTemplates) && userTemplates.length > 0) {
            const sId = String(id).toLowerCase().trim();
            const matched = userTemplates.find(t => 
                String(t.id).toLowerCase() === sId ||
                String(t.templateId).toLowerCase() === sId ||
                String(t.name).toLowerCase() === sId ||
                String(t.name).toLowerCase().includes(sId)
            );
            if (matched) return matched;
        }

        const master = await Template.getMasterTemplates();
        return master.find(t => t.is_default) || master[0];
    }

    static async deleteById(id, userId) {
        const template = await Template.findById(id);
        if (!template) return false;

        if (template.is_default) {
            throw new Error('Cannot delete default template');
        }

        return await deleteById('templates', id);
    }
}