import ContactSubmission from '../models/ContactSubmission.js';

export const createContactSubmission = async (req, res, next) => {
  try {
    const { name, email, phone, topic, message } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ detail: 'Name is required' });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({ detail: 'Email address is required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ detail: 'Please enter a valid email address (e.g. name@example.com)' });
    }

    if (phone && phone.trim()) {
      const trimmedPhone = phone.trim();
      const phoneDigits = trimmedPhone.replace(/\D/g, '');
      const isValid10Digit = phoneDigits.length === 10 || (phoneDigits.length === 12 && phoneDigits.startsWith('91'));
      if (!isValid10Digit) {
        return res.status(400).json({ detail: 'Please enter a valid 10-digit mobile number' });
      }
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ detail: 'Message is required' });
    }

    const submission = await ContactSubmission.create({
      user_id: req.user?.id || null,
      name,
      email,
      phone,
      topic,
      message
    });

    res.status(201).json({
      message: 'Contact submission saved successfully',
      submission
    });
  } catch (err) {
    next(err);
  }
};

export const getContactSubmissions = async (req, res, next) => {
  try {
    const submissions = await ContactSubmission.findAll();
    res.json(submissions);
  } catch (err) {
    next(err);
  }
};
