export function normalizePromotion(input) {
  if (input == null) return null;
  const pricePercent = Number(input.pricePercent);
  if (!Number.isInteger(pricePercent) || pricePercent < 1 || pricePercent > 99) {
    throw new Error("折扣比例必須是 1 到 99 的整數");
  }
  return { pricePercent };
}

export function variantPricing(product, variant) {
  const originalPrice = Number(variant.price);
  const percent = product.promotion?.pricePercent;
  if (!Number.isInteger(percent) || percent < 1 || percent > 99) return { price: originalPrice };
  const price = Math.round(originalPrice * percent) / 100;
  return price < originalPrice ? { price, originalPrice, pricePercent: percent } : { price: originalPrice };
}

export function storefrontProduct(product) {
  return { ...product, variants: (product.variants || []).map((variant) => ({ ...variant, ...variantPricing(product, variant) })) };
}

export function orderTotals(items, shippingFee = 0) {
  // Sum integer cents, then round the final payable amount once.
  const productCents = items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);
  const shippingCents = Math.round(shippingFee * 100);
  const totalAmount = Math.round((productCents + shippingCents) / 100);
  return {
    productTotal: productCents / 100,
    shippingFee: shippingCents / 100,
    totalAmount,
    roundingAdjustment: (totalAmount * 100 - productCents - shippingCents) / 100
  };
}
