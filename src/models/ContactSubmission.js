import { v4 as uuidv4 } from 'uuid';
import { insert, query } from '../config/database.js';

export default class ContactSubmission {
    constructor(data) {
        this.id = data.id || uuidv4();
        this.user_id = data.user_id || null;
        this.name = data.name;
        this.email = data.email;
        this.phone = data.phone || '';
        this.topic = data.topic || 'general';
        this.message = data.message;
        this.created_at = data.created_at;
    }

    static async create(data) {
        const record = {
            id: uuidv4(),
            user_id: data.user_id || null,
            name: data.name.trim(),
            email: data.email.trim().toLowerCase(),
            phone: data.phone?.trim() || '',
            topic: data.topic?.trim() || 'general',
            message: data.message.trim(),
            created_at: new Date().toISOString()
        };
        await insert('contact_submissions', record);
        return new ContactSubmission(record);
    }

    static async findAll() {
        const rows = await query('SELECT * FROM contact_submissions ORDER BY created_at DESC');
        return rows.map(r => new ContactSubmission(r));
    }
}
