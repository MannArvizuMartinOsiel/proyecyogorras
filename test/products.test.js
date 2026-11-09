const assert = require("node:assert/strict");
const test = require("node:test");
const products = require("../js/products.js");
const isStorefrontProductPublished = require("../js/storefront-catalog.js");

test("the shared catalog has unique products with valid prices and departments", () => {
  const ids = products.map(product => product.id);
  const departments = new Set(products.map(product => product.department));

  assert.ok(products.length > 0);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...departments].sort(), ["Gorras", "Joyería", "Ropa", "Tenis"]);
  for (const product of products) {
    assert.ok(Number.isInteger(product.id));
    assert.ok(Number.isInteger(product.price) && product.price > 0);
    assert.ok(product.name && product.description && product.type);
    assert.ok(product.colorOptions.length > 0);
    assert.ok(product.sizeOptions.length > 0);
    assert.equal(new Set(product.colorOptions.map(option => option.id)).size, product.colorOptions.length);
  }
});

test("clothing and sneakers provide wearable sizes while other products are one size", () => {
  for (const product of products) {
    if (product.department === "Ropa") {
      assert.deepEqual(product.sizeOptions, ["XS", "S", "M", "L", "XL"]);
    } else if (product.department === "Tenis") {
      assert.deepEqual(product.sizeOptions, ["23", "24", "25", "26", "27", "28", "29"]);
    } else {
      assert.deepEqual(product.sizeOptions, ["Unitalla"]);
    }
  }
});

test("clothing and footwear stay hidden until an admin product is added or published with an image", () => {
  for (const product of products.filter(item => ["Ropa", "Tenis"].includes(item.department))) {
    assert.equal(isStorefrontProductPublished(product), false);
  }

  assert.equal(isStorefrontProductPublished({ id: 1000, department: "Ropa" }), true);
  assert.equal(isStorefrontProductPublished({ id: 17, department: "Tenis", image_url: "https://example.com/shoe.jpg" }), true);
  assert.equal(isStorefrontProductPublished({ id: 9, department: "Ropa" }, [9]), true);
  assert.equal(isStorefrontProductPublished({ id: 1, department: "Gorras" }), true);
});
