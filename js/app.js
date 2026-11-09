let products = window.CAPSTREET_PRODUCTS;
let categoryImages = {};
let featuredProducts = [];
let featuredProductsLoadError = false;
const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const CHECKOUT_API_URL = isLocalhost
  ? "http://localhost:3001"
  : window.CAPSTREET_CONFIG.checkoutApiUrl.replace(/\/+$/, "");
const CHECKOUT_PENDING_KEY = "capstreet-checkout-pending";
const CHECKOUT_PROVIDER_PENDING_KEY = "capstreet-checkout-provider";

    async function requestPaymentApi(path, options, fallbackMessage) {
      let response;
      try {
        response = await fetch(`${CHECKOUT_API_URL}${path}`, options);
      } catch (error) {
        if (error instanceof TypeError) {
          throw new Error(`No se pudo conectar con la API de pagos (${CHECKOUT_API_URL}). Confirma que el servicio de Render esté publicado y activo.`);
        }
        throw error;
      }

      let result;
      try {
        result = await response.json();
      } catch (error) {
        const message = response.status === 404
          ? `No se encontró la API de pagos en ${CHECKOUT_API_URL}. Verifica el dominio del servicio en Render.`
          : "La API de pagos devolvió una respuesta no válida.";
        throw new Error(message, { cause: error });
      }
      if (!response.ok) {
        const message = response.status === 404
          ? `No se encontró la API de pagos en ${CHECKOUT_API_URL}. Verifica el dominio del servicio en Render.`
          : result.error || fallbackMessage;
        const apiError = new Error(message);
        apiError.status = response.status;
        throw apiError;
      }
      return result;
    }

    function loadSavedCart() {
      try {
        const savedCart = localStorage.getItem("capstreet-cart");
        if (!savedCart) return new Map();
        const entries = JSON.parse(savedCart);
        if (!Array.isArray(entries)) throw new TypeError("El carrito guardado no es una lista válida.");
        return entries.reduce((saved, entry) => {
          if (!Array.isArray(entry) || entry.length !== 2) return saved;
          const [productRef, quantity] = entry;
          if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return saved;
          const legacyProduct = typeof productRef === "number"
            ? products.find(product => product.id === productRef)
            : null;
          const variant = typeof productRef === "number"
            ? legacyProduct && {
              product: legacyProduct,
              color: legacyProduct.colorOptions[0],
              size: legacyProduct.sizeOptions[0]
            }
            : parseCartKey(productRef);
          if (!variant) return saved;
          const key = variantKey(variant.product.id, variant.color.id, variant.size);
          saved.set(key, Math.min(99, (saved.get(key) || 0) + quantity));
          return saved;
        }, new Map());
      } catch (error) {
        console.error("No se pudo recuperar el carrito guardado.", error);
        return new Map();
      }
    }

    let cart = new Map();
    const WISHLIST_STORAGE_KEY = "capstreet-wishlist";
    function loadSavedWishlist() {
      try {
        const saved = JSON.parse(localStorage.getItem(WISHLIST_STORAGE_KEY) || "[]");
        if (!Array.isArray(saved)) throw new TypeError("La lista guardada no es válida.");
        return new Set(saved.filter(id => Number.isInteger(id) && products.some(product => product.id === id)));
      } catch (error) {
        console.error("No se pudo recuperar la lista de deseos.", error);
        return new Set();
      }
    }

    let favorites = new Set();
    const SUPABASE_URL = window.CAPSTREET_CONFIG.supabaseUrl;
    const SUPABASE_ANON_KEY = window.CAPSTREET_CONFIG.supabaseAnonKey;
    const supabaseClient = window.supabase?.createClient
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          storageKey: "capstreet-supabase-auth"
        }
      })
      : null;
    let activeFilter = "";
    let sizeFilterDepartment = "Tenis";
    let selectedSize = null;
    let toastTimer;
    let accountEmail = "";
    let accountProfile = null;
    let accountMode = "login";
    let accountPreviousFocus = null;
    let accountBusy = false;
    let checkoutBusy = false;
    let checkoutPending = localStorage.getItem(CHECKOUT_PENDING_KEY) === "true";
    const paymentOptions = { stripe: false, paypal: false };
    const selectedVariants = new Map();
    let appliedPromotion = null;
    let activeProductId = null;
    let productModalPreviousFocus = null;

    function capSvg(product, className = "product-art") {
      const { color, brim, patch, label } = product;
      return `<svg class="${className}" viewBox="0 0 360 260" role="img" aria-label="Gorra ${escapeHtml(product.name)}">
        <path d="M53 153C59 85 105 36 174 32c54-3 100 35 119 95l-6 28c-67 15-149 17-234-2z" fill="${color}"/>
        <path d="M53 153c-9 5-18 17-16 29 2 11 15 18 34 21 51 9 121 3 177-12 23-6 46-17 48-31 1-9-5-21-10-28-67 21-157 34-233 21z" fill="${brim}"/>
        <path d="M174 33c3 40 4 78 2 119M111 51c18 34 31 68 39 105M233 50c-17 35-30 70-39 105" fill="none" stroke="rgba(110,110,102,.55)" stroke-width="2"/>
        <path d="M174 33c3-10 15-12 24-7" fill="none" stroke="rgba(130,130,120,.7)" stroke-width="3" stroke-linecap="round"/>
        <path d="M66 159c60 14 153 4 226-17M104 187c54 8 111 2 155-11" fill="none" stroke="rgba(125,125,115,.65)" stroke-width="2" stroke-dasharray="3 5"/>
        <rect x="149" y="108" width="48" height="25" rx="2" fill="${patch}"/>
        <text x="173" y="124" text-anchor="middle" fill="${patch === "#171715" ? "#f5f4ee" : "#171715"}" font-family="Arial,sans-serif" font-size="9" font-weight="700" letter-spacing="1">${label}</text>
      </svg>`;
    }

    function productArt(product, className = "product-art") {
      const imageUrl = publicProductImageUrl(product.image_url);
      if (imageUrl) {
        return `<img class="${className}" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.department)}: ${escapeHtml(product.name)}" loading="lazy">`;
      }
      if (product.type === "cap") return capSvg(product, className);
      const { color, brim, label } = product;
      const drawings = {
        shirt: `<path d="m105 62 37-19h76l37 19 39 35-31 34-24-21v105H101V110l-24 21-31-34z" fill="${color}" stroke="#777777" stroke-width="2"/><path d="M142 43c2 20 74 20 76 0" fill="none" stroke="#777777" stroke-width="2"/><text x="180" y="139" text-anchor="middle" fill="${brim}" font-family="Arial,sans-serif" font-size="12" font-weight="700" letter-spacing="1">${label}</text>`,
        hoodie: `<path d="M119 77c-7-31 19-49 61-49s68 18 61 49l28 15 34 39-30 27-21-19v78H108v-78l-21 19-30-27 34-39z" fill="${color}" stroke="#777777" stroke-width="2"/><path d="M136 57c5 31 83 31 88 0M136 57l10 48m58-48-10 48M143 107h74v31h-74z" fill="none" stroke="#777777" stroke-width="2"/><text x="180" y="128" text-anchor="middle" fill="${brim}" font-family="Arial,sans-serif" font-size="10" font-weight="700">${label}</text>`,
        chain: `<path d="M80 48c0 143 200 143 200 0" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="2 7"/><path d="M80 48c0 143 200 143 200 0" fill="none" stroke="${brim}" stroke-width="3"/><path d="m180 163 22 22-22 39-22-39z" fill="${color}" stroke="${brim}" stroke-width="3"/><text x="180" y="199" text-anchor="middle" fill="${brim}" font-family="Arial,sans-serif" font-size="9" font-weight="700">${label}</text>`,
        bracelet: `<ellipse cx="180" cy="130" rx="105" ry="69" fill="none" stroke="${color}" stroke-width="24"/><ellipse cx="180" cy="130" rx="105" ry="69" fill="none" stroke="${brim}" stroke-width="3" stroke-dasharray="2 8"/><rect x="163" y="53" width="34" height="27" rx="4" fill="${brim}"/><text x="180" y="71" text-anchor="middle" fill="${color}" font-family="Arial,sans-serif" font-size="9" font-weight="700">${label}</text>`,
        sneaker: `<path d="M65 149c20-5 38-20 51-51l15-38 35 13c4 31 23 48 53 60l66 25c15 6 24 16 24 29 0 16-13 25-35 25H75c-23 0-39-11-39-29 0-15 10-28 29-34z" fill="${color}" stroke="#777777" stroke-width="3"/><path d="M36 177h270c-1 24-17 35-38 35H75c-24 0-38-11-39-35z" fill="${brim}" stroke="#777777" stroke-width="2"/><path d="m124 96 49 15m-57-1 45 14m-53 1 43 13m-11-68 5 38" fill="none" stroke="${brim}" stroke-width="5" stroke-linecap="round"/><text x="222" y="163" text-anchor="middle" fill="${brim === "#171715" ? "#f5f4ee" : "#171715"}" font-family="Arial,sans-serif" font-size="12" font-weight="700">${label}</text>`,
        perfume: `<path d="M151 70h58v29l20 17v101H131V116l20-17z" fill="${color}" stroke="#777777" stroke-width="3"/><path d="M164 70V49h32v21m-23-21V37h14v12" fill="none" stroke="${brim}" stroke-width="7" stroke-linejoin="round"/><path d="M145 129h70v48h-70z" fill="${brim}"/><text x="180" y="151" text-anchor="middle" fill="${brim === "#171715" ? "#f5f4ee" : "#171715"}" font-family="Arial,sans-serif" font-size="10" font-weight="700">${label}</text>`
      };
      return `<svg class="${className}" viewBox="0 0 360 260" role="img" aria-label="${escapeHtml(product.department)}: ${escapeHtml(product.name)}">${drawings[product.type]}</svg>`;
    }

    function publicProductImageUrl(value) {
      if (typeof value !== "string" || !value) return "";
      try {
        const image = new URL(value);
        const supabase = new URL(SUPABASE_URL);
        if (
          image.protocol !== "https:" ||
          image.origin !== supabase.origin ||
          !image.pathname.startsWith("/storage/v1/object/public/product-images/")
        ) return "";
        return image.href;
      } catch {
        return "";
      }
    }

    function variantKey(productId, colorId, size) {
      return `${productId}|${colorId}|${size}`;
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
      })[character]);
    }

    function getVariant(product) {
      const selected = selectedVariants.get(product.id);
      return {
        color: product.colorOptions.find(option => option.id === selected?.colorId) || product.colorOptions[0],
        size: product.sizeOptions.includes(selected?.size) ? selected.size : product.sizeOptions[0]
      };
    }

    function storefrontProducts() {
      const featuredIds = new Set(featuredProducts.map(featured => Number(featured.product_id)));
      const featuredIdList = [...featuredIds];
      return products.filter(product =>
        window.isStorefrontProductPublished(product, featuredIdList)
      );
    }

    function renderProducts() {
      const query = document.getElementById("product-search").value.trim().toLocaleLowerCase("es");
      const minPriceInput = document.getElementById("price-min");
      const maxPriceInput = document.getElementById("price-max");
      const minPrice = minPriceInput.value === "" ? null : Number(minPriceInput.value);
      const maxPrice = maxPriceInput.value === "" ? null : Number(maxPriceInput.value);
      const sortOrder = document.getElementById("sort-products").value;
      const invalidPriceRange = minPrice !== null && maxPrice !== null && minPrice > maxPrice;
      minPriceInput.setAttribute("aria-invalid", String(invalidPriceRange));
      maxPriceInput.setAttribute("aria-invalid", String(invalidPriceRange));
      let visibleProducts = storefrontProducts().filter(product => {
        const matchesCategory = !activeFilter || product.department === activeFilter;
        const matchesSize = !selectedSize ||
          (product.department === sizeFilterDepartment && Array.isArray(product.sizeOptions) && product.sizeOptions.includes(selectedSize));
        const matchesQuery = `${product.name} ${product.department} ${product.category || ""} ${product.description}`.toLocaleLowerCase("es").includes(query);
        const matchesPrice = (minPrice === null || product.price >= minPrice) &&
          (maxPrice === null || product.price <= maxPrice);
        return matchesCategory && matchesSize && matchesQuery && matchesPrice;
      });
      if (invalidPriceRange) visibleProducts = [];
      if (sortOrder === "price-asc") visibleProducts.sort((a, b) => a.price - b.price);
      if (sortOrder === "price-desc") visibleProducts.sort((a, b) => b.price - a.price);
      if (sortOrder === "name") visibleProducts.sort((a, b) => a.name.localeCompare(b.name, "es"));
      const grid = document.getElementById("products-grid");
      document.getElementById("results-count").textContent = `${visibleProducts.length} ${visibleProducts.length === 1 ? "producto" : "productos"}`;
      if (!visibleProducts.length) {
        grid.innerHTML = `<div class="empty-state">${invalidPriceRange ? "El precio mínimo no puede ser mayor al precio máximo." : "No encontramos productos con esos criterios. Prueba con otros filtros."}</div>`;
        return;
      }
      grid.innerHTML = visibleProducts.map(product => {
        const variant = getVariant(product);
        return `
        <article class="product-card" data-product-card="${product.id}">
          <div class="product-visual">
            ${product.tag ? `<span class="product-tag">${escapeHtml(product.tag)}</span>` : ""}
            <button class="favorite-button ${favorites.has(product.id) ? "is-favorite" : ""}" data-favorite="${product.id}" aria-label="${favorites.has(product.id) ? "Quitar de favoritos" : "Añadir a favoritos"}" aria-pressed="${favorites.has(product.id)}">
              <svg viewBox="0 0 24 24" fill="${favorites.has(product.id) ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7"><path d="M20.8 8.8c0 4.1-8.8 10.1-8.8 10.1S3.2 12.9 3.2 8.8A4.3 4.3 0 0 1 12 6.7a4.3 4.3 0 0 1 8.8 2.1Z"/></svg>
            </button>
            ${productArt({ ...product, color: variant.color.color, brim: variant.color.brim })}
            <button class="quick-add" data-product-open="${product.id}">Elegir opciones
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
          <div class="product-info">
            <div class="product-name-row"><button class="product-name product-name-button" data-product-open="${product.id}">${escapeHtml(product.name)}</button><span class="product-price">${formatPrice(product.price)}</span></div>
            <p class="product-description">${escapeHtml(product.description)}</p>
          </div>
        </article>`;
      }).join("");
    }

    function renderCategoryCatalog() {
      const availableProducts = storefrontProducts();
      const preferredDepartments = ["Gorras", "Ropa", "Tenis", "Joyería", "Perfumes"];
      const departments = [
        ...preferredDepartments.filter(department => availableProducts.some(product => product.department === department)),
        ...new Set(products
          .map(product => product.department)
          .filter(department => department && !preferredDepartments.includes(department)))
      ];
      const categories = departments
        .map(department => ({
          department,
          products: availableProducts.filter(product => product.department === department)
        }))
        .filter(category => category.products.length);
      const catalog = document.getElementById("category-catalog");
      catalog.dataset.count = String(categories.length);
      catalog.innerHTML = categories.map(({ department, products: categoryProducts }, index) => {
        const title = department === "Tenis" ? "Calzado" : department;
        const descriptions = {
          Gorras: "Diseño y actitud",
          Ropa: "Prendas para todos los días",
          Tenis: "Estilo para moverte",
          "Joyería": "Detalles que completan tu look",
          Perfumes: "Esencias para cada ocasión"
        };
        const categoryImageUrl = publicProductImageUrl(categoryImages[department]);
        const artwork = categoryImageUrl
          ? `<img class="category-cover" src="${escapeHtml(categoryImageUrl)}" alt="" loading="lazy">`
          : categoryProducts.slice(0, 3).map((product, productIndex) => {
          const variant = getVariant(product);
          const art = productArt({
            ...product,
            color: variant.color?.color || product.color,
            brim: variant.color?.brim || product.brim
          }, "category-product-art");
          return `<span class="category-product category-product-${productIndex + 1}">${art}</span>`;
        }).join("");
        const countLabel = String(categoryProducts.length).padStart(2, "0");
        return `
          <button type="button" class="category-tile" data-department="${escapeHtml(department)}" aria-label="Ver ${escapeHtml(title)}, ${categoryProducts.length} productos">
            <span class="category-tile-art" aria-hidden="true">${artwork}</span>
            <span class="category-tile-info">
              <span class="category-tile-count">${countLabel} PRODUCTOS</span>
              <span class="category-tile-name">${escapeHtml(title)}</span>
              <span class="category-tile-description">${escapeHtml(descriptions[department] || "Explora la colección")}</span>
              <span class="category-tile-arrow" aria-hidden="true">↗</span>
            </span>
          </button>`;
      }).join("");
      syncStorefrontAvailability();
    }

    function renderFeaturedProducts() {
      const featured = featuredProducts
        .map(entry => ({
          ...entry,
          product: products.find(product => Number(product.id) === Number(entry.product_id))
        }))
        .filter(entry => entry.product && storefrontProducts().some(product => product.id === entry.product.id));
      const section = document.getElementById("bestsellers");
      section.hidden = false;
      if (!featured.length) {
        document.getElementById("bestseller-grid").innerHTML = `
          <p class="bestseller-empty">${featuredProductsLoadError
            ? "No pudimos cargar los productos destacados. Intenta de nuevo más tarde."
            : "Próximamente encontrarás aquí los productos destacados."}</p>`;
        return;
      }
      document.getElementById("bestseller-grid").innerHTML = featured.map(({ product, image_url: featuredImage }) => {
        const art = productArt({
          ...product,
          image_url: featuredImage || product.image_url,
          color: getVariant(product).color.color,
          brim: getVariant(product).color.brim
        });
        return `
          <button type="button" class="bestseller-card" data-product-open="${product.id}" aria-label="Ver ${escapeHtml(product.name)}">
            <span class="bestseller-visual">${art}<span class="bestseller-cta">Ver producto <span aria-hidden="true">↗</span></span></span>
            <span class="bestseller-info">
              <span class="bestseller-name">${escapeHtml(product.name)}</span>
              <span class="bestseller-price">${formatPrice(product.price)}</span>
            </span>
            <span class="bestseller-department">${escapeHtml(product.department === "Tenis" ? "Calzado" : product.department)}</span>
          </button>`;
      }).join("");
    }

    function saveWishlist() {
      try {
        localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify([...favorites]));
      } catch (error) {
        console.error("No se pudo guardar la lista de deseos en este navegador.", error);
        showToast("No pudimos guardar tus favoritos en este navegador.");
      }
      renderWishlist();
    }

    function renderWishlist() {
      const count = favorites.size;
      document.getElementById("wishlist-count").textContent = count;
      document.getElementById("wishlist-heading-count").textContent = `(${count})`;
      const buyButton = document.getElementById("wishlist-buy");
      buyButton.disabled = count === 0;
      buyButton.textContent = count ? `Comprar lista de deseos (${count})` : "Comprar lista de deseos";
      const list = document.getElementById("wishlist-items");
      if (!count) {
        list.innerHTML = '<div class="wishlist-empty"><span class="wishlist-empty-icon">♡</span><h3>Tu lista está vacía</h3><p>Guarda aquí las piezas que te gusten para encontrarlas fácilmente después.</p></div>';
        return;
      }
      list.innerHTML = [...favorites].map(id => {
        const product = products.find(item => item.id === id);
        if (!product) return "";
        const variant = getVariant(product);
        return `<article class="wishlist-item">
          <div class="wishlist-item-art">${productArt({
            ...product,
            color: variant.color.color,
            brim: variant.color.brim
          }, "")}</div>
          <div class="wishlist-item-info">
            <h3>${escapeHtml(product.name)}</h3>
            <p>${escapeHtml(product.department)} · ${formatPrice(product.price)} MXN</p>
            <span>${escapeHtml(variant.color.label)} · ${escapeHtml(variant.size)}</span>
            <button type="button" class="wishlist-choose" data-wishlist-product="${product.id}">Ver opciones</button>
          </div>
          <button type="button" class="wishlist-remove" data-wishlist-remove="${product.id}" aria-label="Quitar ${escapeHtml(product.name)} de la lista">Quitar</button>
        </article>`;
      }).join("");
    }

    function renderProductModal(focusTarget = null) {
      const product = products.find(item => item.id === activeProductId);
      if (!product) return;
      const variant = getVariant(product);
      const featuredImage = featuredProducts.find(item => Number(item.product_id) === Number(product.id))?.image_url;
      const content = document.getElementById("product-modal-content");
      content.innerHTML = `
        <div class="product-modal-visual">${productArt({ ...product, image_url: featuredImage || product.image_url, color: variant.color.color, brim: variant.color.brim })}</div>
        <div class="product-modal-details">
          <p class="product-modal-kicker">${escapeHtml(product.department)}${product.category ? ` / ${escapeHtml(product.category)}` : ""}</p>
          <h2 id="product-modal-name">${escapeHtml(product.name)}</h2>
          <p class="product-modal-description">${escapeHtml(product.description)}</p>
          <p class="product-modal-price">${formatPrice(product.price)} <span>MXN</span></p>
          <fieldset class="variant-choice">
            <legend>Color <span>${escapeHtml(variant.color.label)}</span></legend>
            <div class="variant-swatches">
              ${product.colorOptions.map(color => `
                <button class="variant-swatch ${variant.color.id === color.id ? "selected" : ""}" type="button"
                  data-modal-color="${escapeHtml(color.id)}" aria-label="${escapeHtml(color.label)}"
                  aria-pressed="${variant.color.id === color.id}" title="${escapeHtml(color.label)}"
                  style="--swatch-color:${escapeHtml(color.color)};--swatch-border:${escapeHtml(color.brim)}">
                  <span></span>
                </button>`).join("")}
            </div>
          </fieldset>
          <fieldset class="variant-choice">
            <legend>Talla <span>${escapeHtml(variant.size)}</span></legend>
            <div class="variant-sizes">
              ${product.sizeOptions.map(size => `
                <button class="variant-size ${variant.size === size ? "selected" : ""}" type="button"
                  data-modal-size="${escapeHtml(size)}" aria-pressed="${variant.size === size}">${escapeHtml(size)}</button>`).join("")}
            </div>
          </fieldset>
          <button class="button product-modal-add" id="product-modal-add" type="button">Agregar al carrito</button>
          <p class="product-modal-note">Elige el color y la talla que prefieras.</p>
        </div>`;
      if (focusTarget) {
        const [type, value] = focusTarget;
        const selector = type === "color" ? "[data-modal-color]" : "[data-modal-size]";
        const attribute = type === "color" ? "modalColor" : "modalSize";
        [...content.querySelectorAll(selector)].find(button => button.dataset[attribute] === value)?.focus();
      }
    }

    function openProductModal(productId, trigger) {
      if (!products.some(product => product.id === productId)) return;
      activeProductId = productId;
      productModalPreviousFocus = trigger;
      renderProductModal();
      const modal = document.getElementById("product-modal-overlay");
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      document.getElementById("product-modal-close").focus();
    }

    function closeProductModal() {
      const modal = document.getElementById("product-modal-overlay");
      if (!modal.classList.contains("open")) return;
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      activeProductId = null;
      if (productModalPreviousFocus?.isConnected) productModalPreviousFocus.focus();
    }

    function formatPrice(price) {
      return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(price);
    }

    function formatCartPrice(price) {
      return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(price);
    }

    function addToCart(id) {
      const product = products.find(item => item.id === id);
      const variant = getVariant(product);
      const key = variantKey(id, variant.color.id, variant.size);
      cart.set(key, (cart.get(key) || 0) + 1);
      appliedPromotion = null;
      updatePromotionMessage("", "");
      renderCart();
      showToast(`${product.name} agregada a tu carrito`);
    }

    function parseCartKey(key) {
      const [productId, colorId, ...sizeParts] = String(key).split("|");
      const product = products.find(item => item.id === Number(productId));
      if (!product) return null;
      const color = product.colorOptions.find(option => option.id === colorId);
      const size = sizeParts.join("|");
      if (!color || !product.sizeOptions.includes(size)) return null;
      return { product, color, size };
    }

    function getCartItems() {
      return [...cart.entries()].map(([key, quantity]) => {
        const variant = parseCartKey(key);
        if (!variant) return null;
        return {
          id: variant.product.id,
          quantity,
          color: variant.color.id,
          size: variant.size
        };
      }).filter(Boolean);
    }

    function cartSubtotal() {
      return [...cart.entries()].reduce((sum, [key, quantity]) => {
        const variant = parseCartKey(key);
        return sum + (variant ? variant.product.price * quantity : 0);
      }, 0);
    }

    function getSingleAvailablePaymentProvider() {
      if (paymentOptions.stripe === paymentOptions.paypal) return null;
      return paymentOptions.stripe ? "stripe" : "paypal";
    }

    function updatePromotionMessage(message, type) {
      const status = document.getElementById("promo-message");
      status.textContent = message;
      status.dataset.state = type;
      document.getElementById("promo-remove").hidden = !appliedPromotion;
      document.getElementById("promo-code").disabled = Boolean(appliedPromotion);
      document.getElementById("promo-apply").disabled = Boolean(appliedPromotion) || checkoutBusy;
    }

    async function validatePromotion() {
      const input = document.getElementById("promo-code");
      const code = input.value.trim().toUpperCase();
      if (!code) {
        updatePromotionMessage("Escribe un código para canjearlo.", "error");
        return;
      }
      const button = document.getElementById("promo-apply");
      button.disabled = true;
      try {
        const result = await requestPaymentApi("/api/validate-promo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, items: getCartItems() })
        }, "No pudimos validar el código promocional.");
        appliedPromotion = { code: result.code, percentOff: result.percentOff };
        updatePromotionMessage(`${result.code} aplicado: ${result.percentOff}% de descuento.`, "success");
        renderCart();
      } catch (error) {
        appliedPromotion = null;
        updatePromotionMessage(error.message || "Código inválido.", "error");
      } finally {
        button.disabled = Boolean(appliedPromotion) || checkoutBusy;
      }
    }

    document.getElementById("promo-form").addEventListener("submit", event => {
      event.preventDefault();
      validatePromotion();
    });
    document.getElementById("promo-remove").addEventListener("click", () => {
      appliedPromotion = null;
      document.getElementById("promo-code").value = "";
      updatePromotionMessage("Código eliminado.", "");
      renderCart();
    });


    function renderCart() {
      const count = [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);
      const subtotal = cartSubtotal();
      const discount = appliedPromotion
        ? Math.round(subtotal * 100 * appliedPromotion.percentOff / 100) / 100
        : 0;
      const total = subtotal - discount;
      try {
        localStorage.setItem("capstreet-cart", JSON.stringify([...cart.entries()]));
      } catch (error) {
        console.error("No se pudo guardar el carrito en este navegador.", error);
      }
      document.getElementById("cart-count").textContent = count;
      document.getElementById("drawer-count").textContent = `(${count})`;
      document.getElementById("cart-subtotal").textContent = formatCartPrice(subtotal);
      document.getElementById("cart-discount").textContent = `−${formatCartPrice(discount)}`;
      document.getElementById("cart-discount-row").hidden = discount === 0;
      document.getElementById("cart-total").textContent = formatCartPrice(total);
      document.getElementById("buy-button").disabled = count === 0 || checkoutBusy;
      const singleProvider = getSingleAvailablePaymentProvider();
      document.getElementById("buy-button-label").textContent = singleProvider
        ? `Pagar con ${singleProvider === "paypal" ? "PayPal" : "Stripe"}`
        : "Continuar al pago";
      document.getElementById("stripe-checkout-button").disabled = count === 0 || !paymentOptions.stripe || checkoutBusy;
      document.getElementById("paypal-checkout-button").disabled = count === 0 || !paymentOptions.paypal || checkoutBusy;
      if (count === 0) {
        document.getElementById("checkout-payment-step").hidden = true;
        document.getElementById("buy-button").hidden = false;
      }
      const items = document.getElementById("cart-items");
      if (count === 0) {
        items.innerHTML = '<div class="cart-empty">Tu carrito está esperando algo bueno.<br>Encuentra tu próxima gorra favorita.</div>';
        return;
      }
      items.innerHTML = [...cart.entries()].map(([key, quantity]) => {
        const variant = parseCartKey(key);
        if (!variant) return "";
        const { product, color, size } = variant;
        const id = product.id;
        return `<div class="cart-item">
          <div class="cart-item-art">${productArt({ ...product, color: color.color, brim: color.brim }, "")}</div>
          <div>
            <p class="cart-item-name">${escapeHtml(product.name)}</p>
            <span class="cart-item-variant">${escapeHtml(color.label)} · ${escapeHtml(size)}</span>
            <span class="cart-item-price">${formatPrice(product.price)}</span>
            <div class="quantity-control">
              <button data-quantity="${escapeHtml(key)}" data-change="-1" aria-label="Quitar una ${escapeHtml(product.name)}">−</button>
              <span>${quantity}</span>
              <button data-quantity="${escapeHtml(key)}" data-change="1" aria-label="Añadir una ${escapeHtml(product.name)}">+</button>
            </div>
          </div>
          <button class="remove-button" data-remove="${escapeHtml(key)}" aria-label="Quitar ${escapeHtml(product.name)} del carrito">Quitar</button>
        </div>`;
      }).join("");
    }

    function showToast(message) {
      const toast = document.getElementById("toast");
      document.getElementById("toast-message").textContent = message;
      toast.classList.add("visible");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("visible"), 2300);
    }

    function setCartOpen(isOpen) {
      document.getElementById("cart-drawer").classList.toggle("open", isOpen);
      document.getElementById("cart-drawer").setAttribute("aria-hidden", String(!isOpen));
      document.getElementById("overlay").classList.toggle("open", isOpen);
      document.body.style.overflow = isOpen ? "hidden" : "";
    }

    function setWishlistOpen(isOpen) {
      const overlay = document.getElementById("wishlist-overlay");
      if (isOpen) {
        setCartOpen(false);
        overlay.classList.add("open");
        overlay.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
        document.getElementById("close-wishlist").focus();
      } else {
        overlay.classList.remove("open");
        overlay.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
      }
    }

    document.getElementById("products-grid").addEventListener("click", event => {
      const productButton = event.target.closest("[data-product-open]");
      if (productButton) openProductModal(Number(productButton.dataset.productOpen), productButton);
      const favoriteButton = event.target.closest("[data-favorite]");
      if (favoriteButton) {
        const id = Number(favoriteButton.dataset.favorite);
        favorites.has(id) ? favorites.delete(id) : favorites.add(id);
        saveWishlist();
        renderProducts();
        showToast(favorites.has(id) ? "Agregado a tu lista de deseos" : "Eliminado de tu lista de deseos");
      }
    });
    document.getElementById("bestseller-grid").addEventListener("click", event => {
      const productButton = event.target.closest("[data-product-open]");
      if (productButton) openProductModal(Number(productButton.dataset.productOpen), productButton);
    });

    document.getElementById("wishlist-items").addEventListener("click", event => {
      const removeButton = event.target.closest("[data-wishlist-remove]");
      if (removeButton) {
        favorites.delete(Number(removeButton.dataset.wishlistRemove));
        saveWishlist();
        renderProducts();
        showToast("Eliminado de tu lista de deseos");
        return;
      }
      const chooseButton = event.target.closest("[data-wishlist-product]");
      if (chooseButton) {
        const productId = Number(chooseButton.dataset.wishlistProduct);
        setWishlistOpen(false);
        const productButton = document.querySelector(`[data-product-card="${productId}"] [data-product-open]`);
        openProductModal(productId, productButton || document.getElementById("open-wishlist"));
      }
    });

    document.getElementById("open-wishlist").addEventListener("click", () => {
      renderWishlist();
      setWishlistOpen(true);
    });
    document.getElementById("close-wishlist").addEventListener("click", () => setWishlistOpen(false));
    document.getElementById("wishlist-continue").addEventListener("click", () => setWishlistOpen(false));
    document.getElementById("wishlist-buy").addEventListener("click", () => {
      if (!favorites.size) return;
      for (const id of favorites) {
        const product = products.find(item => item.id === id);
        if (!product) continue;
        const variant = getVariant(product);
        const key = variantKey(id, variant.color.id, variant.size);
        cart.set(key, Math.min(99, (cart.get(key) || 0) + 1));
      }
      appliedPromotion = null;
      document.getElementById("promo-code").value = "";
      updatePromotionMessage("", "");
      renderCart();
      setWishlistOpen(false);
      setCartOpen(true);
      showToast("Tu lista de deseos se agregó al carrito");
    });
    document.getElementById("wishlist-overlay").addEventListener("click", event => {
      if (event.target === event.currentTarget) setWishlistOpen(false);
    });

    document.getElementById("product-modal-content").addEventListener("click", event => {
      const colorButton = event.target.closest("[data-modal-color]");
      const sizeButton = event.target.closest("[data-modal-size]");
      if (colorButton) {
        const product = products.find(item => item.id === activeProductId);
        const current = getVariant(product);
        selectedVariants.set(product.id, { colorId: colorButton.dataset.modalColor, size: current.size });
        const card = document.querySelector(`[data-product-card="${product.id}"] .product-visual`);
        if (card) card.querySelector(".product-art").outerHTML = productArt({
          ...product,
          color: getVariant(product).color.color,
          brim: getVariant(product).color.brim
        });
        renderProductModal(["color", colorButton.dataset.modalColor]);
      } else if (sizeButton) {
        const product = products.find(item => item.id === activeProductId);
        const current = getVariant(product);
        selectedVariants.set(product.id, { colorId: current.color.id, size: sizeButton.dataset.modalSize });
        renderProductModal(["size", sizeButton.dataset.modalSize]);
      } else if (event.target.closest("#product-modal-add")) {
        addToCart(activeProductId);
        closeProductModal();
      }
    });
    document.getElementById("product-modal-close").addEventListener("click", closeProductModal);
    document.getElementById("product-modal-overlay").addEventListener("click", event => {
      if (event.target === event.currentTarget) closeProductModal();
    });

    const departmentDescriptions = {
      "": "Explora nuestra colección y encuentra lo que va contigo.",
      Gorras: "Diseños esenciales para completar tu estilo.",
      Ropa: "Prendas cómodas con actitud para todos los días.",
      "Joyería": "Detalles que elevan cualquier combinación.",
      Tenis: "Comodidad y estilo para moverte por la ciudad."
    };

    function renderSizeOptions() {
      const sizeCatalog = storefrontProducts().filter(product =>
        product.department === sizeFilterDepartment &&
        Array.isArray(product.sizeOptions) &&
        product.sizeOptions.length
      );
      const options = [...new Set(sizeCatalog
        .filter(product => Array.isArray(product.sizeOptions))
        .flatMap(product => product.sizeOptions))];
      document.getElementById("size-options").innerHTML = options.map(size =>
        `<button type="button" class="shoe-size-button" data-size="${escapeHtml(size)}" aria-pressed="${size === selectedSize}">${escapeHtml(size)}</button>`
      ).join("");
      document.querySelectorAll("#department-page-picker [data-size-department]").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.sizeDepartment === sizeFilterDepartment));
      });
    }

    function syncStorefrontAvailability() {
      const available = department => storefrontProducts().some(product => product.department === department);
      const availableSizeDepartments = ["Ropa", "Tenis"].filter(available);
      document.querySelectorAll(".nav-store-dropdown [data-department]").forEach(link => {
        const department = link.dataset.department;
        link.hidden = ["Ropa", "Tenis"].includes(department) && !available(department);
      });
      document.querySelectorAll("[data-size-department]").forEach(button => {
        button.hidden = !available(button.dataset.sizeDepartment);
      });
      document.querySelector(".size-department-picker").hidden = availableSizeDepartments.length === 0;
      document.getElementById("tallas").hidden = availableSizeDepartments.length === 0;
      document.getElementById("department-page-picker").hidden = availableSizeDepartments.length < 2;
    }

    function updateSizeFinderDescription() {
      document.getElementById("size-finder-description").textContent =
        "Elige ropa o calzado para ver tallas y productos en su propio apartado.";
    }

    function syncDepartmentMenu() {
      document.querySelectorAll(".nav-store-dropdown [data-department]").forEach(link => {
        const department = link.dataset.department === "all" ? "" : link.dataset.department;
        link.hidden = ["Ropa", "Tenis"].includes(department) &&
          !storefrontProducts().some(product => product.department === department);
        if (department === activeFilter) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
    }

    function updateDepartmentPageHeading() {
      const title = activeFilter === "Tenis" ? "Calzado" : activeFilter || "Tienda";
      const categoryName = sizeFilterDepartment === "Tenis" ? "Calzado" : "Ropa";
      document.getElementById("department-page-title").textContent = selectedSize
        ? `${categoryName} · Talla ${selectedSize}`
        : title;
      document.getElementById("department-page-description").textContent = selectedSize
        ? `${categoryName} disponibles en la talla que elegiste.`
        : departmentDescriptions[activeFilter] || departmentDescriptions[""];
      document.getElementById("department-size-tools").hidden = !["Ropa", "Tenis"].includes(activeFilter);
    }

    function openDepartmentPage(department) {
      activeFilter = department;
      selectedSize = null;
      if (department === "Ropa" || department === "Tenis") sizeFilterDepartment = department;
      document.querySelectorAll(".home-view").forEach(section => { section.hidden = true; });
      document.querySelector(".benefits").hidden = true;
      document.querySelector("footer").hidden = true;
      document.getElementById("department-page").hidden = false;
      document.getElementById("clear-size-filter").hidden = true;
      renderSizeOptions();
      updateSizeFinderDescription();
      updateDepartmentPageHeading();
      syncDepartmentMenu();
      renderProducts();
      document.querySelector(".nav-store-menu").open = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function closeDepartmentPage() {
      document.getElementById("department-page").hidden = true;
      document.querySelectorAll(".home-view").forEach(section => { section.hidden = false; });
      document.querySelector(".benefits").hidden = false;
      document.querySelector("footer").hidden = false;
      selectedSize = null;
      document.getElementById("clear-size-filter").hidden = true;
      renderSizeOptions();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function setActiveDepartment(department) {
      activeFilter = department;
      selectedSize = null;
      if (department === "Ropa" || department === "Tenis") sizeFilterDepartment = department;
      renderSizeOptions();
      updateSizeFinderDescription();
      updateDepartmentPageHeading();
      document.getElementById("clear-size-filter").hidden = true;
      syncDepartmentMenu();
      renderProducts();
    }

    renderSizeOptions();
    renderCategoryCatalog();
    updateSizeFinderDescription();
    syncDepartmentMenu();

    document.getElementById("category-catalog").addEventListener("click", event => {
      const tile = event.target.closest("[data-department]");
      if (!tile) return;
      openDepartmentPage(tile.dataset.department);
    });

    document.querySelector(".nav-store-dropdown").addEventListener("click", event => {
      const link = event.target.closest("[data-department]");
      if (!link) return;
      event.preventDefault();
      const department = link.dataset.department === "all" ? "" : link.dataset.department;
      openDepartmentPage(department);
    });

    document.querySelector(".size-department-picker").addEventListener("click", event => {
      const button = event.target.closest("[data-size-department]");
      if (!button) return;
      openDepartmentPage(button.dataset.sizeDepartment);
    });

    document.getElementById("department-page-picker").addEventListener("click", event => {
      const button = event.target.closest("[data-size-department]");
      if (!button) return;
      activeFilter = button.dataset.sizeDepartment;
      sizeFilterDepartment = activeFilter;
      selectedSize = null;
      document.getElementById("clear-size-filter").hidden = true;
      renderSizeOptions();
      updateSizeFinderDescription();
      updateDepartmentPageHeading();
      syncDepartmentMenu();
      renderProducts();
    });

    document.querySelector(".shoe-size-picker").addEventListener("click", event => {
      const button = event.target.closest("[data-size]");
      if (!button) return;
      selectedSize = button.dataset.size;
      activeFilter = sizeFilterDepartment;
      storefrontProducts().filter(product =>
        product.department === sizeFilterDepartment &&
        Array.isArray(product.sizeOptions) &&
        product.sizeOptions.includes(selectedSize)
      ).forEach(product => {
        selectedVariants.set(product.id, {
          colorId: getVariant(product).color.id,
          size: selectedSize
        });
      });
      updateDepartmentPageHeading();
      document.querySelectorAll(".shoe-size-button").forEach(sizeButton => {
        sizeButton.setAttribute("aria-pressed", String(sizeButton === button));
      });
      document.getElementById("clear-size-filter").hidden = false;
      syncDepartmentMenu();
      renderProducts();
    });

    document.getElementById("clear-size-filter").addEventListener("click", () => {
      setActiveDepartment(sizeFilterDepartment);
    });
    document.getElementById("department-back").addEventListener("click", closeDepartmentPage);
    document.querySelectorAll(".brand").forEach(brand => {
      brand.addEventListener("click", event => {
        if (document.getElementById("department-page").hidden) return;
        event.preventDefault();
        closeDepartmentPage();
      });
    });

    document.getElementById("product-search").addEventListener("input", renderProducts);
    document.getElementById("price-min").addEventListener("input", renderProducts);
    document.getElementById("price-max").addEventListener("input", renderProducts);
    document.getElementById("sort-products").addEventListener("change", renderProducts);
    document.getElementById("clear-filters").addEventListener("click", () => {
      document.getElementById("product-search").value = "";
      document.getElementById("price-min").value = "";
      document.getElementById("price-max").value = "";
      document.getElementById("sort-products").value = "featured";
      renderProducts();
    });
    document.getElementById("search-focus").addEventListener("click", event => {
      const tools = document.getElementById("shop-tools");
      const isOpening = tools.hidden;
      tools.hidden = !isOpening;
      event.currentTarget.setAttribute("aria-expanded", String(isOpening));
      event.currentTarget.setAttribute("aria-label", isOpening ? "Ocultar búsqueda y filtros" : "Mostrar búsqueda y filtros");
      if (isOpening) {
        if (document.getElementById("department-page").hidden) openDepartmentPage(activeFilter);
        setTimeout(() => document.getElementById("product-search").focus(), 350);
      }
    });
    document.getElementById("open-cart").addEventListener("click", () => setCartOpen(true));
    document.getElementById("close-cart").addEventListener("click", () => setCartOpen(false));
    document.getElementById("overlay").addEventListener("click", () => setCartOpen(false));
    function setAccountMode(mode) {
      accountMode = mode;
      const isLogin = mode === "login";
      const registrationFields = [
        ["account-name-field", "account-name"],
        ["account-address-field", "account-street"],
        ["account-exterior-field", "account-exterior"],
        ["account-interior-field", "account-interior"],
        ["account-neighborhood-field", "account-neighborhood"],
        ["account-postal-field", "account-postal"],
        ["account-city-field", "account-city"],
        ["account-state-field", "account-state"],
        ["account-phone-field", "account-phone"]
      ];
      registrationFields.forEach(([elementId, inputId]) => {
        const element = document.getElementById(elementId);
        const input = document.getElementById(inputId);
        element.hidden = isLogin;
        input.required = !isLogin && inputId !== "account-interior";
      });
      const consentField = document.getElementById("privacy-consent-field");
      const consentInput = document.getElementById("privacy-consent");
      consentField.hidden = isLogin;
      consentInput.required = !isLogin;
      document.getElementById("account-title").textContent = isLogin ? "Qué bueno verte." : "Únete al street.";
      document.getElementById("account-intro").textContent = isLogin
        ? "Inicia sesión para guardar tus favoritos y tener todo tu estilo en un solo lugar."
        : "Crea tu cuenta, verifica tu correo y guarda tu dirección para tus pedidos.";
      document.getElementById("account-submit").innerHTML = `${isLogin ? "Entrar" : "Crear cuenta"}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>`;
      document.getElementById("account-password").autocomplete = isLogin ? "current-password" : "new-password";
      document.getElementById("login-tab").classList.toggle("active", isLogin);
      document.getElementById("register-tab").classList.toggle("active", !isLogin);
      document.getElementById("login-tab").setAttribute("aria-selected", String(isLogin));
      document.getElementById("register-tab").setAttribute("aria-selected", String(!isLogin));
      document.getElementById("account-message").textContent = "";
      document.getElementById("account-form-panel").hidden = false;
      document.getElementById("account-verification").hidden = true;
    }

    function renderAccount() {
      const isSignedIn = Boolean(accountEmail);
      document.getElementById("account-form-panel").hidden = isSignedIn;
      document.getElementById("account-success").hidden = !isSignedIn;
      document.getElementById("account-verification").hidden = true;
      document.getElementById("account-label").textContent = isSignedIn ? "Mi perfil" : "Mi cuenta";
      document.getElementById("open-account").setAttribute("aria-label", isSignedIn ? "Ver perfil" : "Iniciar sesión");
      if (isSignedIn) {
        document.getElementById("account-success-title").textContent = "Tu cuenta está activa.";
        document.getElementById("account-success-description").textContent = `Sesión iniciada como ${accountEmail}. La sesión se conserva en este navegador.`;
        const address = accountProfile && [
          accountProfile.street,
          accountProfile.exterior_number && `#${accountProfile.exterior_number}`,
          accountProfile.interior_number && `Int. ${accountProfile.interior_number}`,
          accountProfile.neighborhood,
          accountProfile.postal_code,
          accountProfile.city,
          accountProfile.state
        ].filter(Boolean).join(", ");
        document.getElementById("account-profile-address").textContent = address
          ? `Dirección guardada: ${address}`
          : "Todavía no hay una dirección guardada en tu perfil.";
        loadAccountOrders();
      }
    }

    function setCheckoutPending(pending, provider = null) {
      checkoutPending = pending;
      if (pending) {
        localStorage.setItem(CHECKOUT_PENDING_KEY, "true");
        if (provider) localStorage.setItem(CHECKOUT_PROVIDER_PENDING_KEY, provider);
      } else {
        localStorage.removeItem(CHECKOUT_PENDING_KEY);
        localStorage.removeItem(CHECKOUT_PROVIDER_PENDING_KEY);
      }
    }

    function renderOrderMessage(container, message, className) {
      const paragraph = document.createElement("p");
      paragraph.className = className;
      paragraph.textContent = message;
      container.replaceChildren(paragraph);
    }

    async function loadAccountOrders() {
      const container = document.getElementById("account-orders");
      if (!supabaseClient || !accountEmail) {
        renderOrderMessage(container, "Inicia sesión para ver tus pedidos.", "order-empty");
        return;
      }

      const { data, error } = await supabaseClient
        .from("orders")
        .select("id,amount,currency,status,payment_provider,created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) {
        console.error("No se pudieron cargar los pedidos de la cuenta.", error);
        renderOrderMessage(container, "No se pudieron cargar tus pedidos. Intenta de nuevo.", "order-error");
        return;
      }
      if (!data.length) {
        renderOrderMessage(container, "Tus compras pagadas aparecerán aquí.", "order-empty");
        return;
      }

      const statuses = {
        pending: "Pago pendiente",
        paid: "Pagado",
        failed: "Pago fallido",
        cancelled: "Cancelado"
      };
      const list = document.createElement("div");
      list.className = "order-list";
      data.forEach(order => {
        const row = document.createElement("div");
        row.className = "order-entry";
        const label = document.createElement("span");
        const date = new Date(order.created_at).toLocaleDateString("es-MX");
        const provider = order.payment_provider === "paypal" ? "PayPal" : "Stripe";
        label.textContent = `Pedido ${order.id.slice(0, 8).toUpperCase()} · ${date} · ${provider} · ${statuses[order.status] || "En proceso"}`;
        const amount = document.createElement("span");
        amount.textContent = new Intl.NumberFormat("es-MX", {
          style: "currency",
          currency: order.currency.toUpperCase()
        }).format(order.amount / 100);
        row.append(label, amount);
        list.append(row);
      });
      container.replaceChildren(list);
    }

    function setAccountOpen(isOpen) {
      const overlay = document.getElementById("account-overlay");
      if (isOpen) {
        setCartOpen(false);
        accountPreviousFocus = document.activeElement;
        renderAccount();
        overlay.classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => {
          const target = accountEmail ? document.getElementById("logout-button") : document.getElementById("account-email");
          target.focus();
        }, 30);
      } else {
        overlay.classList.remove("open");
        document.body.style.overflow = "";
        if (accountPreviousFocus && typeof accountPreviousFocus.focus === "function") accountPreviousFocus.focus();
      }
    }

    document.getElementById("open-account").addEventListener("click", () => setAccountOpen(true));
    document.getElementById("close-account").addEventListener("click", () => setAccountOpen(false));
    document.getElementById("account-overlay").addEventListener("click", event => {
      if (event.target === event.currentTarget) setAccountOpen(false);
    });
    document.getElementById("login-tab").addEventListener("click", () => setAccountMode("login"));
    document.getElementById("register-tab").addEventListener("click", () => setAccountMode("register"));
    document.getElementById("verification-back").addEventListener("click", () => setAccountMode("login"));
    document.getElementById("toggle-password").addEventListener("click", event => {
      const password = document.getElementById("account-password");
      const isVisible = password.type === "text";
      password.type = isVisible ? "password" : "text";
      event.currentTarget.textContent = isVisible ? "Mostrar" : "Ocultar";
      event.currentTarget.setAttribute("aria-label", isVisible ? "Mostrar contraseña" : "Ocultar contraseña");
    });
    function showAccountMessage(message) {
      const element = document.getElementById("account-message");
      element.textContent = message;
      element.style.color = "#3f3f3f";
    }

    function getAuthErrorMessage(error) {
      const errorText = `${error.code || ""} ${error.message || ""}`.toLowerCase();
      if (errorText.includes("email_not_confirmed")) return "Primero confirma tu correo con el enlace que te enviamos.";
      if (errorText.includes("invalid_credentials")) return "Correo o contraseña incorrectos. Si acabas de registrarte, confirma tu correo.";
      if (errorText.includes("user_already_exists")) return "Ya existe una cuenta con ese correo. Intenta iniciar sesión.";
      if (errorText.includes("password") && errorText.includes("least")) return "La contraseña no cumple los requisitos. Usa al menos 6 caracteres.";
      return error.message || "No se pudo completar la solicitud. Intenta de nuevo.";
    }

    async function saveAccountProfile(user) {
      const { data: existingProfile, error: lookupError } = await supabaseClient
        .from("user_profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (existingProfile) {
        accountProfile = existingProfile;
        return;
      }

      const metadata = user.user_metadata || {};
      const profile = {
        id: user.id,
        full_name: metadata.full_name || "",
        street: metadata.street || "",
        exterior_number: metadata.exterior_number || "",
        interior_number: metadata.interior_number || "",
        neighborhood: metadata.neighborhood || "",
        postal_code: metadata.postal_code || "",
        city: metadata.city || "",
        state: metadata.state || "",
        phone: metadata.phone || "",
        privacy_policy_version: metadata.privacy_policy_version || "",
        privacy_consent_at: metadata.privacy_consent_at || null
      };
      const { data, error } = await supabaseClient
        .from("user_profiles")
        .upsert(profile, { onConflict: "id" })
        .select()
        .single();
      if (error) throw error;
      accountProfile = data;
    }

    function showVerification(email) {
      document.getElementById("account-form-panel").hidden = true;
      document.getElementById("account-success").hidden = true;
      document.getElementById("account-verification").hidden = false;
      document.getElementById("verification-message").textContent = "";
      document.getElementById("verification-email").textContent = `Enviamos un enlace de confirmación a ${email}. Si no lo ves, revisa la carpeta de spam.`;
      document.getElementById("close-account").focus();
    }

    document.getElementById("verification-resend").addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      const message = document.getElementById("verification-message");
      try {
        const { error } = await supabaseClient.auth.resend({
          type: "signup",
          email: document.getElementById("account-email").value.trim()
        });
        if (error) throw error;
        message.style.color = "#3f3f3f";
        message.textContent = "Listo, enviamos otro enlace de confirmación.";
      } catch (error) {
        message.style.color = "#3f3f3f";
        message.textContent = getAuthErrorMessage(error);
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById("account-form").addEventListener("submit", async event => {
      event.preventDefault();
      if (accountBusy) return;
      if (!supabaseClient) {
        showAccountMessage("No se pudo cargar el servicio de cuentas. Comprueba tu conexión e inténtalo de nuevo.");
        return;
      }

      const email = document.getElementById("account-email").value.trim();
      const password = document.getElementById("account-password").value;
      const submitButton = document.getElementById("account-submit");
      accountBusy = true;
      submitButton.disabled = true;
      showAccountMessage(accountMode === "register" ? "Creando tu cuenta..." : "Iniciando sesión...");

      try {
        if (accountMode === "register") {
          if (window.location.protocol === "file:") {
            showAccountMessage("Para verificar el correo necesitas abrir VELKAP desde http://localhost o desde tu dominio publicado, y permitir esa URL en Supabase.");
            return;
          }
          const fullName = document.getElementById("account-name").value.trim();
          const address = {
            street: document.getElementById("account-street").value.trim(),
            exterior_number: document.getElementById("account-exterior").value.trim(),
            interior_number: document.getElementById("account-interior").value.trim(),
            neighborhood: document.getElementById("account-neighborhood").value.trim(),
            postal_code: document.getElementById("account-postal").value.trim(),
            city: document.getElementById("account-city").value.trim(),
            state: document.getElementById("account-state").value.trim(),
            phone: document.getElementById("account-phone").value.trim()
          };
          const redirectUrl = `${window.location.origin}${window.location.pathname}`;
          const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: redirectUrl,
              data: {
                full_name: fullName,
                ...address,
                privacy_policy_version: "2026-11-04",
                privacy_consent_at: new Date().toISOString()
              }
            }
          });
          if (error) throw error;
          document.getElementById("account-password").value = "";
          if (!data.session) {
            showVerification(email);
            return;
          }
          await saveAccountProfile(data.user);
          accountEmail = data.user.email || email;
          renderAccount();
          setAccountOpen(false);
          await handleCheckoutReturn();
          await continueCheckoutAfterAccount();
        } else {
          const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
          if (error) throw error;
          await saveAccountProfile(data.user);
          accountEmail = data.user.email || email;
          document.getElementById("account-password").value = "";
          renderAccount();
          setAccountOpen(false);
          await handleCheckoutReturn();
          await continueCheckoutAfterAccount();
        }
      } catch (error) {
        showAccountMessage(getAuthErrorMessage(error));
      } finally {
        accountBusy = false;
        submitButton.disabled = false;
      }
    });
    document.getElementById("logout-button").addEventListener("click", async () => {
      if (!supabaseClient) return;
      const { error } = await supabaseClient.auth.signOut();
      if (error) {
        document.getElementById("account-success-description").textContent = getAuthErrorMessage(error);
        return;
      }
      accountEmail = "";
      accountProfile = null;
      setCheckoutPending(false);
      document.getElementById("account-form").reset();
      document.getElementById("account-password").type = "password";
      document.getElementById("toggle-password").textContent = "Mostrar";
      setAccountMode("login");
      renderAccount();
      document.getElementById("account-email").focus();
    });

    if (supabaseClient) {
      supabaseClient.auth.getSession().then(async ({ data, error }) => {
        if (error) {
          showAccountMessage(getAuthErrorMessage(error));
          return;
        }
        const user = data.session?.user;
        accountEmail = user?.email || "";
        if (user) {
          try {
            await saveAccountProfile(user);
          } catch (profileError) {
            accountProfile = null;
            showAccountMessage(`La sesión se restauró, pero no se pudo cargar tu dirección: ${getAuthErrorMessage(profileError)}`);
          }
        }
        renderAccount();
        await handleCheckoutReturn();
        if (checkoutPending && user) await continueCheckoutAfterAccount();
      }).catch(error => showAccountMessage(getAuthErrorMessage(error)));
      supabaseClient.auth.onAuthStateChange((_event, session) => {
        accountEmail = session?.user.email || "";
        renderAccount();
      });
    }
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        if (document.getElementById("product-modal-overlay").classList.contains("open")) closeProductModal();
        else if (document.getElementById("account-overlay").classList.contains("open")) setAccountOpen(false);
        else if (document.getElementById("wishlist-overlay").classList.contains("open")) setWishlistOpen(false);
        else setCartOpen(false);
      }
    });

    document.getElementById("cart-items").addEventListener("click", event => {
      const quantityButton = event.target.closest("[data-quantity]");
      const removeButton = event.target.closest("[data-remove]");
      if (removeButton) {
        cart.delete(removeButton.dataset.remove);
        appliedPromotion = null;
        document.getElementById("promo-code").value = "";
        updatePromotionMessage("", "");
        renderCart();
      } else if (quantityButton) {
        const key = quantityButton.dataset.quantity;
        const nextQuantity = (cart.get(key) || 0) + Number(quantityButton.dataset.change);
        if (nextQuantity > 0) cart.set(key, nextQuantity);
        else cart.delete(key);
        appliedPromotion = null;
        document.getElementById("promo-code").value = "";
        updatePromotionMessage("", "");
        renderCart();
      }
    });

    async function continueCheckoutAfterAccount() {
      if (!checkoutPending) return;
      await startCheckout(localStorage.getItem(CHECKOUT_PROVIDER_PENDING_KEY) || "stripe");
    }

    async function startCheckout(provider) {
      if (!cart.size) return;
      if (checkoutBusy) return;
      if (!paymentOptions[provider]) {
        showToast("Este método de pago no está disponible en este momento.");
        return;
      }
      if (!supabaseClient) {
        setCheckoutPending(true, provider);
        setAccountMode("register");
        setAccountOpen(true);
        showAccountMessage("No pudimos conectar con el servicio de cuentas. Comprueba tu conexión e inténtalo de nuevo.");
        return;
      }

      const button = document.getElementById(`${provider}-checkout-button`);
      const originalLabel = button.innerHTML;
      checkoutBusy = true;
      renderCart();
      button.textContent = provider === "paypal" ? "Conectando con PayPal..." : "Conectando con Stripe...";
      try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (!data.session) {
          setCheckoutPending(true, provider);
          setAccountMode("register");
          setAccountOpen(true);
          showAccountMessage("Crea tu cuenta o inicia sesión para continuar con tu compra. Tu carrito se conservará.");
          return;
        }
        if (!data.session.user.email_confirmed_at && !data.session.user.confirmed_at) {
          setCheckoutPending(true, provider);
          setAccountMode("login");
          setAccountOpen(true);
          showAccountMessage("Confirma tu correo para continuar con la compra.");
          return;
        }

        setCheckoutPending(false);
        const endpoint = provider === "paypal" ? "/api/paypal/create-order" : "/create-checkout-session";
        const result = await requestPaymentApi(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${data.session.access_token}`
          },
          body: JSON.stringify({
            items: getCartItems(),
            promoCode: appliedPromotion?.code || null
          })
        }, "No pudimos iniciar el pago.");
        if (typeof result.checkoutUrl !== "string") {
          throw new Error("La pasarela no devolvió un enlace de pago válido.");
        }
        const checkoutUrl = new URL(result.checkoutUrl);
        const allowedCheckoutHost = provider === "paypal"
          ? checkoutUrl.hostname === "paypal.com" || checkoutUrl.hostname.endsWith(".paypal.com")
          : checkoutUrl.hostname === "checkout.stripe.com";
        if (checkoutUrl.protocol !== "https:" || !allowedCheckoutHost) {
          throw new Error("La pasarela devolvió una dirección de pago no válida.");
        }
        window.location.assign(checkoutUrl.href);
      } catch (error) {
        if (error.status === 401) {
          setCheckoutPending(true, provider);
          setAccountMode("login");
          setAccountOpen(true);
        }
        showToast(error.message || "No pudimos iniciar el pago.");
        console.error("No se pudo completar el inicio de checkout.", error);
      } finally {
        checkoutBusy = false;
        button.innerHTML = originalLabel;
        renderCart();
      }
    }

    async function handleCheckoutReturn() {
      const url = new URL(window.location.href);
      const paypalState = url.searchParams.get("paypal");
      if (paypalState === "cancel") {
        showToast("Pago PayPal cancelado. Tu carrito sigue guardado.");
        url.searchParams.delete("paypal");
        url.searchParams.delete("token");
        window.history.replaceState({}, "", url);
        return;
      }
      if (paypalState === "success") {
        const paypalOrderId = url.searchParams.get("token");
        if (!paypalOrderId || !supabaseClient) {
          showToast("No pudimos identificar tu pago de PayPal. Contacta a VELKAP antes de volver a pagar.");
          return;
        }
        try {
          const { data, error } = await supabaseClient.auth.getSession();
          if (error) throw error;
          if (!data.session) {
            setAccountMode("login");
            setAccountOpen(true);
            showAccountMessage("Inicia sesión con la cuenta usada para comprar para confirmar tu pago de PayPal.");
            return;
          }
          const result = await requestPaymentApi(
            `/api/paypal/orders/${encodeURIComponent(paypalOrderId)}/capture`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${data.session.access_token}`
              },
              body: JSON.stringify({})
            },
            "No pudimos confirmar el pago de PayPal."
          );
          if (result.status === "COMPLETED" && result.order.status === "paid") {
            cart.clear();
            renderCart();
            showToast("¡Compra confirmada! Consulta el pedido en Mi cuenta.");
            await loadAccountOrders();
          } else {
            showToast("PayPal aún no confirma el pago. Conservamos tu carrito.");
            return;
          }
          url.searchParams.delete("paypal");
          url.searchParams.delete("token");
          url.searchParams.delete("PayerID");
          window.history.replaceState({}, "", url);
        } catch (error) {
          showToast(error.message || "No pudimos confirmar el pago de PayPal.");
          console.error("No se pudo completar o verificar el pago PayPal.", error);
        }
        return;
      }

      const checkoutState = url.searchParams.get("checkout");
      if (checkoutState === "cancel") {
        showToast("Pago cancelado. Tu carrito sigue guardado.");
        url.searchParams.delete("checkout");
        window.history.replaceState({}, "", url);
        return;
      }
      if (checkoutState !== "success") return;
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId || !supabaseClient) {
        showToast("Inicia sesión para verificar el estado de tu pago.");
        return;
      }

      try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (!data.session) {
          setCheckoutPending(false);
          setAccountMode("login");
          setAccountOpen(true);
          showAccountMessage("Inicia sesión con la cuenta usada para pagar y verificaremos el pedido.");
          return;
        }
        const result = await requestPaymentApi(`/api/checkout-session/${encodeURIComponent(sessionId)}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` }
        }, "No pudimos verificar el pago.");
        if (result.paymentStatus === "paid" && result.order.status === "paid") {
          cart.clear();
          renderCart();
          showToast("¡Compra confirmada! Consulta el seguimiento en Mi cuenta.");
          await loadAccountOrders();
        } else {
          showToast("El pago aún no aparece como completado. Tu carrito sigue guardado.");
        }
        url.searchParams.delete("checkout");
        url.searchParams.delete("session_id");
        window.history.replaceState({}, "", url);
      } catch (error) {
        showToast(error.message || "No pudimos verificar tu pago.");
        console.error("No se pudo verificar el resultado del checkout.", error);
      }
    }

    document.getElementById("stripe-checkout-button").addEventListener("click", () => startCheckout("stripe"));
    document.getElementById("paypal-checkout-button").addEventListener("click", () => startCheckout("paypal"));
    document.getElementById("buy-button").addEventListener("click", () => {
      if (!cart.size) return;
      const singleProvider = getSingleAvailablePaymentProvider();
      if (singleProvider) {
        startCheckout(singleProvider);
        return;
      }
      document.getElementById("buy-button").hidden = true;
      const paymentStep = document.getElementById("checkout-payment-step");
      paymentStep.hidden = false;
      document.getElementById("payment-note").focus();
    });
    document.getElementById("payment-back-button").addEventListener("click", () => {
      document.getElementById("checkout-payment-step").hidden = true;
      document.getElementById("buy-button").hidden = false;
      document.getElementById("buy-button").focus();
    });

    async function loadPaymentOptions() {
      const note = document.getElementById("payment-note");
      try {
        const options = await requestPaymentApi("/api/payment-options", { method: "GET" }, "No pudimos consultar los métodos de pago.");
        paymentOptions.stripe = options.stripe === true;
        paymentOptions.paypal = options.paypal === true;
        if (paymentOptions.stripe && paymentOptions.paypal) {
          note.textContent = "Elige Stripe o PayPal. En Stripe pueden aparecer tarjeta, SPEI u OXXO según la disponibilidad de tu cuenta.";
        } else if (paymentOptions.stripe) {
          note.textContent = "Stripe está disponible. Los métodos habilitados dependen de la configuración de tu cuenta.";
        } else if (paymentOptions.paypal) {
          note.textContent = "PayPal está disponible para esta compra.";
        } else {
          note.textContent = "Los pagos aún no están configurados. Intenta de nuevo más tarde.";
        }
      } catch (error) {
        paymentOptions.stripe = false;
        paymentOptions.paypal = false;
        note.textContent = "No fue posible consultar los pagos. Intenta de nuevo más tarde.";
        console.error("No se pudieron consultar los métodos de pago.", error);
      }
      renderCart();
    }

    async function loadCatalog() {
      try {
        const response = await fetch(`${CHECKOUT_API_URL}/api/products`);
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.products)) {
          throw new Error(result.error || "La API devolvió un catálogo no válido.");
        }
        if (!result.products.length) {
          throw new Error("La API devolvió un catálogo vacío.");
        }
        products = result.products;
      } catch (error) {
        console.error("No se pudo cargar el catálogo actualizado.", error);
        showToast("No pudimos actualizar el catálogo. Intenta recargar la página.");
      }
    }

    async function loadCategoryImages() {
      try {
        const response = await fetch(`${CHECKOUT_API_URL}/api/category-images`);
        if (!response.ok) throw new Error(`La API respondió HTTP ${response.status}.`);
        const result = await response.json();
        if (!result.images || typeof result.images !== "object" || Array.isArray(result.images)) {
          throw new Error("La API devolvió imágenes de categorías no válidas.");
        }
        categoryImages = result.images;
      } catch (error) {
        console.error("No se pudieron cargar las imágenes personalizadas de categorías.", error);
      }
    }

    async function loadFeaturedProducts() {
      try {
        const response = await fetch(`${CHECKOUT_API_URL}/api/featured-products`);
        if (!response.ok) throw new Error(`La API respondió HTTP ${response.status}.`);
        const result = await response.json();
        if (!Array.isArray(result.products)) {
          throw new Error("La API devolvió productos destacados no válidos.");
        }
        featuredProducts = result.products;
      } catch (error) {
        featuredProductsLoadError = true;
        console.error("No se pudieron cargar los productos destacados.", error);
      }
    }

    async function loadHeroVideo() {
      try {
        const response = await fetch(`${CHECKOUT_API_URL}/api/hero-video`);
        if (!response.ok) throw new Error(`La API respondió HTTP ${response.status}.`);
        const result = await response.json();
        if (!result.videoUrl) return;

        const videoUrl = new URL(result.videoUrl);
        if (!["http:", "https:"].includes(videoUrl.protocol)) {
          throw new Error("La API devolvió una URL de video no válida.");
        }

        const video = document.getElementById("hero-video");
        const illustration = document.querySelector(".hero-cap");
        const frame = video.closest(".hero-art");
        video.addEventListener("error", () => {
          console.error("No se pudo reproducir el video de portada.");
          video.hidden = true;
          video.removeAttribute("src");
          illustration.hidden = false;
          frame.classList.remove("has-video");
        }, { once: true });
        video.src = videoUrl.href;
        video.hidden = false;
        illustration.hidden = true;
        frame.classList.add("has-video");
        video.play().catch(error => {
          console.warn("La reproducción automática del video de portada no está disponible.", error);
          video.controls = true;
        });
      } catch (error) {
        console.error("No se pudo cargar el video de portada; se mantiene la ilustración.", error);
      }
    }

    (async () => {
      await Promise.all([loadCatalog(), loadHeroVideo(), loadCategoryImages(), loadFeaturedProducts()]);
      renderSizeOptions();
      renderCategoryCatalog();
      renderFeaturedProducts();
      cart = loadSavedCart();
      favorites = loadSavedWishlist();
      renderProducts();
      renderCart();
      renderWishlist();
      loadPaymentOptions();
    })();
