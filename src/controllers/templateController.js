import Template, { BUILTIN_TEMPLATES_DEFS } from '../models/Template.js';

export const getTemplates = async (req, res, next) => {
  try {
    const templates = await Template.getMasterTemplates();
    return res.json(templates);
  } catch (err) {
    next(err);
  }
};

export const createTemplate = async (req, res, next) => {
  try {
    return res.status(403).json({
      detail: 'Templates table is reserved for the Master Catalog only. Manage templates via Admin Panel.'
    });
  } catch (err) {
    next(err);
  }
};

export const duplicateTemplate = async (req, res, next) => {
  try {
    return res.status(403).json({
      detail: 'Templates table is reserved for the Master Catalog only. Manage templates via Admin Panel.'
    });
  } catch (err) {
    next(err);
  }
};

export const deleteTemplate = async (req, res, next) => {
  try {
    return res.status(403).json({
      detail: 'Templates table is reserved for the Master Catalog only. Manage templates via Admin Panel.'
    });
  } catch (err) {
    next(err);
  }
};