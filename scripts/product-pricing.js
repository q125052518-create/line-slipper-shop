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
  const price = Math.round(originalPrice * percent / 100);
  return price < originalPrice ? { price, originalPrice, pricePercent: percent } : { price: originalPrice };
}

export function storefrontProduct(product) {
  return { ...product, variants: (product.variants || []).map((variant) => ({ ...variant, ...variantPricing(product, variant) })) };
}
