import Template, { BUILTIN_TEMPLATES_DEFS } from '../models/Template.js';

export const getTemplates = async (req, res, next) => {
  try {
    if (req.user && req.user.id) {
      const templates = await Template.findByUserId(req.user.id);
      return res.json(templates);
    }
    return res.json(BUILTIN_TEMPLATES_DEFS);
  } catch (err) {
    next(err);
  }
};

export const createTemplate = async (req, res, next) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        detail: 'Template name is required'
      });
    }

    const template = await Template.create({
      user_id: req.user.id,
      name: name.trim()
    });

    res.status(201).json(template);
  } catch (err) {
    next(err);
  }
};

export const duplicateTemplate = async (req, res, next) => {
  try {
    const { id } = req.params;

    const original = await Template.findByIdAndUser(
      id,
      req.user.id
    );

    if (!original) {
      return res.status(404).json({
        detail: 'Template not found'
      });
    }

    const template = await Template.create({
      user_id: req.user.id,
      name: `${original.name} (Copy)`,
      width: original.width,
      show_tax: original.show_tax,
      tax_rate: original.tax_rate,
      footer: original.footer,
      is_default: false
    });

    res.status(201).json(template);
  } catch (err) {
    next(err);
  }
};

export const deleteTemplate = async (req, res, next) => {
  try {
    const { id } = req.params;

    const deleted = await Template.deleteById(
      id,
      req.user.id
    );

    if (!deleted) {
      return res.status(404).json({
        detail: 'Template not found'
      });
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};