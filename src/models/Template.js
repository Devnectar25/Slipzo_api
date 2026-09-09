import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, deleteById } from '../config/database.js';

export default class Template {
    constructor(data) {
        this.id = data.id || uuidv4();
        this.user_id = data.user_id;
        this.name = data.name;
        this.width = data.width || '58mm';
        this.show_tax = data.show_tax !== undefined ? data.show_tax : true;
        this.tax_rate = data.tax_rate || 18;
        this.footer = data.footer || 'Thank you for shopping with us!'; // Default in code
        this.is_default = data.is_default || false;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }

    static async create(templateData) {
        const template = {
            id: uuidv4(),
            ...templateData,
            is_default: templateData.is_default || false,
            footer: templateData.footer || 'Thank you for shopping with us!' // Default in code
        };

        // If setting as default, unset other defaults
        if (template.is_default) {
            await query('UPDATE templates SET is_default = FALSE WHERE user_id = ?', [template.user_id]);
        }

        await insert('templates', template);
        return new Template(template);
    }

    static async findByUserId(userId) {
        const templates = await query(
            'SELECT * FROM templates WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
            [userId]
        );
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
        // Check if default template
        const template = await Template.findByIdAndUser(id, userId);
        if (!template) return false;
        
        if (template.is_default) {
            throw new Error('Cannot delete default template');
        }

        return await deleteById('templates', id);
    }
}