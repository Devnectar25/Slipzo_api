export const validateBill = (bill) => {
  const errors = [];
  
  if (!bill.items || bill.items.length === 0) {
    errors.push('At least one item is required');
  }
  
  if (bill.items) {
    bill.items.forEach((item, index) => {
      if (!item.name || !item.name.trim()) {
        errors.push(`Item ${index + 1}: Name is required`);
      }
      if (Number(item.quantity) < 1) {
        errors.push(`Item ${index + 1}: Quantity must be at least 1`);
      }
      if (Number(item.rate) < 0) {
        errors.push(`Item ${index + 1}: Rate cannot be negative`);
      }
    });
  }
  
  if (Number(bill.discount) < 0) {
    errors.push('Discount cannot be negative');
  }
  
  if (Number(bill.tax_rate) < 0) {
    errors.push('Tax rate cannot be negative');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

export const validateShop = (shop) => {
  const errors = [];
  
  if (!shop.name || !shop.name.trim()) {
    errors.push('Shop name is required');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};