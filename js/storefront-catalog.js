function isStorefrontProductPublished(product, featuredProductIds = []) {
  if (featuredProductIds.includes(Number(product.id))) return true;
  if (!["Ropa", "Tenis"].includes(product.department)) return true;
  return Number(product.id) >= 1000 || Boolean(product.image_url);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = isStorefrontProductPublished;
} else if (typeof window !== "undefined") {
  window.isStorefrontProductPublished = isStorefrontProductPublished;
}
