import Customer from '../models/Customer.js';

export const getCustomers = async (req, res, next) => {
    try {
        const { search } = req.query;
        const customers = await Customer.findByUserId(req.user.id, search);
        res.json(customers);
    } catch (err) {
        next(err);
    }
};

export const getCustomerStats = async (req, res, next) => {
    try {
        const stats = await Customer.getStats(req.user.id);
        res.json(stats);
    } catch (err) {
        next(err);
    }
};

export const getCustomer = async (req, res, next) => {
    try {
        const { id } = req.params;
        const customer = await Customer.findByIdAndUser(id, req.user.id);

        if (!customer) {
            return res.status(404).json({ detail: 'Customer not found' });
        }

        res.json(customer);
    } catch (err) {
        next(err);
    }
};

export const createCustomer = async (req, res, next) => {
    try {
        const { name, phone, email, address, gstin, notes } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ detail: 'Customer name is required' });
        }

        const customer = await Customer.create({
            user_id: req.user.id,
            name,
            phone,
            email,
            address,
            gstin,
            notes
        });

        res.status(201).json(customer);
    } catch (err) {
        next(err);
    }
};

export const updateCustomer = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, phone, email, address, gstin, notes } = req.body;

        const existing = await Customer.findByIdAndUser(id, req.user.id);
        if (!existing) {
            return res.status(404).json({ detail: 'Customer not found' });
        }

        const updated = await Customer.update(id, req.user.id, {
            name,
            phone,
            email,
            address,
            gstin,
            notes
        });

        res.json(updated);
    } catch (err) {
        next(err);
    }
};

export const deleteCustomer = async (req, res, next) => {
    try {
        const { id } = req.params;
        const deleted = await Customer.delete(id, req.user.id);

        if (!deleted) {
            return res.status(404).json({ detail: 'Customer not found' });
        }

        res.json({ message: 'Customer deleted successfully' });
    } catch (err) {
        next(err);
    }
};

export const getCustomerBills = async (req, res, next) => {
    try {
        const { id } = req.params;
        const bills = await Customer.getCustomerBills(id, req.user.id);
        res.json(bills);
    } catch (err) {
        next(err);
    }
};
